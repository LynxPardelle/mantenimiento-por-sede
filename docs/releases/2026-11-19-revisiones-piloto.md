# SedePulso: revisiones semanales y comparación con la línea base

TASK-021 amplía el seguimiento de TASK-006 desde la app. Coordinación puede guardar y retomar una revisión de cada semana del piloto, confirmar su declaración al terminar el periodo y consultar su comparación con la línea base inscrita. **Stripe permanece deshabilitado.** La ampliación está publicada y verificada en development, testing y producción siguiendo `development → testing → main`. Esta entrega técnica no acredita cuatro semanas de una operación real.

## Origen y publicación

La implementación corresponde al commit `937f8aec64c0cf5364b15f2138167a436a4d038e`. La [PR 35 hacia development](https://github.com/LynxPardelle/mantenimiento-por-sede/pull/35) está integrada como `b643ab4194227172a0f0486fc91ce069befa2d7d`. La [PR 36 de development hacia testing](https://github.com/LynxPardelle/mantenimiento-por-sede/pull/36) está integrada como `2c7ca232a3e60f0d81f716b64eeef1bc3598af4d`. La [PR 37 de testing hacia main](https://github.com/LynxPardelle/mantenimiento-por-sede/pull/37) está integrada como `10951a88fa50c62c0a84226a712b0fdf61c16ca5`. Cada ambiente completó su publicación y verificación propia. La publicación anterior de onboarding conserva su [evidencia histórica](2026-11-19-onboarding-piloto.md).

| Ambiente | Commit de esta ampliación | CI y despliegue | Estado comprobado |
| --- | --- | --- | --- |
| development | `b643ab4194227172a0f0486fc91ce069befa2d7d` | [44677711753](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44677711753) | Éxito; publicación, comprobaciones y lectura del informe privado aprobadas |
| testing | `2c7ca232a3e60f0d81f716b64eeef1bc3598af4d` | [44678686785](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44678686785) | Éxito; publicación, comprobaciones y lectura del informe privado aprobadas |
| production | `10951a88fa50c62c0a84226a712b0fdf61c16ca5` | [44679642195](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44679642195) | Éxito; publicación, comprobaciones y lectura del informe privado aprobadas |

Los tres ambientes completaron cada uno CI, despliegue, **60 comprobaciones de dominio**, cinco de registro y verificación web, con limpieza de sus tres identidades técnicas y datos de prueba. Los informes privados se leyeron desde S3 y coincidieron con su commit/run, cifrado `AES256`, versionado, cinco stacks completos, once alarmas en `OK`, facturación deshabilitada y `weeklyReviewIntegrationVerified=true`. Los manifiestos limpios, hashes de artefactos y recibos saneados están en la [evidencia de esta entrega](2026-11-19-revisiones-piloto-evidence.json), sin datos de participantes ni reportes privados publicados.

## Recorrido y evidencia declarada

Las cuatro ventanas derivan del inicio inscrito y la zona de la sede: cada una abarca siete días locales con fin exclusivo. El servidor fija semana, periodo, actor y fechas de captura. No hay un reloj o clasificación privilegiada que pueda enviarse desde HTTP. Sólo coordinadores autorizados acceden a esta información.

Un borrador puede guardarse desde el inicio de la semana. La confirmación exige que termine su periodo, hallazgos y siguiente acción no vacíos, mediciones presentes válidas y declaración explícita de quien revisa. Las mediciones ausentes pueden conservarse como `null` o listas sin intentos; un cero medido requiere entrada expresa. Esto permite registrar una revisión cualitativa sin inventar observaciones. Cada revisión tiene versión propia, reintentos estables y confirmación inmutable; no renueva el piloto.

La comparación muestra intentos y éxito de búsqueda, mediana de consultas resueltas, minutos de preparación/registro/ayuda y evaluación declarada de notas. Los cambios de historial y esfuerzo requieren declaración de mismo protocolo. Sin éxitos la mediana es `null`; una base de cero no admite porcentaje de cambio. Las tasas conservan numerador y denominador, y un denominador cero no produce una tasa observada. La línea base sólo recoge un criterio de notas, por lo que no se inventa una tasa inicial de calidad.

Son diferencias declaradas entre periodos, sin ajuste por carga ni demostración causal de ahorro. La fecha de confirmación permanece separada de la semana a la que se refieren los datos. El [contrato de revisiones](../contracts/pilot-weekly-reviews.md) detalla rutas, validación y cálculo.

## Persistencia, exportación y seguimiento

Pilot conserva las revisiones privadas en su tabla propia. La confirmación escribe atómicamente la revisión y el agregado exportable; la versión condicional del índice y la relectura de conflictos evitan perder una semana al confirmar otra simultáneamente. Los permisos y la autorización siguen separados por servicio.

El exportador añade resúmenes confirmados, sin hallazgos, siguiente acción, intentos individuales ni actores. Los consumidores nuevos admiten exportaciones anteriores sin `reviews`. El observador valida cohorte, ventana, cierre y agregados, difiere capturas posteriores al corte y añade `weeklyReviews` después de restaurar los snapshots operacionales. Una declaración tardía puede aparecer junto al corte congelado sin cambiarlo. Confirmar una revisión no completa automáticamente las métricas ausentes de otras semanas ni la evaluación comercial.

El heartbeat existente `sedepulso-seguimiento-del-piloto` se actualizó mediante la herramienta de automatizaciones para revisar los cinco stacks, once alarmas y la separación entre `weeklyReviews` y snapshots operacionales. Permanece `ACTIVE` a las **08:00 GMT-6**, en el mismo chat y con su calendario conservado. Depende de la aplicación local y de sus accesos; no prueba por sí solo una ejecución futura ni sustituye la observación de nube.

El smoke ampliado utiliza exclusivamente un fixture con namespace efímero y pertenencia marcada técnicamente por Access. Una preparación administrativa acotada simula su calendario cerrado; no relaja las reglas de la API, inscribe un participante real ni demuestra cuatro semanas transcurridas. La limpieza prevalida las seis claves conocidas y condiciona el retiro a sus estados, clasificación, código y alcance.

## Validación disponible

Se aprobaron **214 pruebas automatizadas**: 84 backend, 19 CI/IAM, 41 del observador y 70 de Angular. La compilación SSR terminó sin advertencias. El CI de la PR 35, incluidas pruebas, compilación y lint, aprobó antes de integrar. Development, testing y producción terminaron después sus comprobaciones propias de nube.

La [ejecución independiente del observador 44680685706](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44680685706) también terminó en `SUCCESS`, mediante `workflow_dispatch` desde el mismo commit de producción. Su informe con `checkedAt=2026-11-20T05:23:25.983Z` —19 de noviembre, 23:23 GMT-6— volvió a leerse desde S3, con la integración semanal, las cinco pilas, once alarmas OK y guardias de facturación verificadas. La observación diaria a las 07:17 GMT-6 permanece configurada; este ensayo manual no acredita una ejecución futura del cron. Las alarmas carecen de acciones de notificación, por lo que su estado no prueba entrega de avisos.

El corte administrativo posterior al smoke entre **2026-11-20 05:23:12.990 y 05:23:24.302 UTC** —19 de noviembre, 23:23 GMT-6— descubrió las cuatro tablas de producción mediante outputs propios y ejecutó `Scan Select=COUNT` consistente y paginado, sin solicitar `Items`. Access, Assets, Inspections y Pilot devolvieron cada una `Count=0`, `ScannedCount=0` y una página. Son lecturas individuales, sin una transacción entre tablas; no miden visitantes, personas activas ni cuentas Cognito sin workspace. Esta comprobación puntual no incorpora Scan al observador recurrente.

El navegador local verificó borrador y recuperación tras recarga, declaración obligatoria, confirmación de semana 1 y comparación de datos técnicos: mediana de historial de **60 a 30 segundos**, esfuerzo total de **30 a 15 minutos** y **3 notas útiles de 4 evaluadas**. La semana 2 confirmó una revisión cualitativa con mediciones ausentes. También se comprobaron protección de cambios sin guardar, aislamiento entre sedes, vista móvil de 390 px sin desbordamiento horizontal y consola final sin errores.

Las capturas de [comparación local](../screenshots/pilot-weekly-comparison-local.jpg) y [vista móvil](../screenshots/pilot-weekly-mobile.jpg) contienen datos técnicos de demostración. La interfaz autenticada se verificó en navegador local; API, registro, SSR y orígenes privados se verificaron por separado en los tres ambientes. No se atribuye a esta entrega una sesión de navegador autenticada nueva en producción.

## Continuidad

TASK-021 está entregada y verificada en los tres ambientes. La [guía operativa](../producto/piloto-operativo.md), el [runbook de métricas](../runbooks/piloto-metricas.md) y los [recibos técnicos](2026-11-19-revisiones-piloto-evidence.json) permiten continuar desde remoto y conservan la separación entre declaraciones semanales, evidencia automática congelada y decisión comercial. TASK-006 mantiene pendiente la operación real y sus cuatro semanas observadas. Esta ampliación no activa Stripe, cobros, precios ni suscripciones contratables.
