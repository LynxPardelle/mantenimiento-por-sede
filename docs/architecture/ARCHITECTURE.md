# Arquitectura de Mantenimiento por Sede

## Contexto

El coordinador de mantenimiento administra equipos e inspecciones por sede. El técnico registra inspecciones en la sede asignada. Una organización puede tener varias sedes con su propia zona horaria. El piloto supone decenas de sedes y cientos de activos por organización, con tráfico operativo intermitente. No se ha establecido un objetivo contractual de disponibilidad.

## Componentes

| Componente                               | Responsabilidad                                                                                                   | Estado en esta base                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Angular standalone y NgRx SignalStore    | Aplicación de operación en español. Los stores viven por funcionalidad y el servidor conserva los datos durables. | Página de arranque con consulta de salud y estados de carga, éxito y error.                   |
| API Gateway HTTP API y Lambda Node.js 24 | Terminación HTTP y ejecución por solicitud. Los recursos de dominio se agregan detrás de autorización JWT.        | Una ruta `GET /api/health`.                                                                   |
| DynamoDB bajo demanda                    | Inventario e inspecciones con claves por organización y sede.                                                     | Tabla e índice de pendientes en el template. La función de salud carece de acceso a la tabla. |
| Proveedor de identidad OIDC              | Identidad de la persona operadora. La aplicación verifica el rol y la pertenencia a la sede.                      | Corresponde a la primera versión de dominio.                                                  |

El [diagrama Mermaid](diagram.mmd) muestra la base y las conexiones previstas para el piloto. La [ADR](adr/0001-api-http-y-datos-por-sede.md) registra las decisiones de ejecución y persistencia.

## Contratos

Todas las rutas de dominio propuestas usan el prefijo `/api/v1/sites/{siteId}`. El servidor deriva la organización de una identidad verificada y valida la asignación a la sede antes de consultar datos. Una identidad administradora puede dar de alta equipos y programar inspecciones. Una identidad técnica puede consultar sus sedes asignadas y registrar resultados.

| Ruta                                                                       | Propósito                                                                           | Estado       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------ |
| `GET /api/health`                                                          | Señal de disponibilidad del proceso. Responde `200` con JSON `{"status":"ok"}`.     | Implementada |
| `GET /assets` y `POST /assets`                                             | Listado paginado y alta de equipos de la sede.                                      | Prevista     |
| `GET /inspections?status=pending&dueThrough=YYYY-MM-DD`                    | Lista paginada de inspecciones pendientes hasta la fecha en la zona de la sede.     | Prevista     |
| `GET /assets/{assetId}/inspections` y `POST /assets/{assetId}/inspections` | Historial paginado y programación de una inspección del equipo.                     | Prevista     |
| `PUT /assets/{assetId}/inspections/{inspectionId}/completion`              | Cierre único con resultado y nota. La identidad y la hora UTC las fija el servidor. | Prevista     |

Las altas usan una clave de idempotencia y el cierre actualiza con condición de estado pendiente. Un reintento idéntico del cierre devuelve el resultado persistido. Un resultado distinto sobre una inspección cerrada devuelve `409`. Una sede ajena se trata como inexistente ante el solicitante. El contrato de salud es superficial y no consulta datos ni servicios externos.

## Datos y acceso

| Registro    | PK                                          | SK                          |
| ----------- | ------------------------------------------- | --------------------------- |
| Sede        | `ORG#<orgId>#SITE#<siteId>`                 | `META`                      |
| Pertenencia | `ORG#<orgId>`                               | `MEMBER#<subjectId>`        |
| Equipo      | `ORG#<orgId>#SITE#<siteId>`                 | `ASSET#<assetId>`           |
| Inspección  | `ORG#<orgId>#SITE#<siteId>#ASSET#<assetId>` | `INSPECTION#<inspectionId>` |

El equipo guarda nombre, tipo y estado operativo. La sede guarda su zona IANA. Una inspección guarda fecha local de vencimiento, estado, resultado, nota, autor y fecha UTC de finalización. El identificador ULID permite paginar el historial por orden de creación. Las consultas usan claves de sede y equipo, sin escanear tablas.

El índice disperso `PendingBySite` usa `pendingSiteKey=ORG#<orgId>#SITE#<siteId>` y `pendingDueKey=<YYYY-MM-DD>#<assetId>#<inspectionId>`. El cierre elimina ambos atributos en la misma actualización. La lista puede tardar brevemente en reflejar ese cierre por la consistencia eventual del índice. Para confirmar un registro se lee su clave primaria.

## Operación y riesgos

- Una respuesta de salud verifica el proceso Lambda. La integración con datos y la asignación de roles se validan con pruebas aparte al incorporar el dominio.
- El aislamiento por organización se verifica en lecturas y escrituras con dos organizaciones y equipos que compartan identificadores locales.
- Los registros de acceso contienen identificador, ruta, estado y latencia. Las notas del técnico quedan en la tabla. Evitar guardar JWT, notas y datos de usuarios en logs.
- La primera versión muestra vencimientos en pantalla. Incorporar Scheduler para recordatorios solo tras confirmar el canal y la frecuencia. SQS se justifica cuando el envío requiera reintentos y procesamiento desacoplado.

[API Gateway HTTP API con SAM](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-httpapi.html) · [NgRx SignalStore](https://ngrx.io/guide/signals/signal-store)
