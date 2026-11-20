# SedePulso: programación real del observador

Entrega de TASK-022, que habilita el seguimiento de TASK-006. Stripe permanece deshabilitado. Los recibos publicados contienen sólo metadata técnica; los reportes y las fuentes de cohortes permanecen privados.

## Diagnóstico comprobado

La inspección inicial del 20 de noviembre, alrededor de las 21:08 UTC, encontró tres ejecuciones manuales exitosas de `piloto.yml` y ninguna con `event=schedule`. El repositorio no era un fork ni estaba archivado; `main` era la rama predeterminada, Actions estaba habilitado y el workflow figuraba activo. El único cron, `17 13 * * *`, ya estaba en `main` antes de las 13:17 UTC de ese día. No había un job programado fallido que atribuir a OIDC, AWS o al código del observador.

Durante la revisión apareció el primer run programado real: [44818232242](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44818232242), creado a las **21:12:23 UTC / 15:12:23 GMT-6**, y terminado exitosamente a las 21:12:52 UTC. Usó `main` y el commit `e1694db73850de6209241b52a309368000f6d806`, anterior a la mejora de esta entrega. Su reporte privado, observado a las `21:12:32.373 UTC`, coincidió con SHA, run e intento; verificó cinco stacks completos, once alarmas OK, facturación deshabilitada, AES256 y versionado.

Ese commit sólo contenía el corte de las 13:17 UTC. Suponiendo el tick del mismo día, el evento apareció 7 h 55 min 23 s después: la evidencia es compatible con entrega tardía del scheduler. El workflow antiguo no dejó en sus logs una expresión cron explícita y la API no expone el motivo interno de la demora. La ejecución precedió al nuevo código: no se atribuye su recuperación al cambio, ni se inventa una causa por identidad o permisos.

[GitHub documenta que la programación puede retrasarse o perder ejecuciones y que usa la rama predeterminada](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). El cron configurado por sí solo no prueba entrega ni puntualidad.

## Mejora publicada

El commit de implementación `f56abfed8c330ff93c15f22973bfe8f3ad226bcb` conserva el corte principal y añade otra observación diaria de producción:

| Corte | Cron UTC | Hora GMT-6 |
| --- | --- | --- |
| Principal | `17 13 * * *` | 07:17 |
| Respaldo diario | `57 21 * * *` | 15:57 |

El respaldo se ejecuta también si el primero tuvo éxito; no es un reintento condicional. Ambas observaciones mantienen el mismo rol OIDC separado, acceso de negocio de sólo lectura, guardas de `main`/ambiente y concurrencia sin cancelar otro run. No cambian datos de operación, inscripciones o revisiones confirmadas; conservan los snapshots semanales originales. La escritura autorizada sigue limitada a reportes privados.

El workflow registra únicamente `event` y la expresión `schedule` en una línea JSON. El nuevo test verifica ambos cron, destino producción, guardas de rama/ambiente, rol observador y permisos. Falló antes de añadir el segundo corte y pasó después. El conjunto efectivo de CI fue **216 pruebas aprobadas**: 84 backend, 21 CI/IAM, 41 piloto/observador y 70 Angular; build SSR y lint del bootstrap y cinco templates aprobados.

El heartbeat existente `sedepulso-seguimiento-del-piloto` sigue activo en este chat a las 08:00 GMT-6. Se actualizó mediante la herramienta de automatizaciones para comprobar por separado el último `schedule` exitoso y la frescura del reporte privado. Ausencia o antigüedad mayor de 26 horas no quedan ocultas por un run manual o de publicación reciente. No se creó otra automatización ni se cambió el horario.

## Promoción y verificación por ambiente

La publicación siguió [PR #41](https://github.com/LynxPardelle/mantenimiento-por-sede/pull/41) → [#42](https://github.com/LynxPardelle/mantenimiento-por-sede/pull/42) → [#43](https://github.com/LynxPardelle/mantenimiento-por-sede/pull/43), con todos los checks aprobados y sin omitir protecciones. Cada promoción esperó a la publicación, pruebas y lectura privada del ambiente anterior.

| Ambiente | Commit publicado | Run CI/deploy exitoso |
| --- | --- | --- |
| development | `cf61cb7bf0116554c65235c968fc9efa13a6b0d3` | [44818569583](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44818569583) |
| testing | `7e8a74c03abdf10da024e909f83f38d232b832c1` | [44819681853](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44819681853) |
| production / main | `1c977584fc55b2b41aa492644162cfed57d04e9c` | [44820926265](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44820926265) |

Los tres ambientes aprobaron 60 comprobaciones de dominio, cinco de registro, HTTPS/SSR y orígenes privados, con tres identidades técnicas y sus registros limpiados por ambiente. Los artefactos descargados tenían manifiesto limpio y coincidían con su SHA/rama. Cada informe privado coincidió con SHA/run/intento y acreditó cinco stacks completos, once alarmas OK, AES256, versionado y `billingEnabled=false`. Los recibos de CI se conservan separados de los runs del workflow independiente.

Estas pruebas técnicas no son participantes, semanas reales de uso ni aceptación de precio. TASK-006 conserva pendiente su validación con una operación real. Las alarmas no tienen acciones de notificación configuradas; este cierre comprueba sus estados y las ejecuciones del observador, sin acreditar entrega de avisos a personas. Los futuros ticks de GitHub siguen siendo de mejor esfuerzo.

## Ejecución programada real y estado del respaldo

El run `44818232242` y su lectura privada posterior acreditan una ejecución programada real, sin recurrir a un dispatch manual. La comparación entre su SHA y el commit publicado en producción no contiene cambios en `infra/pilot/`, `infra/tools/observe-pilot.mjs` o `infra/tools/aws.mjs`: el cálculo y la persistencia que ejecutó son los mismos. El cambio de esta entrega se limita al workflow, su test de configuración y la guía.

La consulta de las **22:13:34 UTC / 16:13:34 GMT-6** todavía devolvía un solo run `schedule`. El respaldo nuevo de las 21:57 UTC aún no tenía ejecución visible. Se conserva como **`not-yet-observed`**; no se etiqueta como éxito, fallo o descarte sin un run que lo demuestre. La primera recuperación no se atribuye al nuevo cron y no se declara corregida la latencia interna de GitHub.

La revisión independiente confirmó sintaxis, rama predeterminada, publicación antes del corte, múltiples cron admitidos y workflow activo. El [estado público de GitHub](https://www.githubstatus.com/) mostraba Actions operativo y ninguna incidencia activa en la consulta de las 22:03 UTC; ese estado general no explica ni descarta la demora de este repositorio. El seguimiento existente conserva la comprobación independiente del último `schedule` exitoso y avisará de ausencia/antigüedad mayor de 26 horas aunque un reporte manual esté fresco.

Los [recibos saneados](2026-11-20-observador-programado-evidence.json) conservan la ejecución real anterior al cambio, los tres ambientes verificados y el estado explícito del respaldo pendiente de observación. Los informes privados no se adjuntan a este repositorio público.
