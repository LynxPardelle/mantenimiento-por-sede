# SedePulso: ambos cortes programados comprobados

Seguimiento de TASK-022 y TASK-006. El respaldo que figuraba `not-yet-observed` en el [cierre del 20 de noviembre](2026-11-20-observador-programado.md) ya tiene una ejecución programada real y un reporte privado coincidente. También se comprobó una ejecución posterior del corte principal. Se conservan los recibos históricos sin reescribir su estado al momento de aquel corte.

## Ejecuciones comprobadas

Ambos runs tienen `event=schedule`, rama `main`, intento 1 y SHA `0755774a7ce91030a993920886fec1b24ff47b02`. Sus jobs de observación, OIDC y persistencia terminaron con éxito. La expresión se obtuvo de la línea JSON explícita del workflow, sin inferirla de la hora.

| Corte | Run real | Cron registrado | Creación UTC | Creación GMT-6 |
| --- | --- | --- | --- | --- |
| Respaldo | [44858427495](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44858427495) | `57 21 * * *` | 21 de noviembre, 02:55:06 | 20 de noviembre, 20:55:06 |
| Principal | [44944669245](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44944669245) | `17 13 * * *` | 21 de noviembre, 20:08:28 | 21 de noviembre, 14:08:28 |

Se leyó el reporte diario privado conservado del respaldo, con `checkedAt=2026-11-21T02:55:14.150Z`, y el último reporte del principal, con `checkedAt=2026-11-21T20:08:36.568Z`. En ambos coincidieron SHA, run e intento. También se verificaron cinco stacks completos, once alarmas OK, guardas de registro habilitado y facturación deshabilitada, ausencia de escrituras de negocio, AES256 y versionado. Los [recibos saneados](2026-11-21-observador-programado-evidence.json) contienen sólo metadata técnica y hashes; no incluyen reportes privados, cohortes, revisiones o métricas de negocio.

## Frescura y salud actual

La lectura administrativa de sólo lectura del 21 de noviembre a las `21:46:16.909 UTC` verificó de nuevo los cinco stacks propios de producción y las once alarmas descubiertas por sus nombres exactos: todos completos y en OK. El último informe tenía aproximadamente 1,63 horas de antigüedad, por debajo del umbral de 26 horas.

Development, testing y producción respondieron por HTTPS con 200, health `ok`, `signupEnabled=true` y `billingEnabled=false`. Stripe permanece deshabilitado. No se ejecutó manualmente el observador, no se inscribieron participantes y no se modificaron datos o snapshots del piloto durante esta comprobación.

## Entrega observada y límites

Las ejecuciones llegaron después de los cortes configurados. Comparando con el corte previo correspondiente, el respaldo apareció 4 h 58 min 6 s después y el principal 6 h 51 min 28 s después. La relación con ese corte previo es una comparación temporal; la API no expone el motivo interno ni una marca de despacho prevista que permita atribuir causalidad.

Queda acreditada la entrega real de ambos cron desde el código publicado. No se declara puntualidad, una reparación de la latencia interna de GitHub ni entrega de avisos a personas. Las alarmas continúan sin acciones de notificación configuradas. El heartbeat existente conserva la comprobación separada del último `schedule` exitoso y de la frescura del reporte, con señal de ausencia o antigüedad mayor de 26 horas.

Esta evidencia técnica no inicia el reloj de una operación, completa semanas reales, mide mejoras o acredita aceptación comercial. El seguimiento de TASK-006 conserva sus reglas de inscripción explícita, línea base, semanas observadas y revisiones declaradas separadas de los snapshots congelados. No se activa Stripe ni se rellenan observaciones ausentes.
