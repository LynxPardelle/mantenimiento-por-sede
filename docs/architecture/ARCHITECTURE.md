# Arquitectura de SedePulso

## Contexto y objetivo

La persona coordinadora administra equipos e inspecciones por sede; la persona técnica registra resultados en sedes asignadas. Cada sede tiene zona horaria propia. El piloto supone decenas de sedes y cientos de activos por organización, con tráfico intermitente; aún no hay compromiso contractual de disponibilidad ni validación comercial del uso.

La arquitectura usa microservicios serverless AWS y Angular servido por Lambda. Cada servicio de dominio tiene función, rol IAM y tabla DynamoDB propios. Los stacks permiten actualizar un servicio sin redesplegar los demás cuando se conserva el contrato. La separación no consiste sólo en dividir archivos dentro de una Lambda.

La inscripción desde la app está publicada y verificada en los tres ambientes: [cierre de onboarding](../releases/2026-11-19-onboarding-piloto.md). Incorpora Pilot como quinto stack de aplicación. Los cierres históricos conservan la evidencia de la arquitectura anterior.

## Componentes y propiedad

| Componente | Responsabilidad | Datos y acceso |
| --- | --- | --- |
| Angular 22 y NgRx SignalStore | Operación en español, formularios, carga, errores y reintentos. | Estado de interfaz en navegador; datos durables en API. |
| Lambda SSR Node.js 24 ARM64 | Generar HTML de Angular detrás de CloudFront. | Sin permisos DynamoDB ni acceso a tablas de dominio. |
| CloudFront, S3 privado y OAC | HTTPS, estáticos y acceso privado a orígenes. | Firma acceso a S3 y Function URL SSR. `/api/*` va a HTTP API sin caché operativa. |
| API Gateway HTTP API | Enrutamiento y autorización JWT. | Verifica firma, emisor y audiencia o `client_id`; entrega claims verificados. |
| Cognito | Identidad y sesión con authorization code y PKCE. | Cliente público sin secreto; registro propio con correo verificado y creación de espacio aislado. |
| Access | Resolver sedes, pertenencia, organización y rol. | Único servicio con acceso directo a `AccessTable`. |
| Assets | Alta y consulta paginada de equipos. | Tabla propia; invoca Access por IAM. |
| Inspections | Programación, pendientes, historial y cierre. | Tabla propia e índice de pendientes; invoca Access y Assets por IAM. |
| Pilot | Borrador, alcance, objetivos, línea base declarada e inscripción explícita por sede. | Tabla propia; la API invoca Access por IAM. Un exportador separado sólo consulta el índice mínimo de cohortes confirmadas. |
| Health y Config | Salud superficial y configuración pública de inicio de sesión. | Sin acceso a tablas de negocio. Config no publica secretos. |

El [diagrama](diagram.mmd) muestra los límites. La [ADR 0001](adr/0001-api-http-y-datos-por-sede.md) conserva el contexto inicial; la [ADR 0002](adr/0002-microservicios-y-angular-ssr.md) define la evolución a microservicios y SSR en Lambda.

## Stacks y entrega independiente

| Template | Propiedad | Dependencias |
| --- | --- | --- |
| `infra/template.yaml` | Plataforma: HTTP API, JWT, Cognito, Access, membresías, Health y Config. | Primero; expone referencias de API, autorizador y Access. |
| `infra/services/assets.yaml` | Assets, tabla, rol, integraciones y rutas de inventario. | Recibe plataforma. |
| `infra/services/inspections.yaml` | Inspections, tabla, índice, rol, integraciones y rutas. | Recibe plataforma y función Assets. |
| `infra/services/pilot.yaml` | Pilot, tabla, API JWT, exportador IAM de sólo lectura, roles y alarmas. | Recibe plataforma y función Access; sus outputs permiten al observador invocar sólo el exportador. |
| `infra/frontend.yaml` | SSR, S3, CloudFront, certificado y DNS. | Recibe origen HTTP API y artefactos Angular. |

La HTTP API, el stage y todas sus rutas se definen como recursos explícitos de CloudFormation; no se mezcla una importación OpenAPI con rutas administradas por otros stacks. El orquestador despliega en orden. `--service` permite actualizar un stack manteniendo los contratos y referencias; los cambios incompatibles requieren migración coordinada. Access es una dependencia síncrona de autorización: un servicio debe fallar de forma cerrada si no puede resolver la pertenencia. La programación depende de Assets para validar el equipo.

El runtime de los servicios no usa transacciones entre dominios ni acceso directo a tablas ajenas. La idempotencia se resuelve dentro de la tabla del servicio responsable. El observador administrativo separado tiene el alcance de lectura documentado más adelante. No se añaden colas ni eventos antes de tener un flujo que requiera procesamiento desacoplado.

## Flujo web, identidad y autorización

1. CloudFront obtiene HTML de la Lambda SSR y estáticos de S3 mediante OAC.
2. Angular consulta `GET /api/config` para obtener configuración pública de Cognito. Inicia sesión con authorization code, PKCE y scopes OIDC.
3. El navegador envía el access token en `Authorization: Bearer …`. API Gateway verifica JWT; el backend exige `token_use=access`.
4. Access busca pertenencia por el `sub` verificado y resuelve `orgId`, sedes y rol. Organización y rol no proceden del cuerpo ni de un encabezado elegido por el cliente.
5. Assets, Inspections y Pilot usan ese contexto en claves y permisos. Las llamadas internas están limitadas por IAM a las funciones necesarias.

Una persona coordinadora puede registrar equipos y programar inspecciones. Una persona técnica puede consultar sus sedes y registrar resultados. Sede ajena devuelve `404`; rol insuficiente en sede propia, `403`; token ausente, inválido o de uso incorrecto, `401`. El alta pública crea una organización y sede inicial propias. La autogestión de invitaciones y sedes adicionales sigue pendiente; las asignaciones existentes también pueden administrarse con las herramientas técnicas.

La lectura y escritura del onboarding del piloto requieren rol coordinador. Access comunica por IAM un marcador de procedencia técnica sólo si existe en la pertenencia administrada; no lo publica en la lista de sedes. Pilot fija organización, zona, actor, código y fecha del acuerdo. El usuario no puede elegirlos en el cuerpo. La nueva pantalla privada se resuelve en el navegador, sin serializar línea base ni sesión en HTML SSR.

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
| `GET /pilot` y `PUT /pilot` | Pilot. Contexto y borrador privado del coordinador, con control de revisión. |
| `POST /pilot/enrollment` | Pilot. Confirmación explícita de la revisión guardada; inscripción final conservada. |

Las rutas después de las tres primeras son relativas al prefijo de sede. Altas y programación usan `Idempotency-Key`, acotada a actor, operación y sede, con retención mínima de siete días, prolongada hasta el borrado eventual de TTL. Dentro de ese periodo, repetir clave y contenido devuelve el registro original; contenido distinto produce `409`. El registro de dominio y la idempotencia se guardan en una transacción de la tabla propia. La idempotencia no garantiza deduplicación ilimitada después de la retención.

El cierre usa condición de estado pendiente. Un reintento idéntico devuelve el original; contenido distinto sobre una inspección cerrada produce `409`. Autor y fecha del primer cierre no cambian. Los cursores se validan y quedan acotados a organización, sede y consulta autorizadas.

Pilot usa `expectedRevision`, huella del borrador y transacciones de su tabla propia, con un único piloto por organización/sede. El inicio admisible va desde mañana hasta 90 días después de hoy en la zona de la sede. Confirmar conserva la primera inscripción, sus objetivos y línea base; un reintento posterior al inicio devuelve el original sin renovar el periodo. El [contrato del piloto](../contracts/pilot-enrollment.md) define campos, límites, declaraciones y conflictos.

## Modelo de datos

| Servicio | Registro | PK | SK |
| --- | --- | --- | --- |
| Access | Pertenencia | `USER#<sub>` | `MEMBERSHIP` |
| Assets | Equipo | `ORG#<orgId>#SITE#<siteId>` | `ASSET#<assetId>` |
| Inspections | Inspección | `ORG#<orgId>#SITE#<siteId>#ASSET#<assetId>` | `INSPECTION#<inspectionId>` |
| Pilot | Borrador/inscripción privada | `ORG#<orgId>#SITE#<siteId>` | `PILOT` |
| Pilot | Cohorte confirmada y resumen exportable | `PILOT#REGISTRY` | `COHORT#<code>` |

La pertenencia contiene `orgId` y las sedes asignadas con rol y zona horaria. Los usuarios ya existentes en Cognito se asocian mediante el aprovisionamiento administrativo. Las escrituras sólo usan el contexto resuelto por Access.

Los identificadores de equipo e inspección son ULID; los códigos de cohorte son derivados estables de organización/sede. Un equipo guarda nombre, tipo y estado operativo. Una inspección conserva vencimiento local, estado, resultado, nota, autor y fecha UTC de finalización. Las nuevas altas y programaciones guardan además `createdAt` UTC del servidor, conservado al reintentar; los registros anteriores pueden carecer de él y no se reconstruye desde el ULID. La zona IANA de la sede permite separar fecha local e instante de cierre.

El índice disperso `PendingBySite` usa `pendingSiteKey=ORG#<orgId>#SITE#<siteId>` y `pendingDueKey=<YYYY-MM-DD>#<assetId>#<inspectionId>`, con proyección `ALL`. El cierre elimina ambas claves en la misma actualización. La lista es eventualmente consistente: se confirma el cierre leyendo el registro primario. Las consultas de dominio son por clave y paginadas, sin scans de tablas.

## Ambientes y operación

Development usa `sedepulso-development.lynxpardelle.com`, testing `sedepulso-testing.lynxpardelle.com` y producción `sedepulso.lynxpardelle.com`, cada uno con stacks y datos propios. La [promoción](../promocion.md) sigue development → testing → main. CloudFront usa certificado ACM en `us-east-1`.

S3 bloquea acceso público. La Function URL de SSR usa `AWS_IAM`; la política permite CloudFront con `SourceArn` de la distribución y los permisos `lambda:InvokeFunctionUrl` y `lambda:InvokeFunction`. Los servicios de negocio pasan por el autorizador HTTP API.

Los logs tienen retención de 14 días y no deben incluir JWT, notas, contraseñas, protocolo de línea base ni cuerpos personales. Las alarmas Lambda detectan fallos de invocación; `ApiServerErrors` monitoriza HTTP API `5xx` por `ApiId`, incluyendo respuestas de error manejadas. La nueva definición incluye once alarmas por ambiente: las nueve anteriores y dos de Pilot. Su despliegue adicional está en verificación; los cierres previos acreditan el conjunto anterior y la recepción de access logs de salud. Un canal y destinatario de notificación requieren configuración. Las tablas usan capacidad bajo demanda y conservación de datos. El ejercicio de Access pasó con un marcador restaurado y limpieza verificada; la recuperación coordinada de todos los dominios y RTO/RPO comerciales requieren un ensayo adicional antes del piloto con datos reales.

La demostración local se limita a localhost y datos aislados. La validación real incluye Cognito, IAM, DynamoDB, dos organizaciones, dos sedes, reintentos, cierre concurrente y rechazo de acceso directo a orígenes privados. Salud por sí sola no prueba este recorrido.

El [plan](../../plan/feature-mantenimiento-1.md) registra implementación, pruebas y despliegues. La arquitectura describe decisiones y contratos, no acredita publicación. Recordatorios, Scheduler, SQS, fotografías y operación sin conexión quedan después del piloto manual.

## Referencias primarias

- [Angular: SSR e híbrido](https://angular.dev/guide/ssr).
- [CloudFront OAC para Lambda Function URL](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html).
- [Cognito: authorization code con PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html).
- [HTTP API con CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-apigatewayv2-api.html).
- [NgRx SignalStore](https://ngrx.io/guide/signals/signal-store).

## Registro y entrega continua

Cognito ejecuta validación previa y activación posterior a la confirmación. Los tres atributos persistidos describen organización, sede y zona horaria; no confieren permisos. El servidor deriva los IDs del sujeto verificado, fija `plan=pilot` y usa una transacción para persistir organización y pertenencia. Reintentos o confirmaciones repetidas conservan la asignación inicial. Véase [contrato de registro](../contracts/registration.md).

Un WAF regional compartido sólo redirige `GET /signup` del dominio Cognito de cada ambiente hacia su `/registro`; login, recuperación y las API JSON mantienen su funcionamiento. Esto evita presentar un formulario del proveedor que no recoge los datos de la sede.

GitHub usa OIDC con subject inmutable y roles por environment; el rol de servicio CloudFormation exige una boundary de ejecución por ambiente. Las promociones conservan las protecciones existentes. Cada deploy ejecuta comprobaciones de dominio, aprovisionamiento y orígenes privados. El [runbook OIDC](../runbooks/ci-oidc.md) detalla alcances y límites IAM.

## Observación operacional del piloto

TASK-006 añade un trabajo administrativo de GitHub Actions con rol OIDC separado por ambiente. Conserva el registro administrativo privado S3 y añade la exportación IAM del dueño Pilot como fuente de las inscripciones confirmadas desde la app. Combina ambas fuentes con validación estricta: un código o alcance duplicado produce error y no sustituye una cohorte ni sus cortes. Un borrador no aparece en la exportación; un fallo del exportador tampoco se interpreta como ausencia de participantes.

El observador consulta por clave y con proyecciones saneadas las tablas Assets e Inspections y persiste agregados en un bucket privado cifrado/versionado. No incorpora una ruta HTTP de analítica ni modifica los límites de acceso de las Lambdas del producto. La autorización IAM del observador abarca ambas tablas propias; el alcance por cohorte lo aplica el recolector administrativo, sin presentarlo como aislamiento IAM por participante.

El observador no recibe consultas de registros Access o Pilot, scans ni escrituras de negocio. Descubre metadatos y las alarmas métricas exactas de los cinco stacks propios e invoca únicamente `PilotExportFunction`. Esa función no tiene rutas HTTP y su rol sólo permite consultar `PILOT#REGISTRY` de su tabla. La API que escribe el onboarding tiene otro rol y no puede invocarse con el permiso del observador.

La inscripción guarda el registro privado y la fila exportable en una transacción de la misma tabla. El exportador reconstruye una lista permitida de campos: cohorte y agregados de línea base con `source=participant-declared`. Descripción, protocolo, criterio y valores de actor permanecen en Pilot y no llegan a S3. Personas declaradas por rol no equivalen a usuarios activos; el sistema no mide `lastSeen`. Capturar una línea base no demuestra una mejora ni aporta automáticamente esfuerzo o búsquedas observadas durante semanas posteriores.

Los cortes semanales usan la zona local de la sede y se conservan mediante creación condicional; el informe posterior reutiliza el corte ya guardado. La [guía del observador](../runbooks/piloto-metricas.md) describe privacidad, cobertura, retención y recuperación del seguimiento.

El calendario diario en la nube y la revisión local de Codex no inscriben una operación real ni activan cobros. La inscripción desde la app requiere datos completos y tres declaraciones explícitas del coordinador. Development/testing y fixtures marcados por Access permanecen `technical`; producción permite `enrolled-real` para la operación declarada. Esto no acredita uso, precio aceptado o cuatro semanas transcurridas. Stripe permanece deshabilitado.
