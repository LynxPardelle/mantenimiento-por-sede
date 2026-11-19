# Arquitectura de SedePulso

## Contexto y objetivo

La persona coordinadora administra equipos e inspecciones por sede; la persona técnica registra resultados en sedes asignadas. Cada sede tiene zona horaria propia. El piloto supone decenas de sedes y cientos de activos por organización, con tráfico intermitente; aún no hay compromiso contractual de disponibilidad ni validación comercial del uso.

La arquitectura usa microservicios serverless AWS y Angular servido por Lambda. Cada servicio de dominio tiene función, rol IAM y tabla DynamoDB propios. Los stacks permiten actualizar un servicio sin redesplegar los demás cuando se conserva el contrato. La separación no consiste sólo en dividir archivos dentro de una Lambda.

## Componentes y propiedad

| Componente | Responsabilidad | Datos y acceso |
| --- | --- | --- |
| Angular 22 y NgRx SignalStore | Operación en español, formularios, carga, errores y reintentos. | Estado de interfaz en navegador; datos durables en API. |
| Lambda SSR Node.js 24 ARM64 | Generar HTML de Angular detrás de CloudFront. | Sin permisos DynamoDB ni acceso a tablas de dominio. |
| CloudFront, S3 privado y OAC | HTTPS, estáticos y acceso privado a orígenes. | Firma acceso a S3 y Function URL SSR. `/api/*` va a HTTP API sin caché operativa. |
| API Gateway HTTP API | Enrutamiento y autorización JWT. | Verifica firma, emisor y audiencia o `client_id`; entrega claims verificados. |
| Cognito | Identidad y sesión con authorization code y PKCE. | Cliente público sin secreto; registro abierto deshabilitado. |
| Access | Resolver sedes, pertenencia, organización y rol. | Único servicio con acceso directo a `AccessTable`. |
| Assets | Alta y consulta paginada de equipos. | Tabla propia; invoca Access por IAM. |
| Inspections | Programación, pendientes, historial y cierre. | Tabla propia e índice de pendientes; invoca Access y Assets por IAM. |
| Health y Config | Salud superficial y configuración pública de inicio de sesión. | Sin acceso a tablas de negocio. Config no publica secretos. |

El [diagrama](diagram.mmd) muestra los límites. La [ADR 0001](adr/0001-api-http-y-datos-por-sede.md) conserva el contexto inicial; la [ADR 0002](adr/0002-microservicios-y-angular-ssr.md) define la evolución a microservicios y SSR en Lambda.

## Stacks y entrega independiente

| Template | Propiedad | Dependencias |
| --- | --- | --- |
| `infra/template.yaml` | Plataforma: HTTP API, JWT, Cognito, Access, membresías, Health y Config. | Primero; expone referencias de API, autorizador y Access. |
| `infra/services/assets.yaml` | Assets, tabla, rol, integraciones y rutas de inventario. | Recibe plataforma. |
| `infra/services/inspections.yaml` | Inspections, tabla, índice, rol, integraciones y rutas. | Recibe plataforma y función Assets. |
| `infra/frontend.yaml` | SSR, S3, CloudFront, certificado y DNS. | Recibe origen HTTP API y artefactos Angular. |

La HTTP API, el stage y todas sus rutas se definen como recursos explícitos de CloudFormation; no se mezcla una importación OpenAPI con rutas administradas por otros stacks. El orquestador despliega en orden. `--service` permite actualizar un stack manteniendo los contratos y referencias; los cambios incompatibles requieren migración coordinada. Access es una dependencia síncrona de autorización: un servicio debe fallar de forma cerrada si no puede resolver la pertenencia. La programación depende de Assets para validar el equipo.

No existen transacciones entre servicios ni acceso directo a tablas ajenas. La idempotencia se resuelve dentro de la tabla del servicio responsable. No se añaden colas ni eventos antes de tener un flujo que requiera procesamiento desacoplado.

## Flujo web, identidad y autorización

1. CloudFront obtiene HTML de la Lambda SSR y estáticos de S3 mediante OAC.
2. Angular consulta `GET /api/config` para obtener configuración pública de Cognito. Inicia sesión con authorization code, PKCE y scopes OIDC.
3. El navegador envía el access token en `Authorization: Bearer …`. API Gateway verifica JWT; el backend exige `token_use=access`.
4. Access busca pertenencia por el `sub` verificado y resuelve `orgId`, sedes y rol. Organización y rol no proceden del cuerpo ni de un encabezado elegido por el cliente.
5. Assets e Inspections usan ese contexto en claves y permisos. Las llamadas internas están limitadas por IAM a las funciones necesarias.

Una persona coordinadora puede registrar equipos y programar inspecciones. Una persona técnica puede consultar sus sedes y registrar resultados. Sede ajena devuelve `404`; rol insuficiente en sede propia, `403`; token ausente, inválido o de uso incorrecto, `401`. La interfaz inicial no administra organizaciones, usuarios o membresías.

Las rutas de dominio no exigen el scope `openid` en el autorizador; ese scope pertenece al inicio de sesión OIDC. La validación de pertenencia y rol es la misma para las sesiones de la interfaz y las identidades técnicas de smoke. Un ID token no sustituye al access token.

## Contratos HTTP

Las rutas por sede usan el prefijo `/api/v1/sites/{siteId}`. Los identificadores son opacos: su sintaxis no concede autorización.

| Ruta | Servicio y propósito |
| --- | --- |
| `GET /api/health` | Health. `200` y `{"status":"ok"}`; no comprueba datos ni otros servicios. |
| `GET /api/config` | Config. Datos públicos de inicio de sesión, sin secretos. |
| `GET /api/v1/sites` | Access. Sedes de la identidad autenticada. |
| `GET /assets` y `POST /assets` | Assets. Listado paginado y alta de equipos. |
| `GET /inspections?status=pending&dueThrough=YYYY-MM-DD` | Inspections. Pendientes hasta la fecha local indicada. |
| `GET /assets/{assetId}/inspections` | Inspections. Historial paginado. |
| `POST /assets/{assetId}/inspections` | Inspections. Programación después de validar equipo con Assets. |
| `PUT /assets/{assetId}/inspections/{inspectionId}/completion` | Inspections. Cierre; autor y hora UTC elegidos por servidor. |

Las rutas después de las tres primeras son relativas al prefijo de sede. Altas y programación usan `Idempotency-Key`, acotada a actor, operación y sede, con retención mínima de siete días, prolongada hasta el borrado eventual de TTL. Dentro de ese periodo, repetir clave y contenido devuelve el registro original; contenido distinto produce `409`. El registro de dominio y la idempotencia se guardan en una transacción de la tabla propia. La idempotencia no garantiza deduplicación ilimitada después de la retención.

El cierre usa condición de estado pendiente. Un reintento idéntico devuelve el original; contenido distinto sobre una inspección cerrada produce `409`. Autor y fecha del primer cierre no cambian. Los cursores se validan y quedan acotados a organización, sede y consulta autorizadas.

## Modelo de datos

| Servicio | Registro | PK | SK |
| --- | --- | --- | --- |
| Access | Pertenencia | `USER#<sub>` | `MEMBERSHIP` |
| Assets | Equipo | `ORG#<orgId>#SITE#<siteId>` | `ASSET#<assetId>` |
| Inspections | Inspección | `ORG#<orgId>#SITE#<siteId>#ASSET#<assetId>` | `INSPECTION#<inspectionId>` |

La pertenencia contiene `orgId` y las sedes asignadas con rol y zona horaria. Los usuarios ya existentes en Cognito se asocian mediante el aprovisionamiento administrativo. Las escrituras sólo usan el contexto resuelto por Access.

Los identificadores de dominio son ULID. Un equipo guarda nombre, tipo y estado operativo. Una inspección conserva vencimiento local, estado, resultado, nota, autor y fecha UTC de finalización. La zona IANA de la sede permite separar fecha local e instante de cierre.

El índice disperso `PendingBySite` usa `pendingSiteKey=ORG#<orgId>#SITE#<siteId>` y `pendingDueKey=<YYYY-MM-DD>#<assetId>#<inspectionId>`, con proyección `ALL`. El cierre elimina ambas claves en la misma actualización. La lista es eventualmente consistente: se confirma el cierre leyendo el registro primario. Las consultas de dominio son por clave y paginadas, sin scans de tablas.

## Ambientes y operación

Development usa `sedepulso-development.lynxpardelle.com`, testing `sedepulso-testing.lynxpardelle.com` y producción `sedepulso.lynxpardelle.com`, cada uno con stacks y datos propios. La [promoción](../promocion.md) sigue development → testing → main. CloudFront usa certificado ACM en `us-east-1`.

S3 bloquea acceso público. La Function URL de SSR usa `AWS_IAM`; la política permite CloudFront con `SourceArn` de la distribución y los permisos `lambda:InvokeFunctionUrl` y `lambda:InvokeFunction`. Los servicios de negocio pasan por el autorizador HTTP API.

Los logs tienen retención de 14 días y no deben incluir JWT, notas, contraseñas ni cuerpos personales. Las alarmas de errores existen como señales; un canal y destinatario de notificación requieren configuración. Las tablas usan capacidad bajo demanda y conservación de datos. Comprobar recuperación y backups antes de usar datos reales.

La demostración local se limita a localhost y datos aislados. La validación real incluye Cognito, IAM, DynamoDB, dos organizaciones, dos sedes, reintentos, cierre concurrente y rechazo de acceso directo a orígenes privados. Salud por sí sola no prueba este recorrido.

El [plan](../../plan/feature-mantenimiento-1.md) registra implementación, pruebas y despliegues. La arquitectura describe decisiones y contratos, no acredita publicación. Recordatorios, Scheduler, SQS, fotografías y operación sin conexión quedan después del piloto manual.

## Referencias primarias

- [Angular: SSR e híbrido](https://angular.dev/guide/ssr).
- [CloudFront OAC para Lambda Function URL](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html).
- [Cognito: authorization code con PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html).
- [HTTP API con CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-apigatewayv2-api.html).
- [NgRx SignalStore](https://ngrx.io/guide/signals/signal-store).
