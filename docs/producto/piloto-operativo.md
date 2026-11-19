# Piloto operativo de SedePulso: cuatro semanas

Guía para TASK-006. Estado inicial: **sin participante, precio ni aceptación comercial registrados**. Comienza cuando una operación real acuerda el alcance; las pruebas técnicas no cuentan como participantes.

## Semana 0: preparar y fijar la comparación

Registrar código de operación, sede inicial, zona IANA, fechas, equipos seleccionados y cantidad de personas por rol. Acordar revisiones reales, coordinación y decisión de compra a evaluar. Fijar previamente objetivos de mejora, volumen mínimo de observaciones y criterio de nota útil.

Verificar acceso, registro de equipo, programación, cierre e historial tras recargar el ambiente publicado. Empezar con Piloto individual y su sede inicial. Colaboración o sedes adicionales requieren aprovisionamiento administrativo autorizado; medir ese esfuerzo. Las invitaciones y el alta de sedes desde la aplicación están en diseño. No compartir cuentas.

Medir cómo se encuentra hoy el último resultado de los equipos seleccionados: repetir al final las mismas consultas, consigna y puntos de inicio/fin. Registrar duración y fallos sin copiar el historial anterior.

## Bitácora mínima, sin datos personales

Recoger códigos de sede/equipo, tipo de equipo, semana, zona, vencimiento, estado, resultado y fecha UTC de cierre. Registrar si nota y autor están presentes y si la nota cumple el criterio acordado. Revisar la trazabilidad dentro de la aplicación; no copiar nombres, correos, identificadores de acceso, tokens ni notas que identifiquen personas.

Conservar periodos, conteos, tiempos agregados, incidencias y decisiones en una bitácora privada. No guardar información del participante en este repositorio público. Separar operación real y pruebas; marcar faltantes sin sustituirlos por ceros.

## Instrumentación y seguimiento preparados

El cálculo del piloto y el colector operacional están implementados en `infra/pilot/`; `infra/tools/observe-pilot.mjs` comprueba salud, Stripe deshabilitado, stacks, tablas y alarmas antes de persistir agregados privados. Su despliegue y la ejecución OIDC deben acreditarse con runs reales por ambiente; tener el código no acredita un piloto en marcha.

El workflow `piloto.yml` define observación diaria de producción a las 07:17 GMT-6, con ejecución manual y rol OIDC separado del despliegue y del runtime del producto. El heartbeat local de este chat `sedepulso-seguimiento-del-piloto` está activo a las 08:00 GMT-6 para revisar resultados y pendientes, sin SLA. Cada revisión comprueba una frescura máxima de 26 horas. Fallos del observador aparecen en GitHub Actions; no se envían correos desde este flujo. Alarmas sin canal de notificación no prueban entrega de avisos.

La inscripción depende de un registro privado explícito, inicialmente `{ "schemaVersion": 1, "cohorts": [] }`. Sin participante real acordado el resultado permanece `awaiting-participant`, sin semana ni porcentajes comerciales. El corte de producción del 19 de noviembre de 2026 a las 23:23 UTC encontró cero registros persistidos en Access, Assets e Inspections; no permite inferir visitas ni interesados. `plan=pilot` y un alta de producto no sustituyen alcance, consentimiento, acuerdo, zona, inicio y objetivos de una operación real.

El observador consulta sólo las sedes inscritas y separa `technical` de `enrolled-real`. Los reportes se guardan en el bucket privado `sedepulso-pilot-765932874577-us-east-1`, nunca como artefactos públicos. La primera observación de una semana cerrada se congela sin sobrescribirla y se reutiliza en los reportes posteriores. Se definen 180 días para reportes actuales y 90 para versiones no actuales; el registro no tiene expiración automática. Verificar la política desplegada antes de comunicarla como efectiva.

Las altas de equipo y programaciones nuevas guardan `createdAt` UTC del servidor y los reintentos conservan el valor original. No se completa retrospectivamente la fecha de registros anteriores. Las lecturas entre tablas no son una instantánea atómica: mostrar cobertura y límites de reconstrucción. Los totales de metadata de DynamoDB son aproximados, se actualizan aproximadamente cada seis horas e incluyen idempotencia/pruebas; no son personas activas ni clientes.

La evidencia estructural automática comprueba presencia de resultado, nota, autor y fecha. La utilidad de la nota, la búsqueda de historial, el esfuerzo humano, los costes y la respuesta a una oferta necesitan evidencia privada adicional; permanecen sin medir hasta recogerla. No sustituir esas observaciones por actividad técnica.

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
