# Observación privada del piloto de SedePulso

Esta guía permite retomar TASK-006 desde remoto. La instrumentación está implementada en código; su publicación, ejecución OIDC y persistencia en cada ambiente deben comprobarse con un run real antes de declararlas operativas. Stripe permanece deshabilitado. La observación no crea usuarios, operaciones, inspecciones ni participantes.

## Punto de partida y estado comercial

La lectura administrativa del 19 de noviembre de 2026, entre 23:23:06 y 23:23:17 UTC, encontró cero registros en las tablas Access, Assets e Inspections de producción mediante scans consistentes con `Select=COUNT`. Esto acredita cero organizaciones aprovisionadas, membresías, equipos e inspecciones persistidos en ese corte; no mide visitas ni cuentas Cognito sin confirmar. Este scan fue una comprobación puntual administradora y no forma parte del observador recurrente.

El registro privado inicial debe permanecer vacío:

```json
{ "schemaVersion": 1, "cohorts": [] }
```

Su resultado es `status=awaiting-participant`, `pilotWeek=null` y métricas comerciales sin observaciones. Un registro de producto con `plan=pilot`, un alta Cognito, un detector sano o cuatro semanas transcurridas en el calendario no acreditan un piloto real.

## Reanudar desde remoto

Usar el checkout de `LynxPardelle/mantenimiento-por-sede`, Node 24 y una sesión GitHub/AWS CLI previamente autorizada. No copiar access keys, tokens, archivos `.env` ni credenciales al repositorio, variables públicas o reportes. GitHub Actions obtiene credenciales temporales mediante OIDC.

En cada environment se necesitan estas variables de configuración, sin secretos:

| Variable | Valor esperado |
| --- | --- |
| `PILOT_OBSERVER_ROLE_ARN` | ARN del rol separado `sedepulso-pilot-<ambiente>-github` de la cuenta propia |
| `PILOT_REPORT_BUCKET` | `sedepulso-pilot-765932874577-us-east-1` |

El bootstrap de CI publica ambas variables. Antes de reconfigurarlo, revisar [CI/OIDC](ci-oidc.md), los cambios concretos y las protecciones del environment. La disponibilidad de variables o roles por sí sola no prueba una ejecución exitosa.

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

El workflow [.github/workflows/piloto.yml](../../.github/workflows/piloto.yml) define una observación diaria de producción a las **07:17 GMT-6** (`13:17 UTC`), además de ejecución manual. GitHub puede retrasar o saltar ejecuciones programadas: la expresión cron no acredita puntualidad ni entrega.

El heartbeat de Codex `sedepulso-seguimiento-del-piloto` está activo en este chat a las **08:00 GMT-6**. Revisa el último resultado, frescura y pendientes; depende de la aplicación local y de sus accesos, sin SLA. No sustituye al workflow ni crea semanas de uso o participantes.

En cada seguimiento comprobar:

1. Último run del workflow y su conclusión; ante fallo revisar fase y diagnóstico autorizado sin imprimir datos de operación.
2. `checkedAt` de `<ambiente>/reports/latest.json`: más de **26 horas** de antigüedad se informa como seguimiento desactualizado. Un run reciente sin reporte privado válido tampoco acredita frescura.
3. Ambiente, `sourceCommit`, `runId`, guardias `billingEnabled=false` y `signupEnabled=true`, stacks completos y tablas activas.
4. `operations.alarmStates` y `alarmNotificationsConfigured`. Una alarma `ALARM` o `INSUFFICIENT_DATA` hace fallar el observador después de guardar el reporte; no se interpreta como cero incidencias.
5. `status`, cohorte real explícita, semana y faltantes. Mientras no haya inscripción real, continuar preparación y salud técnica con `awaiting-participant`.

La lectura del 19 de noviembre a las 23:23:51 UTC encontró nueve alarmas propias de producción en `OK`, todas sin acciones de notificación. **Estado OK no equivale a avisos entregados.** El observador comunica el fallo mediante la conclusión de GitHub Actions; no envía correos ni incorpora destinatarios. Las notificaciones de GitHub dependen de la configuración de la cuenta y su entrega no está comprobada por este código.

## Contrato del registro privado e inscripción

El contrato estricto está en [infra/pilot/metrics.mjs](../../infra/pilot/metrics.mjs). La [plantilla pública](../producto/piloto-registro.example.json) contiene una cohorte `technical`, identificadores inexistentes y metas ficticias; sirve para entender y validar el formato. No cargarla como participante ni convertirla automáticamente a `enrolled-real`.

Cada entrada permite únicamente:

| Campo | Regla |
| --- | --- |
| `code` | Código anónimo estable, minúsculas y guiones; único, hasta 64 caracteres |
| `orgId`, `siteId` | Alcance exacto privado y existente; no nombres ni correos; una entrada por organización/sede |
| `timeZone` | Zona IANA explícita de la sede, validada por `Intl`; no inferirla del navegador ni del observador |
| `startDate` | Día local válido de inicio; cuatro ventanas consecutivas de siete días |
| `classification` | `technical` o `enrolled-real`; una cohorte real sólo se admite en producción |
| `agreedAt` | Instante ISO del acuerdo, sin retrofechar después del día local de inicio |
| `goals.onTimeRateTarget` | Proporción acordada entre 0 y 1 |
| `goals.minimumDueInspections` | Entero acordado mayor o igual a 1 |

`schemaVersion` debe ser `1`; `cohorts` es un array. Campos extra, códigos o ámbitos duplicados y formatos inválidos detienen el cálculo; un error no se convierte en reporte saludable vacío. No cambiar código, alcance, zona o inicio para reescribir la historia de una cohorte existente.

Antes de que una persona autorizada incorpore `enrolled-real`, debe existir evidencia privada de: operación real, alcance y sede consentidos, responsables por rol, permiso para tratar la evidencia mínima, fecha del acuerdo, zona e inicio, objetivos y volumen mínimo acordados, línea base y criterio de utilidad de notas. Conservar referencias anónimas a esa evidencia fuera del registro; el esquema no admite nombres, correos, notas, documentos de consentimiento ni campos adicionales.

El registro no se autorrellena a partir de actividad, `plan=pilot`, `signupSource=cognito`, nombres con “prueba” o conteos globales. Las ejecuciones técnicas sólo se clasifican con procedencia controlada. El rol observador puede leer el registro pero **no modificarlo**. La inscripción o corrección exige una identidad administrativa autorizada y revisión del alcance; no hay alta automática, contacto a terceros ni consentimiento presumido.

## Almacenamiento, privacidad y retención

El bucket `sedepulso-pilot-765932874577-us-east-1` se define privado, con bloqueo de acceso público, ownership del bucket, cifrado AES256, versionado y exigencia de TLS. No tiene entrega pública ni se usa como CDN. El bucket y su sustitución tienen política `Retain`.

| Objeto, relativo al bucket | Contenido y tratamiento |
| --- | --- |
| `<ambiente>/registry.json` | Registro privado del alcance explícito; sin expiración automática definida |
| `<ambiente>/reports/latest.json` | Última observación agregada; consume las semanas cerradas ya congeladas |
| `<ambiente>/reports/daily/<fecha-UTC>/<instante>-<runId>.json` | Observación de la ejecución con corte, procedencia y cobertura; creación condicional |
| `<ambiente>/reports/weekly/<code>/<startDate>/week-<N>.json` | Primera observación posterior al cierre de cada semana 1 a 4; creación condicional sin sobrescribir |

La retención automática se aplica exclusivamente a cada prefijo `<ambiente>/reports/`: versiones actuales expiran a los **180 días**, versiones no actuales a los **90 días**. Con versionado, expirar una versión actual no equivale a borrado definitivo inmediato de todas las versiones; su tratamiento sigue el ciclo de vida configurado. El registro queda retenido hasta una decisión explícita de su propietario. Estas reglas deben verificarse contra el bucket desplegado antes de prometer una política efectiva al participante.

La primera semana cerrada se escribe con precondición de ausencia. Si ya existe, el observador valida y reutiliza ese documento en los cálculos de `latest`, sin reemplazarlo por una reconstrucción posterior. Es un congelado a nivel de aplicación, **no S3 Object Lock ni un almacén inalterable**. Una corrección posterior requiere evidencia privada y procedimiento explícito; no borrar o sobreescribir un cierre para mejorar resultados.

El colector proyecta únicamente claves técnicas necesarias, estado y fechas. La presencia de nota/autor se evalúa en DynamoDB con filtros; **el texto de nota y el valor de autor no salen de DynamoDB**. Los identificadores de equipo e inspección se usan sólo en memoria para relacionar datos; los reportes persistidos contienen agregados y códigos anónimos. El registro sigue siendo sensible por su asociación al tenant y nunca se publica.

## Permisos y límite de servicio

Cada ambiente tiene un rol OIDC operacional separado, `sedepulso-pilot-<ambiente>-github`. Su confianza se limita al subject inmutable del repositorio y al environment autorizado. Las restricciones de rama del environment siguen siendo necesarias.

El observador recibe consultas `dynamodb:Query` sobre tablas Assets e Inspections propias del ambiente y `DescribeTable` para Access, Assets e Inspections. Descubre outputs de los cuatro stacks propios, observa alarmas en la región y lee el registro/reportes del prefijo propio. Sólo puede escribir reportes cifrados en su prefijo; no puede actualizar el registro ni borrar objetos.

No recibe `Scan`, escrituras DynamoDB, acceso a usuarios Cognito, Stripe ni despliegues. Las consultas seleccionan cohortes y sedes explícitas; el rol operacional conserva alcance sobre ambas tablas del ambiente y el límite por cohorte lo aplica el colector. No presentar esto como aislamiento IAM por participante.

Las Lambdas del producto mantienen sus roles y sus límites por servicio. El observador administrativo no introduce lecturas entre tablas en el runtime de Access, Assets o Inspections.

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

Se agregan numeradores y denominadores, separados para `enrolled-real` y `technical`. No se promedian porcentajes. Una razón sin denominador tiene `rate=null`: informar “sin observaciones”, no 0 % ni 100 %. Un dato no observado conserva `null`; no sustituirlo por cero. La participación explícita y el mínimo de observaciones se revisan antes de comparar una meta.

Los equipos y programaciones nuevos incorporan `createdAt` UTC del servidor. El cliente no puede asignarlo; los reintentos idempotentes conservan el valor original. La instrumentación es prospectiva: registros anteriores sin esa fecha permanecen como cobertura limitada, sin backfill ni inferencia del ULID. `completedAt` corresponde al primer cierre y se conserva al reintentar. No existe un `updatedAt` general con el que reconstruir estados históricos.

Las consultas son consistentes individualmente pero no una instantánea atómica entre tablas; el reporte registra inicio y fin de lectura. Un cierre concurrente o un dato legacy puede limitar la reconstrucción, incluso en la primera observación posterior al límite. La presencia de `createdAt` no acredita un historial de todas las modificaciones posibles.

`operations.tableMetadata.*.approximateItems` procede de `DescribeTable`: DynamoDB actualiza esa metadata aproximadamente cada seis horas. **No es un conteo de clientes, personas activas, equipos o inspecciones:** puede incluir membresías, metadatos, idempotencia y pruebas no clasificadas. No compararlo como si fuera el Scan consistente de la línea base.

`collectorReadCapacityUnits` mide capacidad de lectura consumida por el colector; no es el coste AWS total. Costes, esfuerzo humano, consultas de historial, utilidad de notas y aceptación comercial permanecen en `unmeasured` hasta incorporar evidencia privada con el método acordado en [piloto operativo](../producto/piloto-operativo.md).

## Plantilla privada: semana 0 a semana 4

Copiar esta estructura a una bitácora privada fuera del repositorio. Es una plantilla vacía, no evidencia de cliente ni entrada adicional para `registry.json`. Usar códigos anónimos; `pendiente` o `null` significa sin medir, nunca cero.

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
