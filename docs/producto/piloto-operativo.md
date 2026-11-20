# Piloto operativo de SedePulso: cuatro semanas

Guía para TASK-006. La inscripción y captura de línea base desde la app están publicadas y verificadas en los tres ambientes: [cierre de onboarding](../releases/2026-11-19-onboarding-piloto.md). Esta guía no registra participantes, precio ni aceptación comercial. La ventana de una operación comienza en la fecha local acordada al inscribirse; las pruebas técnicas no cuentan como participantes.

## Inscribir una operación desde la app

La persona coordinadora abre la pantalla del piloto con su sesión y selecciona una sede asignada. Sólo los coordinadores de esa sede pueden consultar o modificar su onboarding. El [contrato de inscripción](../contracts/pilot-enrollment.md) describe la autorización y los límites de esta entrega.

1. Describir el alcance y declarar cuántas personas coordinadoras y técnicas participarán. La medición automática incluye todo el inventario de esa sede, también las altas que se realicen durante la ventana; la descripción no selecciona un subconjunto de equipos.
2. Elegir el inicio desde mañana hasta 90 días después de hoy, en la zona horaria de la sede. Indicar objetivo de puntualidad y volumen mínimo de inspecciones debidas.
3. Elegir una semana de línea base de siete días completos, ya terminada en la zona de la sede. Registrar el método repetible para buscar historial, uno a treinta intentos con éxito/fallo y segundos, minutos de preparación, registro y ayuda de ese periodo, y criterio de nota útil. Los campos numéricos empiezan sin observación; introducir cero sólo cuando se haya medido expresamente.
4. Guardar el borrador. Puede quedar incompleto y retomarse al recargar; ese guardado no inscribe una operación ni aparece en los informes de cohortes.
5. Revisar los datos y confirmar explícitamente que representan una operación real, que se tiene autoridad para inscribirla y que se acuerda la medición. La app guarda primero cualquier modificación válida y confirma la revisión devuelta por el servidor.

La fecha del acuerdo, el código, el contexto y la clasificación son del servidor. Development/testing y las pertenencias de prueba marcadas administrativamente por Access siguen siendo `technical`; el navegador no puede promoverlas a reales. En producción una inscripción normal confirmada queda `enrolled-real` como declaración del coordinador, sin demostrar uso o disposición de pago.

La inscripción final conserva alcance, objetivos y línea base. Esta versión admite un único piloto por organización/sede y no ofrece edición posterior, cancelación o renovación en la interfaz. Una respuesta perdida se recupera repitiendo la confirmación de la misma revisión; no se inicia otro periodo ni se modifica la evidencia original. Stripe permanece deshabilitado.

## Revisar cada semana desde la app

Las [revisiones semanales y comparación](../contracts/pilot-weekly-reviews.md) están publicadas y verificadas en los tres ambientes: [cierre de entrega](../releases/2026-11-19-revisiones-piloto.md). Desde el piloto inscrito, abrir «Revisiones semanales y comparación» y elegir una de sus cuatro ventanas. Las fechas y la zona quedan derivadas de la inscripción; se guarda desde el inicio de la semana y se confirma después de su fin exclusivo local.

Capturar hallazgos y siguiente acción. Añadir consultas medidas, minutos de preparación/registro/ayuda y notas evaluadas/útiles cuando exista esa observación; lo no medido permanece vacío. Declarar si se mantuvo el mismo alcance y método. Guardar el borrador para retomarlo; al confirmar, aceptar explícitamente que corresponde a la semana indicada y a los datos observados. La revisión confirmada queda conservada, con fecha de captura separada del periodo.

La comparación muestra medianas, tasas con conteos y variaciones de minutos cuando hay datos comparables. Si cambió el método, falta una medición, no hubo consultas exitosas o la base es cero para un porcentaje, conserva la ausencia de diferencia aplicable. Las notas útiles tienen tasa de esa semana, sin inventar una tasa base. Los cortes automáticos de inspecciones quedan intactos aunque se confirme tarde; las declaraciones aparecen en `weeklyReviews` por separado.

## Semana 0: preparar y fijar la comparación

Confirmar sede inicial, zona IANA, fechas, inventario incluido y cantidad declarada de personas por rol. El código se obtiene de la inscripción del servidor. Acordar revisiones reales, coordinación y decisión de compra a evaluar. Fijar previamente objetivos de mejora, volumen mínimo de observaciones y criterio de nota útil.

Verificar acceso, registro de equipo, programación, cierre e historial tras recargar el ambiente publicado. Empezar con Piloto individual y su sede inicial. Colaboración o sedes adicionales requieren aprovisionamiento administrativo autorizado; medir ese esfuerzo. Las invitaciones y el alta de sedes desde la aplicación están en diseño. No compartir cuentas.

Elegir una semana base de siete días locales completos y registrar cómo se encontró el último resultado de una muestra de equipos de la sede durante ese periodo: repetir al final las mismas consultas, consigna y puntos de inicio/fin. Su inicio máximo es hoy local menos siete días; el servidor calcula su fin exclusivo y conserva la zona autorizada. Registrar duración y fallos sin copiar el historial anterior. Si se empieza a medir ahora, guardar el borrador y esperar al cierre de la semana antes de inscribirse. Esta muestra fija el protocolo de búsqueda; las métricas automáticas siguen abarcando toda la sede.

## Bitácora mínima, sin datos personales

Recoger códigos de sede/equipo, tipo de equipo, semana, zona, vencimiento, estado, resultado y fecha UTC de cierre. Registrar si nota y autor están presentes y si la nota cumple el criterio acordado. Revisar la trazabilidad dentro de la aplicación; no copiar nombres, correos, identificadores de acceso, tokens ni notas que identifiquen personas.

Conservar la línea base y las revisiones semanales en Pilot mediante la app; la bitácora privada puede añadir evidencia complementaria sin sustituir los cortes guardados. No guardar información del participante en este repositorio público. La descripción, el protocolo, el criterio, los hallazgos y la siguiente acción quedan dentro del servicio Pilot para coordinadores autorizados; el exportador sólo comparte agregados. Separar operación real y pruebas; marcar faltantes sin sustituirlos por ceros.

## Instrumentación y seguimiento preparados

El cálculo del piloto y el colector operacional están implementados en `infra/pilot/`; `infra/tools/observe-pilot.mjs` comprueba salud, Stripe deshabilitado, stacks, tablas y alarmas antes de persistir agregados privados. La entrega anterior se conserva en su [cierre técnico](../releases/2026-11-19-piloto.md). La ampliación a cinco stacks, once alarmas e inscripción desde la app fue publicada y verificada en los tres ambientes; no acredita un piloto comercial en marcha.

El workflow `piloto.yml` define observación diaria de producción a las 07:17 GMT-6, con ejecución manual y rol OIDC separado del despliegue y del runtime del producto. El heartbeat local de este chat `sedepulso-seguimiento-del-piloto` está activo a las 08:00 GMT-6 para revisar resultados y pendientes, sin SLA. Cada revisión comprueba una frescura máxima de 26 horas. Fallos del observador aparecen en GitHub Actions; no se envían correos desde este flujo. Alarmas sin canal de notificación no prueban entrega de avisos.

La inscripción confirmada desde la app alimenta un exportador IAM de sólo lectura del servicio Pilot. El observador combina esa fuente con el registro administrativo S3 existente, inicialmente `{ "schemaVersion": 1, "cohorts": [] }`, sin reemplazarlo. Duplicados de código o alcance detienen el cálculo para resolverlos, sin reetiquetar cohortes ni sobrescribir cortes. Sin operación real inscrita el resultado permanece `awaiting-participant`; un inicio futuro acordado todavía no constituye una semana observada. El corte histórico de producción del 19 de noviembre de 2026 a las 23:23 UTC encontró cero registros persistidos en Access, Assets e Inspections; no permite inferir visitas ni interesados. `plan=pilot` y un alta de producto no sustituyen la inscripción explícita.

El observador consulta sólo las sedes inscritas y separa `technical` de `enrolled-real`. Los reportes se guardan en el bucket privado `sedepulso-pilot-765932874577-us-east-1`, nunca como artefactos públicos. La primera observación de una semana cerrada se congela sin sobrescribirla y se reutiliza en los reportes posteriores. Se definen 180 días para reportes actuales y 90 para versiones no actuales; el registro no tiene expiración automática. Verificar la política desplegada antes de comunicarla como efectiva.

Las altas de equipo y programaciones nuevas guardan `createdAt` UTC del servidor y los reintentos conservan el valor original. No se completa retrospectivamente la fecha de registros anteriores. Las lecturas entre tablas no son una instantánea atómica: mostrar cobertura y límites de reconstrucción. Los totales de metadata de DynamoDB son aproximados, se actualizan aproximadamente cada seis horas e incluyen idempotencia/pruebas; no son personas activas ni clientes.

La evidencia estructural automática comprueba presencia de resultado, nota, autor y fecha. El nuevo onboarding añade `baselineMeasurement` con `source=participant-declared`: periodo expreso de siete días locales completos, intentos, éxitos y fallos, mediana de segundos de los éxitos, minutos por categoría, personas declaradas y presencia del criterio. `capturedAt` identifica la admisión del registro al confirmar, no cuándo el servidor habría observado actividades; se conserva separado de `period.startDate`, `period.endDateExclusive` y `period.timeZone`. Cero éxitos produce mediana `null`. Esta captura es una línea base declarada, no una mejora demostrada ni una observación independiente del servidor.

La utilidad efectiva de las notas, las búsquedas y el esfuerzo de semanas posteriores, los costes y la respuesta a una oferta necesitan evidencia privada adicional. La cantidad de personas por rol no acredita usuarios activos y no hay `lastSeen` medido. No sustituir esas observaciones por actividad técnica ni extrapolar los minutos de la línea base a todas las semanas.

El [runbook de métricas](../runbooks/piloto-metricas.md) contiene comandos para retomar desde remoto, límites de permisos, cálculos, almacenamiento y plantilla privada de semanas 0 a 4. La [plantilla de registro](piloto-registro.example.json) es exclusivamente técnica, con identificadores y metas ficticios; no es un cliente ni debe inscribirse como `enrolled-real`.

## Semanas 1 a 4

| Momento | Acción y evidencia que debe quedar |
| --- | --- |
| Semana 1 | Cargar inventario y programar inspecciones manuales. Medir preparación y bloqueos. Cerrar inspecciones con notas útiles. |
| Semana 2 | Repetir la operación; revisar pendientes e historial. Registrar errores, reintentos y necesidades de colaboración. Una petición no acredita disposición de pago. |
| Semana 3 | Observar uso sin hacer el trabajo por el participante. Clasificar fricciones de capacidad, personas, sedes o consulta. Elegir la siguiente capacidad a probar. |
| Semana 4 | Repetir consultas de la línea base, calcular métricas y revisar evidencia con quien decide la compra. Registrar decisión y condiciones. |

Cada cierre incluye fechas locales de inicio/fin y hora de corte. Calcular cada sede en su zona antes de agregar conteos. Identificar correcciones posteriores al corte.

## Métricas y cálculo

| Métrica | Numerador, denominador y periodo |
| --- | --- |
| Inspecciones a tiempo | De las inspecciones con vencimiento en la semana: cerradas al corte cuya fecha local de cierre sea igual o anterior al vencimiento / todas las que vencen esa semana. **Convertir cierre UTC a la zona de la sede**. Incluir pendientes en el denominador; separar atrasos anteriores. |
| Evidencia utilizable | Cierres con resultado, nota útil, autor y fecha presentes / todos los cierres del periodo. Guardar sólo indicadores de presencia y utilidad. |
| Consulta de historial | Consultas correctas / intentos; mediana de segundos de las resueltas y número de fallidas. Comparar semanas 0 y 4 con idéntico método. |
| Esfuerzo operativo | Minutos semanales de preparación, registro y ayuda; equipos cargados y cierres observados. Para minutos por cierre, dividir entre cierres de esa semana. |
| Capacidad y coste | Equipos activos, inspecciones programadas/cerradas, sedes y personas por rol, por semana. Separar coste AWS de producción, pruebas y tiempo humano. Declarar costes no medidos. |

Informar `numerador/denominador`, periodo y faltantes junto al porcentaje. Denominador cero: **sin observaciones**. Agregar sedes sumando conteos, sin promediar porcentajes.

## Decidir capacidad, planes y precio

Vincular cada necesidad con episodios y frecuencia. Piloto valida el recorrido actual; colaboración orienta Operación y gestión conjunta de sedes orienta Red. Las propuestas futuras requieren implementación antes de venderse. Definir cupos tras medir capacidad y validar límites en el servidor. Contrastar una hipótesis de precio con costes observados, tiempo ahorrado y respuesta a una oferta concreta.

Si se presenta una oferta, registrar versión, alcance disponible, unidad, precio, moneda, periodicidad y condiciones previamente definidos. Registrar la respuesta del rol decisor: disposición declarada, rechazo, cambio necesario o pendiente. Una respuesta no es una venta pagada. No se integra Stripe ni se cobra durante esta evaluación.

## Cerrar o continuar

Decidir **continuar Piloto, construir una capacidad, ampliar la evaluación o detenerla** según objetivos previos, volumen observado, mejora, calidad de evidencia, esfuerzo y respuesta ante una oferta explícita. Sin uso suficiente u oferta presentada, la conclusión comercial queda pendiente. Acordar alcance y duración de cualquier extensión.

Proponer salida a una oferta comercial sólo con objetivos y volumen mínimo alcanzados, recorrido completo persistente, bloqueos resueltos y aceptación explícita de alcance y precio registrada. Preparar esta guía no acredita esos resultados.

Las notas son evidencia declarada; no certifican condición, temperatura ni cumplimiento técnico. Fotografías, sensores, recordatorios y trabajo sin conexión quedan fuera del alcance. Cerrar el piloto no activa pagos ni borrado automático: acordar siguiente acceso y tratamiento de registros.

Referencias del proyecto: [producto](../../PRODUCTO.md), [planes y suscripciones](planes-y-suscripciones.md) y [plan y evidencia técnica](../../plan/feature-mantenimiento-1.md).
