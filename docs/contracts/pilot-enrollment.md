# Inscripción y línea base del piloto de SedePulso

La ampliación está publicada y verificada en development, testing y producción: [cierre de onboarding](../releases/2026-11-19-onboarding-piloto.md). La entrega anterior del observador se conserva en su [cierre técnico](../releases/2026-11-19-piloto.md). Este contrato habilita la inscripción explícita desde la app y mantiene Stripe deshabilitado. Guardar un borrador o crear una cuenta no inicia un piloto.

El exportador aplica `LeadingKeys` con `ForAllValues:StringEquals` y exige que la clave esté presente mediante `Null=false`, conforme al [control fino de DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/specifying-conditions.html). Su respuesta se limita a 4 MiB de datos antes del sobre de respuesta, por debajo del [límite síncrono de Lambda](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html).

## Autorización y alcance

Las rutas exigen access token verificado por HTTP API y `token_use=access` en el backend. Pilot invoca Access mediante IAM para resolver organización, sede, rol y procedencia técnica. Tanto lectura como escritura requieren `coordinator` en la sede asignada. Una persona técnica recibe `403`; una sede ajena, `404`; token ausente o incorrecto, `401`.

El navegador proporciona el identificador de sede en la ruta, pero no elige organización, zona horaria, actor, código de cohorte, clasificación ni fechas del acuerdo. Pilot los deriva del contexto autorizado y del reloj del servidor. Sólo el servicio Pilot accede a `PilotTable`; no lee directamente tablas de Access, Assets o Inspections.

El alcance automático es `assetScope=all-site-assets`: todos los equipos de esa sede, incluidos los que se registren durante la ventana y según su fecha de alta. Los equipos `out_of_service` siguen formando parte del inventario. La descripción de alcance no filtra las métricas por tipo o por equipo. Esta versión no ofrece selección parcial de activos.

## Rutas

Todas las rutas siguientes son relativas a `/api/v1/sites/{siteId}` y las respuestas usan `Cache-Control: no-store`.

| Método y ruta | Comportamiento |
| --- | --- |
| `GET /pilot` | Devuelve contexto autorizado de sede, clasificación prevista, fechas de inicio admisibles, `latestBaselineWeekStartDate` y `enrollment` con el borrador/inscripción existente o `null`. No crea registros. |
| `PUT /pilot` | Guarda la representación completa de un borrador, condicionada por `expectedRevision`. Devuelve el borrador canónico. |
| `POST /pilot/enrollment` | Confirma la revisión guardada y las tres declaraciones explícitas. Devuelve la inscripción canónica, incluida en reintentos válidos. |

Las respuestas válidas son `200`. No hay ruta para editar una inscripción confirmada, cancelar, reiniciar o renovar el piloto desde esta interfaz. Existe un único piloto por organización/sede. Reconfirmar devuelve el original cuando corresponde; no crea otras cuatro semanas.

El [contrato de revisiones semanales](pilot-weekly-reviews.md) añade rutas y registros separados a partir de esa inscripción, sin modificar su línea base o sus acuerdos. La exportación del dueño conserva cohorts/baselines y añade `reviews` con agregados confirmados; el observador nuevo acepta también la entrega anterior sin ese campo. Los textos y actores de las revisiones permanecen privados y los snapshots operacionales se conservan por separado.

## Borrador y validación

La primera escritura usa `expectedRevision=0`. Una lectura devuelve la revisión vigente, que se debe enviar al guardar o confirmar. El cuerpo de `PUT` admite exactamente `expectedRevision`, `startDate`, `scope`, `goals` y `baseline`; se rechazan campos desconocidos, también en objetos anidados. El JSON decodificado tiene un máximo de 16 KiB.

| Campo | Regla al confirmar |
| --- | --- |
| `startDate` | Fecha local `YYYY-MM-DD` válida, desde mañana hasta 90 días después de hoy en la zona de la sede, ambos inclusive. El servidor vuelve a comprobar el rango al confirmar. |
| `scope.description` | Texto recortado de 1 a 500 caracteres. |
| `scope.assetScope` | Exactamente `all-site-assets`. |
| `scope.coordinators` | Entero de 1 a 1000, declarado por quien inscribe. |
| `scope.technicians` | Entero de 0 a 1000, declarado por quien inscribe. |
| `goals.onTimeRateTarget` | Número finito entre 0 y 1. La app presenta el objetivo como porcentaje. |
| `goals.minimumDueInspections` | Entero de 1 a 100000. Es un objetivo de volumen; no acredita actividad realizada. |
| `baseline.weekStartDate` | Fecha local de inicio de un periodo de siete días completos. Debe ser igual o anterior a `latestBaselineWeekStartDate`, calculada por el servidor como hoy local menos siete días. El fin exclusivo es inicio más siete días locales. |
| `baseline.historyProtocol` | Texto recortado de 1 a 1000 caracteres que permite repetir la consulta al terminar. |
| `baseline.historyAttempts` | Entre 1 y 30 intentos declarados, cada uno con `success` booleano y `seconds` numérico finito entre 0 y 86400. |
| `baseline.effortMinutes` | `preparation`, `recording` y `assistance`, cada uno numérico finito entre 0 y 10080 minutos. |
| `baseline.noteUsefulnessCriterion` | Texto recortado de 1 a 1000 caracteres. Define el criterio de utilidad; no evalúa por sí solo ninguna nota. |

En un borrador se permiten textos y fechas vacíos —incluido `baseline.weekStartDate=''`—, números `null`, intentos sin decidir con `success=null` o `seconds=null`, y una lista de intentos vacía. Las claves del esquema siguen siendo obligatorias. Confirmar exige completar los valores; no se sustituyen faltantes por cero. Los ceros son válidos cuando se introducen expresamente, por ejemplo, cero minutos de ayuda. No precargar resultados de ejemplo como observaciones reales.

El periodo de línea base y el comienzo del piloto son fechas distintas. La línea base abarca `[weekStartDate, weekStartDate + 7 días)` en la zona de la sede y debe estar completa al comenzar el día local de confirmación: su fin exclusivo puede coincidir con la medianoche de hoy. No se exige que empiece en lunes ni se añaden límites de antigüedad distintos de la fecha válida del contrato. Los intentos y minutos declarados deben corresponder a esa semana completa. Si las observaciones se están recogiendo ahora, se puede guardar un borrador y confirmarlo cuando haya concluido el periodo, revisando también la fecha futura del piloto.

La zona queda guardada con el borrador. Si el contexto autorizado de la sede cambia antes de confirmar, la operación devuelve `409`; se debe revisar y guardar de nuevo con el contexto actual. Un borrador con inicio que ya no esté dentro del rango debe corregirse antes de la inscripción.

## Confirmación y trazabilidad

El cuerpo de `POST /pilot/enrollment` admite únicamente:

```json
{
  "expectedRevision": 1,
  "agreements": {
    "realOperation": true,
    "authority": true,
    "measurement": true
  }
}
```

Es la estructura del contrato, no evidencia de que alguien haya aceptado. Los tres valores deben ser booleanos `true`, introducidos mediante una acción explícita. Pilot confirma los datos de esa revisión guardada, no otros campos enviados en el mismo POST. La app guarda antes las modificaciones válidas y utiliza la revisión devuelta; un error al guardar impide confirmar una versión anterior inadvertidamente.

El servidor conserva `agreementVersion=pilot-enrollment-v1`, las declaraciones, el primer actor de confirmación y `agreedAt` UTC. Genera un código estable `pilot-<24 hex>` a partir de organización/sede. Las fechas `createdAt` y `updatedAt`, el actor original y la revisión también son del servidor. La confirmación guarda atómicamente el registro privado y su fila mínima para el observador.

La clasificación es del servidor: development y testing siempre producen `technical`. En producción, una pertenencia marcada administrativamente como `dataClass=technical` sigue siendo técnica; las demás inscripciones confirmadas se clasifican `enrolled-real`. El marcador sólo procede de Access, no de atributos de registro, cuerpo HTTP ni nombres que contengan “prueba”. Su uso permite verificar el recorrido con fixtures de procedencia controlada sin crear demanda aparente.

`enrolled-real` identifica una inscripción explícita declarada por la persona coordinadora en producción. No verifica de forma independiente sus respuestas, ni demuestra uso, mejora, compra o aceptación de precio. `plan=pilot` de la organización sigue siendo un dato diferente de esta inscripción.

## Concurrencia, reintentos y estados

Pilot usa revisiones y huellas del contenido normalizado para conservar el primer resultado. No requiere el encabezado `Idempotency-Key` empleado por Assets e Inspections.

- Repetir un guardado con la revisión previa y el mismo contenido devuelve el borrador persistido si sigue siendo esa misma escritura. Contenido distinto o una edición posterior producen `409 pilot_revision_conflict`.
- Dos confirmaciones de una misma revisión conservan una inscripción y la primera fecha del acuerdo. La revisión confirmada queda referenciada como `confirmedFromRevision`.
- Repetir la confirmación con esa revisión original devuelve la inscripción, incluso cuando el inicio ya haya pasado. La comprobación de reintento ocurre antes de validar una nueva fecha de inicio.
- Tras confirmar, un PUT devuelve `409 pilot_already_enrolled`. Otra revisión de confirmación también produce conflicto. No reintentar guardando un borrador sobre una inscripción cuya respuesta se haya perdido: repetir primero el POST original.
- Si otro guardado gana mientras se confirma, la condición de la transacción impide publicar una fila de cohorte con datos obsoletos.

Las lecturas del registro son consistentes. Los conflictos transitorios de la transacción tienen reintentos acotados; no generan una nueva fecha de evidencia. Los errores inesperados devuelven `500 internal_error`, sin texto de protocolo, actores o mensajes internos.

## Almacenamiento y exportación privada

`infra/services/pilot.yaml` define el quinto stack de aplicación: tabla DynamoDB bajo demanda, cifrada, con PITR y conservación, API y exportador con roles separados, logs de 14 días y dos alarmas de error.

| Fila en PilotTable | Claves | Contenido |
| --- | --- | --- |
| Borrador/inscripción privada | `pk=ORG#<orgId>#SITE#<siteId>`, `sk=PILOT` | Alcance, protocolo, intentos declarados, criterio, objetivos, contexto y trazabilidad de actores. |
| Índice de cohortes confirmadas | `pk=PILOT#REGISTRY`, `sk=COHORT#<code>` | Cohorte canónica y resumen numérico de línea base, sin textos libres ni actores. |

La fila de índice sólo aparece al confirmar. Ambas escrituras pertenecen a una transacción de la misma tabla. No se escriben datos de otros servicios ni se modifica el registro administrativo S3.

El exportador no tiene rutas HTTP ni permisos de escritura. Su rol sólo permite `Query` sobre `PilotTable` con `dynamodb:LeadingKeys=PILOT#REGISTRY`. El observador puede invocar esa función exacta, sin poder invocar la API de inscripción ni leer directamente el registro privado de Pilot.

El único evento admitido por el exportador es `{ "internalAction": "exportPilotRegistry" }` mediante IAM. Rechaza eventos con forma HTTP o campos adicionales. Devuelve `schemaVersion`, `cohorts` y `baselines` mediante consulta consistente y paginada; falla ante exportaciones parciales, cursores inválidos o límites excedidos.

Cada resumen de línea base conserva `source=participant-declared`, `capturedAt`, `period`, intentos, éxitos, fallos, mediana de segundos de los éxitos, minutos por categoría, personas declaradas por rol y `qualityCriterionCaptured`. `period` contiene `startDate`, `endDateExclusive` —inicio más siete días— y `timeZone` del contexto autorizado; el navegador no elige el fin ni la zona del periodo. Los límites son días locales y no una suposición de 168 horas UTC si hay cambio de horario.

`capturedAt` es la fecha UTC en que el servidor admite la línea base al confirmar la inscripción, separada de la semana de los intentos y minutos declarados. No es prueba de que el servidor haya observado esas actividades ni una fecha independiente de realización. Cero éxitos produce mediana `null`. Capturar el criterio no significa que una nota lo cumpla. Las personas del resumen proceden del alcance declarado del piloto; no miden usuarios activos durante la semana base y no existe `lastSeen` en esta medición.

Descripción, protocolo, criterio y valores de actor permanecen en Pilot y sólo se devuelven a coordinadores autorizados. No forman parte de la exportación ni de los informes S3. Los informes conservan la línea base declarada por separado de las métricas de semanas 1–4; no transforman una línea base capturada en mejora demostrada ni en esfuerzo semanal observado.

El observador combina la exportación con `<ambiente>/registry.json` administrativo sin reemplazarlo. Códigos o alcances duplicados producen un error y exigen resolver la migración; no se sobreescriben cortes congelados. Una confirmación posterior al instante de corte se difiere hasta la siguiente observación. Errores del exportador no se convierten en un registro vacío saludable.

No hay TTL ni borrado automático del registro privado del piloto. La retención de los informes S3 es independiente y se describe en el [runbook](../runbooks/piloto-metricas.md). Terminar cuatro ventanas no cancela la cuenta, renueva el piloto, inicia pagos ni elimina evidencia. Stripe permanece deshabilitado.
