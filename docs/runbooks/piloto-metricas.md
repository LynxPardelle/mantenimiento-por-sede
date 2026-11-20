# Observación privada del piloto de SedePulso

Esta guía permite retomar TASK-006 desde remoto. La entrega anterior del observador se conserva en su [cierre técnico](../releases/2026-11-19-piloto.md). La inscripción desde la app, quinto stack Pilot y exportación de línea base están publicados y verificados en los tres ambientes: [cierre de onboarding](../releases/2026-11-19-onboarding-piloto.md). Stripe permanece deshabilitado. El observador conserva sólo lectura de negocio: la inscripción es una acción explícita del coordinador en la API de Pilot.

## Punto de partida y estado comercial

La lectura administrativa del 19 de noviembre de 2026, entre 23:23:06 y 23:23:17 UTC, encontró cero registros en las tablas Access, Assets e Inspections de producción mediante scans consistentes con `Select=COUNT`. Esto acredita cero organizaciones aprovisionadas, membresías, equipos e inspecciones persistidos en ese corte; no mide visitas ni cuentas Cognito sin confirmar. Este scan fue una comprobación puntual administradora y no forma parte del observador recurrente.

El registro administrativo privado se creó vacío y se conserva si no hay inscripciones administrativas:

```json
{ "schemaVersion": 1, "cohorts": [] }
```

Las inscripciones de la app se guardan en Pilot y no requieren editar este archivo S3. No reinicializarlo ni reemplazar entradas existentes para adoptar la nueva fuente. Con ambas fuentes sin cohortes reales el resultado es `status=awaiting-participant`, `pilotWeek=null` y métricas comerciales sin observaciones. Un registro de producto con `plan=pilot`, un alta Cognito, un detector sano o cuatro semanas transcurridas en el calendario no acreditan un piloto real.

## Inscripción desde la app

TASK-021 añade [revisiones semanales desde la app](../contracts/pilot-weekly-reviews.md), publicadas y verificadas en los tres ambientes. Desde una inscripción confirmada, abrir «Revisiones semanales y comparación», elegir semana y registrar hallazgos/siguiente acción. Se puede guardar desde su inicio y confirmar después del fin exclusivo local. No reescribe la inscripción ni los snapshots operacionales; una captura tardía aparece como revisión declarada separada del corte automático original.

Cada revisión puede conservar consultas y esfuerzo sin medir; los ceros sólo se introducen si se observaron. Repetir especialmente las consultas de historial al cerrar la semana cuatro. Declarar si se mantuvo el mismo alcance y método para habilitar las diferencias. La tasa de notas útiles usa numerador/denominador de esa semana; la línea base no contiene una tasa anterior de calidad. El exportador omite hallazgos, siguiente acción, intentos individuales y actores, y el informe conserva los faltantes globales que sigan sin evidencia.

La persona coordinadora abre la pantalla del piloto, elige una sede asignada y captura alcance, participantes por rol, objetivos y línea base. Puede guardar un borrador incompleto y retomarlo. Confirmar exige datos completos y declaraciones explícitas de operación real, autoridad y acuerdo de medición. La app guarda primero los cambios válidos y confirma la revisión devuelta; guardar no equivale a inscribir.

El alcance automático es toda la sede (`all-site-assets`), incluidas altas durante la ventana según su fecha. El inicio debe ser entre mañana y 90 días después de hoy en la zona de la sede. Cada organización/sede tiene un único piloto, cuya inscripción final se conserva sin editar. Esta versión no ofrece cancelación o renovación en la interfaz; un reintento no renueva cuatro semanas. Véase el [contrato HTTP y de datos](../contracts/pilot-enrollment.md).

El servidor fija organización/sede autorizadas, zona, código, actor y fecha del acuerdo; el navegador no envía esos privilegios. Development/testing y las pertenencias marcadas como técnicas por Access permanecen `technical`, incluso si se ensaya toda la confirmación. El marcador técnico es administrativo y no se deduce del nombre ni se acepta desde la interfaz.

La línea base recoge una semana expresa de siete días completos, método de consulta, uno a treinta intentos con éxito/fallo y segundos, minutos de preparación/registro/ayuda del periodo y criterio de nota útil. `baseline.weekStartDate` puede quedar vacío en borrador; confirmar exige una fecha no posterior a `latestBaselineWeekStartDate` —hoy local menos siete días—, devuelta por el servidor. El fin exclusivo es inicio más siete días en la zona autorizada. Si la semana aún no ha terminado, conservar el borrador y confirmar después del cierre, revisando el inicio futuro del piloto.

Campos vacíos no se convierten en cero; los ceros válidos deben introducirse expresamente. Cero búsquedas exitosas produce mediana `null`, no cero segundos. Personas declaradas por rol no son usuarios activos ni una lectura de `lastSeen`. La fecha de inicio del piloto no sustituye el periodo de su línea base ni permite atribuir minutos sin periodo.

## Reanudar desde remoto

Usar el checkout de `LynxPardelle/mantenimiento-por-sede`, Node 24 y una sesión GitHub/AWS CLI previamente autorizada. No copiar access keys, tokens, archivos `.env` ni credenciales al repositorio, variables públicas o reportes. GitHub Actions obtiene credenciales temporales mediante OIDC.

En cada environment se necesitan estas variables de configuración, sin secretos:

| Variable | Valor esperado |
| --- | --- |
| `PILOT_OBSERVER_ROLE_ARN` | ARN del rol separado `sedepulso-pilot-<ambiente>-github` de la cuenta propia |
| `PILOT_REPORT_BUCKET` | `sedepulso-pilot-765932874577-us-east-1` |

El bootstrap de CI publica ambas variables. Antes de reconfigurarlo, revisar [CI/OIDC](ci-oidc.md), los cambios concretos y las protecciones del environment. La disponibilidad de variables o roles por sí sola no prueba una ejecución exitosa.

La nueva entrega añade el stack `sedepulso-<ambiente>-pilot` y los outputs `PilotFunctionName`, `PilotExportFunctionName` y `PilotTableName`. El bootstrap debe autorizar el quinto stack y la invocación del exportador de ese ambiente antes de comprobar el nuevo observador. No conceder al observador invocación de `PilotFunction`: esa función atiende escrituras de onboarding y tiene un rol distinto del exportador.

Después de aplicar ese bootstrap, una sesión administrativa autorizada puede preparar únicamente los registros vacíos que aún falten:

```powershell
node infra/tools/initialize-pilot.mjs
```

El inicializador verifica cuenta, bucket obtenido del stack y propietario esperado. Usa creación condicional `If-None-Match: *` para los tres objetos `<ambiente>/registry.json`: puede repetirse y conserva cualquier registro existente sin reemplazarlo. No inscribe participantes ni carga el ejemplo técnico público. El rol observador carece de permiso para esta inicialización.

Para comprobar el código local sin consultar datos de clientes:

```powershell
node --test infra/pilot/*.test.mjs
node --test infra/ci/pilot.test.mjs
```

Para solicitar una observación remota de producción, una vez publicado el workflow en `main` y configurada la infraestructura:

```powershell
gh workflow run piloto.yml --repo LynxPardelle/mantenimiento-por-sede --ref main -f environment=production
gh run list --repo LynxPardelle/mantenimiento-por-sede --workflow piloto.yml --limit 5
```

Para development o testing usar como `--ref` y `environment` la rama y el ambiente homónimos. Producción sólo se ejecuta desde `main`. Conservar el flujo de elevación `development → testing → main`.

Una ejecución local autorizada usa la sesión AWS CLI existente y guarda los mismos reportes privados; no es una simulación sin escrituras:

```powershell
$env:PILOT_REPORT_BUCKET = 'sedepulso-pilot-765932874577-us-east-1'
node --use-system-ca infra/tools/observe-pilot.mjs --environment production
```

No ejecutar con `--debug`, volcar la respuesta del colector ni publicar reportes como artefactos de este repositorio público. El mensaje público de éxito sólo confirma ambiente, guardia de facturación y persistencia privada; no muestra conteos de participantes ni datos de las cohortes. Para inspeccionar `latest.json`, descargarlo mediante una identidad autorizada a una ubicación privada fuera del checkout y revisar allí los agregados, nunca el registro con identificadores en logs de Actions.

## Programación y seguimiento

El workflow [.github/workflows/piloto.yml](../../.github/workflows/piloto.yml) define dos observaciones diarias de producción: el corte principal a las **07:17 GMT-6** (`13:17 UTC`) y el respaldo a las **15:57 GMT-6** (`21:57 UTC`), además de ejecución manual. Ambos usan el mismo rol observador, conservan los snapshots semanales y serializan sus escrituras sin cancelar otra observación. GitHub puede retrasar o saltar ejecuciones programadas: la expresión cron no acredita puntualidad ni entrega.

Para acreditar la programación, consultar `gh run list --workflow piloto.yml --event schedule` y verificar un run exitoso de `main`. Su SHA y número de intento deben coincidir con `sourceCommit` y `runId` del reporte privado. Un `workflow_dispatch`, incluso reciente y exitoso, sólo acredita la ejecución manual. Si no existe ningún run `schedule`, el problema precede al job: comprobar rama predeterminada, workflow activo, cron publicado antes del corte y permisos/estado del actor. La API no expone una causa interna del scheduler; no atribuir esa ausencia a OIDC o AWS sin un job fallido que lo demuestre.

El [cierre del 20 de noviembre](../releases/2026-11-20-observador-programado.md) conserva el primer `schedule` exitoso con recibo privado y lo separa del respaldo nuevo, que seguía pendiente de observación al corte documentado. Para actualizar ese estado exigir un run programado real y su reporte coincidente; la publicación del YAML no sustituye esa evidencia.

El heartbeat de Codex `sedepulso-seguimiento-del-piloto` está activo en este chat a las **08:00 GMT-6**. Revisa el último resultado, frescura y pendientes; depende de la aplicación local y de sus accesos, sin SLA. No sustituye al workflow ni crea semanas de uso o participantes.

Su prompt se actualizó mediante la herramienta de automatizaciones durante TASK-021: conserva horario, chat y estado activo, y ahora comprueba cinco stacks, once alarmas y `weeklyReviews` junto a sus comparaciones. Distingue estas declaraciones de los snapshots automáticos, conserva faltantes y no escribe mediciones o participantes inventados.

TASK-022 actualiza ese mismo heartbeat para revisar el último `schedule` exitoso de forma independiente. Su ausencia o antigüedad mayor de 26 horas se informa aunque un run manual o de publicación haya dejado un reporte fresco. Conserva el horario y las demás guardas; no crea otra automatización ni convierte el heartbeat local en una prueba del scheduler de GitHub.

En cada seguimiento comprobar:

1. Último run del workflow y último run exitoso con `event=schedule`, por separado. Si no existe el programado o supera 26 horas, informar la ausencia aunque haya una ejecución manual reciente. Ante fallo revisar fase y diagnóstico autorizado sin imprimir datos de operación.
2. `checkedAt` de `<ambiente>/reports/latest.json`: más de **26 horas** de antigüedad se informa como seguimiento desactualizado. Un run reciente sin reporte privado válido tampoco acredita frescura.
3. Ambiente, `sourceCommit`, `runId`, guardias `billingEnabled=false` y `signupEnabled=true`, cinco stacks completos y las tablas monitorizadas activas. La metadata de tablas del observador sigue limitada a Access, Assets e Inspections; no obtiene registros privados de Pilot.
4. `operations.alarmStates` y `alarmNotificationsConfigured`. Una alarma `ALARM` o `INSUFFICIENT_DATA` hace fallar el observador después de guardar el reporte; no se interpreta como cero incidencias.
5. `status`, cohorte real explícita, semana y faltantes. Mientras no haya inscripción real, continuar preparación y salud técnica con `awaiting-participant`.

La lectura del 19 de noviembre a las 23:23:51 UTC encontró nueve alarmas propias de producción en `OK`, todas sin acciones de notificación. **Estado OK no equivale a avisos entregados.** El observador comunica el fallo mediante la conclusión de GitHub Actions; no envía correos ni incorpora destinatarios. Las notificaciones de GitHub dependen de la configuración de la cuenta y su entrega no está comprobada por este código.

El stack Pilot añade dos alarmas, para la API y su exportador: el conjunto publicado y verificado es de once por ambiente. La observación descubre los nombres de las cinco pilas y confirma que todas las alarmas solicitadas aparecen; el antiguo recuento de nueve sólo describe la entrega histórica.

## Fuentes privadas y contrato de cohortes

El observador combina dos fuentes independientes sin escrituras de negocio:

| Fuente | Autoridad y contenido |
| --- | --- |
| `<ambiente>/registry.json` en S3 | Registro administrativo existente, conservado sin reemplazar. Mantiene su contrato y permisos de edición administrativos. |
| Exportador IAM del servicio Pilot | Cohortes confirmadas desde la app y un resumen numérico de línea base por cohorte. No exporta borradores ni textos libres. |

Pilot confirma en una transacción el registro privado por organización/sede y una fila mínima de índice en su misma tabla. El exportador consulta de forma consistente `PILOT#REGISTRY`, con paginación explícita y límites que fallan de forma cerrada. Su evento IAM es `{ "internalAction": "exportPilotRegistry" }`; no tiene rutas HTTP. El observador valida `schemaVersion`, cohortes, relación uno a uno con las líneas base y campos permitidos antes de incorporar datos.

Una fuente incompleta, un fallo de invocación o un conflicto de código/alcance no se convierten en registro vacío ni se resuelven sobrescribiendo entradas. Un conflicto requiere revisar la migración y conservar sus referencias y cortes anteriores. Si una confirmación concurre después de `checkedAt`, se difiere a una observación posterior y se cuenta en `operations.deferredApplicationEnrollments`; no se declara que nunca existió.

El contrato estricto está en [infra/pilot/metrics.mjs](../../infra/pilot/metrics.mjs). La [plantilla pública](../producto/piloto-registro.example.json) contiene una cohorte `technical`, identificadores inexistentes y metas ficticias; sirve para entender y validar el formato. No cargarla como participante ni convertirla automáticamente a `enrolled-real`.

Cada entrada permite únicamente:

| Campo | Regla |
| --- | --- |
| `code` | Código de cohorte estable sin nombres, minúsculas y guiones; único, hasta 64 caracteres |
| `orgId`, `siteId` | Alcance exacto privado y existente; no nombres ni correos; una entrada por organización/sede |
| `timeZone` | Zona IANA explícita de la sede, validada por `Intl`; no inferirla del navegador ni del observador |
| `startDate` | Día local válido de inicio; cuatro ventanas consecutivas de siete días |
| `classification` | `technical` o `enrolled-real`; una cohorte real sólo se admite en producción |
| `agreedAt` | Instante ISO del acuerdo, sin retrofechar después del día local de inicio |
| `goals.onTimeRateTarget` | Proporción acordada entre 0 y 1 |
| `goals.minimumDueInspections` | Entero acordado mayor o igual a 1 |

`schemaVersion` debe ser `1`; `cohorts` es un array. Campos extra, códigos o ámbitos duplicados y formatos inválidos detienen el cálculo; un error no se convierte en reporte saludable vacío. No cambiar código, alcance, zona o inicio para reescribir la historia de una cohorte existente.

La confirmación de la app conserva el alcance y la línea base declarados, las tres declaraciones explícitas, su versión y el actor verificado en Pilot. La clasificación `enrolled-real` de producción expresa esa inscripción del coordinador; no verifica de forma independiente sus respuestas ni demuestra uso, mejora o aceptación de precio. Para una inscripción administrativa siguen siendo necesarias las evidencias privadas de alcance, autoridad, acuerdo, fechas, objetivos y línea base. Conservar referencias sin datos personales fuera del registro S3; su esquema no admite nombres, correos, notas ni campos adicionales.

Ninguna fuente se autorrellena a partir de actividad, `plan=pilot`, `signupSource=cognito`, nombres con “prueba” o conteos globales. Las ejecuciones técnicas sólo se clasifican con procedencia controlada. El observador puede leer ambas fuentes pero **no modificarlas**. La edición del registro S3 sigue requiriendo identidad administrativa; el onboarding de la app requiere coordinador autorizado y su confirmación explícita. No hay alta por una mera visita, contacto a terceros ni consentimiento presumido.

## Almacenamiento, privacidad y retención

El bucket `sedepulso-pilot-765932874577-us-east-1` se define privado, con bloqueo de acceso público, ownership del bucket, cifrado AES256, versionado y exigencia de TLS. No tiene entrega pública ni se usa como CDN. El bucket y su sustitución tienen política `Retain`.

| Ubicación privada o clave del bucket | Contenido y tratamiento |
| --- | --- |
| `<ambiente>/registry.json` | Registro privado del alcance explícito; sin expiración automática definida |
| Datos privados en `PilotTable`, fuera de S3 | Borrador/inscripción, descripción, protocolo, criterio, intentos y trazabilidad. Sólo API de coordinadores; conservación y PITR, sin TTL de piloto. |
| `<ambiente>/reports/latest.json` | Última observación agregada; consume las semanas cerradas ya congeladas |
| `<ambiente>/reports/daily/<fecha-UTC>/<instante>-<runId>.json` | Observación de la ejecución con corte, procedencia y cobertura; creación condicional |
| `<ambiente>/reports/weekly/<code>/<startDate>/week-<N>.json` | Primera observación posterior al cierre de cada semana 1 a 4; creación condicional sin sobrescribir |

La retención automática se aplica exclusivamente a cada prefijo `<ambiente>/reports/`: versiones actuales expiran a los **180 días**, versiones no actuales a los **90 días**. Con versionado, expirar una versión actual no equivale a borrado definitivo inmediato de todas las versiones; su tratamiento sigue el ciclo de vida configurado. El registro queda retenido hasta una decisión explícita de su propietario. Estas reglas deben verificarse contra el bucket desplegado antes de prometer una política efectiva al participante.

La primera semana cerrada se escribe con precondición de ausencia. Si ya existe, el observador valida y reutiliza ese documento en los cálculos de `latest`, sin reemplazarlo por una reconstrucción posterior. Es un congelado a nivel de aplicación, **no S3 Object Lock ni un almacén inalterable**. Una corrección posterior requiere evidencia privada y procedimiento explícito; no borrar o sobreescribir un cierre para mejorar resultados.

El colector proyecta únicamente claves técnicas necesarias, estado y fechas. La presencia de nota/autor se evalúa en DynamoDB con filtros; **el texto de nota y el valor de autor no salen de DynamoDB**. Los identificadores de equipo e inspección se usan sólo en memoria para relacionar datos; los reportes persistidos contienen agregados y códigos de cohorte. El registro privado permite relacionar esos códigos con la organización y sede: no se presenta esta separación como anonimización irreversible. El registro sigue siendo sensible y nunca se publica.

La descripción del alcance, el protocolo de búsqueda, el criterio de nota útil y los valores de actor de la inscripción no salen de Pilot hacia el observador ni S3. `baselineMeasurement` sólo conserva la fuente `participant-declared`, el periodo expreso, fecha de captura y agregados. `period.startDate`, `period.endDateExclusive` y `period.timeZone` identifican siete días locales completos; el fin y la zona los deriva el servidor. `capturedAt` es el instante UTC de admisión al confirmar y no la fecha de observación independiente de las actividades. El criterio exportado es un booleano de presencia, no su texto ni una evaluación de calidad. Las consultas de seguimiento y el esfuerzo posterior continúan sin medir hasta contar con observaciones reales.

## Permisos y límite de servicio

Cada ambiente tiene un rol OIDC operacional separado, `sedepulso-pilot-<ambiente>-github`. Su confianza se limita al subject inmutable del repositorio y al environment autorizado. Las restricciones de rama del environment siguen siendo necesarias.

El observador recibe consultas `dynamodb:Query` sobre tablas Assets e Inspections propias del ambiente y `DescribeTable` para Access, Assets e Inspections. Descubre outputs de los cinco stacks propios, observa alarmas del ambiente y lee el registro/reportes del prefijo propio. Puede invocar únicamente el exportador Pilot, cuyo rol de sólo lectura limita `Query` a `dynamodb:LeadingKeys=PILOT#REGISTRY`. No tiene `Query` directo sobre Pilot ni permiso para invocar su API de escritura. Sólo puede escribir reportes cifrados en su prefijo; no puede actualizar el registro ni borrar objetos.

La lectura de alarmas está limitada al ARN `alarm:sedepulso-<ambiente>-*`; no incluye alarmas compuestas. El catálogo [IAM de CloudWatch](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudwatch.html) permite ese alcance para alarmas métricas.

El observador descubre los nombres físicos con `ListStackResources` en los cinco stacks propios y solicita `DescribeAlarms --alarm-names` con esos nombres exactos. La consulta por `--alarm-name-prefix` exige `alarm:*` en la autorización real; una prueba STS de la entrega anterior reprodujo el rechazo y comprobó los nombres explícitos con el ARN acotado. La nueva definición añade los dos nombres de Pilot al conjunto esperado de once. No ampliar el permiso global para resolver ese caso. Si falta una alarma solicitada, el reporte falla como incompleto.

No recibe `Scan`, escrituras DynamoDB, acceso a usuarios Cognito, Stripe ni despliegues. Las consultas seleccionan cohortes y sedes explícitas; el rol operacional conserva alcance sobre ambas tablas del ambiente y el límite por cohorte lo aplica el colector. No presentar esto como aislamiento IAM por participante.

Las Lambdas del producto mantienen sus roles y sus límites por servicio. El observador administrativo no introduce lecturas entre tablas en el runtime de Access, Assets o Inspections.

La API Pilot tiene `GetItem`/`PutItem` sólo sobre su tabla y puede invocar Access para autorizar. Las escrituras de inscripción y fila exportable son atómicas dentro de ese dominio. El exportador está separado para que su permiso IAM no pueda usarse para forjar una invocación HTTP a la función que escribe.

## Lectura correcta de las métricas

Las semanas usan medianoches locales de la zona registrada. El fin es exclusivo; los cierres ocurridos después no cambian la semana congelada. Las ventanas futuras no tienen mediciones. Las abiertas son provisionales y el denominador incluye todos los vencimientos de esa semana, también los aún pendientes.

| Métrica automática | Interpretación |
| --- | --- |
| `onTime` | Inspecciones debidas en la semana cerradas al corte y cuya fecha local de cierre no supera el vencimiento / todas las debidas en esa semana |
| `closedInPeriod`, `results` | Cierres dentro de la ventana y distribución `ok`, `attention`, `failed` |
| `structuralEvidence` | Cierres con resultado, nota no vacía, autor presente y fecha / todos los cierres del periodo; no mide utilidad semántica de la nota |
| `priorBacklog` | Vencimientos anteriores aún sin cierre al corte |
| `inventory` | Inventario observado por estado y cobertura temporal disponible |
| `coverage` | Observación faltante, fechas de alta desconocidas, fechas de cierre ausentes y límites de reconstrucción |
| `baselineMeasurement` | Resumen declarado en la inscripción, separado de semanas 1–4; `null` si la cohorte administrativa no dispone de esa captura |

Se agregan numeradores y denominadores, separados para `enrolled-real` y `technical`. No se promedian porcentajes. Una razón sin denominador tiene `rate=null`: informar “sin observaciones”, no 0 % ni 100 %. Un dato no observado conserva `null`; no sustituirlo por cero. La participación explícita y el mínimo de observaciones se revisan antes de comparar una meta.

Los equipos y programaciones nuevos incorporan `createdAt` UTC del servidor. El cliente no puede asignarlo; los reintentos idempotentes conservan el valor original. La instrumentación es prospectiva: registros anteriores sin esa fecha permanecen como cobertura limitada, sin backfill ni inferencia del ULID. `completedAt` corresponde al primer cierre y se conserva al reintentar. No existe un `updatedAt` general con el que reconstruir estados históricos.

Las consultas son consistentes individualmente pero no una instantánea atómica entre tablas; el reporte registra inicio y fin de lectura. Un cierre concurrente o un dato legacy puede limitar la reconstrucción, incluso en la primera observación posterior al límite. La presencia de `createdAt` no acredita un historial de todas las modificaciones posibles.

`operations.tableMetadata.*.approximateItems` procede de `DescribeTable`: DynamoDB actualiza esa metadata aproximadamente cada seis horas. **No es un conteo de clientes, personas activas, equipos o inspecciones:** puede incluir membresías, metadatos, idempotencia y pruebas no clasificadas. No compararlo como si fuera el Scan consistente de la línea base.

Referencias operativas: [actualización aproximada de ItemCount en DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TableDescription.html) y [límites de los eventos programados de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

`collectorReadCapacityUnits` mide sólo la capacidad de las consultas directas a Assets e Inspections. Excluye las lecturas del exportador de Piloto y las consultas de metadatos; no es el coste AWS total. Una línea base capturada conserva su periodo de siete días locales completos, intentos/éxitos/fallos, mediana de los éxitos, minutos y personas declaradas por rol. Cero éxitos tiene mediana `null`; un cero numérico válido refleja entrada explícita, no un faltante convertido. La fuente `participant-declared` y `capturedAt` no equivalen a observación independiente del servidor.

Cuando existe esa captura, `historyLookupBaseline` deja de figurar como ausente en esa cohorte. Esto no mide automáticamente cambios frente a la línea base, duración de búsquedas posteriores, esfuerzo semanal, actividad por persona, utilidad efectiva de notas, coste total o aceptación comercial. Esas variables permanecen sin medir hasta incorporar evidencia privada con el método del [piloto operativo](../producto/piloto-operativo.md). No interpretar la presencia de un criterio como resultado ni las personas declaradas como usuarios activos.

## Plantilla privada: semana 0 a semana 4

Copiar esta estructura a una bitácora privada fuera del repositorio. Es una plantilla vacía, no evidencia de cliente ni entrada adicional para `registry.json`. Usar códigos de cohorte sin nombres; `pendiente` o `null` significa sin medir, nunca cero.

| Sección | Campos por completar y evidencia mínima |
| --- | --- |
| Inscripción | `code`, referencia privada del alcance/consentimiento/acuerdo, rol decisor y responsable por rol, organización/sede exactas en acceso restringido, zona IANA, `agreedAt`, fecha local de inicio, fin exclusivo, inventario seleccionado, objetivos, volumen mínimo y criterio de nota útil |
| Semana 0 | Inicio/fin/corte y zona; método de consultas de historial; intentos, éxitos, fallos y segundos de cada resolución sin contenido; mediana base; minutos de preparación/registro/ayuda; criterio de calidad; personas agregadas por rol; referencias de evidencia; faltantes |
| Semana 1 | Fechas/corte; identificador privado de reporte; inventario/programaciones; razones con numerador/denominador; minutos de preparación/registro/ayuda; incidencias agregadas, bloqueos y observaciones reales sin hacer tareas por el participante |
| Semana 2 | Los mismos campos; repetición de uso; reintentos, historial y fricciones; necesidades declaradas y episodios que las sustentan; responsable y fecha de revisión |
| Semana 3 | Los mismos campos; uso autónomo observado; capacidad/personas/sedes/consulta; ayuda prestada y minutos separados; capacidad siguiente propuesta y evidencia pendiente |
| Semana 4 | Los mismos campos; repetir método base de historial; intentos/éxitos/fallos, segundos y mediana final; cambio frente a base con faltantes; utilidad de notas evaluada; esfuerzo final; objetivo y mínimo alcanzados o pendientes |
| Oferta y decisión | Referencia y versión de oferta, alcance ya disponible, unidad/cupos, precio/moneda/periodicidad/condiciones explícitos cuando se acuerden, fecha de presentación, respuesta del rol decisor, condiciones o rechazo, conclusión y siguiente revisión; si no hubo oferta, `no-presentada` |

Para evaluar calidad, guardar por periodo `cierresRevisados`, `notasQueCumplenCriterio`, criterio/versión y faltantes; revisar la nota dentro del producto y no copiar su texto. Para esfuerzo, conservar por separado minutos de preparación, registro y ayuda; dividir entre cierres sólo si existen y ambos valores están medidos. Para la oferta, una respuesta declarada no es una venta pagada y una solicitud de colaboración no es aceptación de precio.

Al finalizar cada revisión registrar `checkedAt`, código de cohorte, semana, referencia privada del cierre congelado, responsable por rol, conclusión provisional y siguiente fecha. No anticipar semanas, rellenar testimonios, enviar mensajes a terceros ni activar cobros. Decidir continuar, ampliar con alcance acordado, construir una capacidad o detener según evidencia; sin ella TASK-006 conserva pendiente su validación comercial.
