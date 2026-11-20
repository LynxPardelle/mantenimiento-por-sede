# SedePulso: inscripción del piloto desde la app

La ampliación TASK-020 habilita el onboarding de TASK-006 desde `/app/piloto`: permite a una persona coordinadora guardar alcance, objetivos y línea base, retomarlos y confirmar explícitamente la inscripción de su sede. **Stripe permanece deshabilitado.** Development, testing y producción están publicados y verificados, con pruebas propias, observación OIDC y lectura posterior de sus informes privados. Esta entrega no acredita cuatro semanas de una operación real.

## Alcance y origen

La implementación corresponde al commit `946f03cece6b0e242f23f84bde0ade79e660c632`, integrado mediante la [PR 29 hacia development](https://github.com/LynxPardelle/mantenimiento-por-sede/pull/29). La [PR 30 hacia testing](https://github.com/LynxPardelle/mantenimiento-por-sede/pull/30) y la [PR 31 hacia main](https://github.com/LynxPardelle/mantenimiento-por-sede/pull/31) están integradas siguiendo `development → testing → main`, con verificación independiente de cada ambiente.

| Ambiente | Commit de la publicación | Run de CI y despliegue | Estado de esta ampliación |
| --- | --- | --- | --- |
| development | `78f0b796198f47030765cd8a749d06036e3cdc60` | [44650212548](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44650212548) | Éxito; verificación propia y lectura posterior del informe privado aprobadas |
| testing | `ef20a405d4e218a3fc7fb76f0c435aa814c500a4` | [44651351713](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44651351713) | Éxito; verificación propia y lectura posterior del informe privado aprobadas |
| production | `716b20aaf375b31bcd88a5532aff17085c05c5f7` | [44652383418](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44652383418) | Éxito; verificación propia y lectura posterior del informe privado aprobadas |

El recorrido contiene cuatro pasos: alcance de la sede, objetivos, línea base y confirmación. Los borradores incompletos conservan faltantes y revisión; no inscriben una operación. Confirmar exige valores completos y tres declaraciones explícitas: operación real, autoridad para inscribirla y acuerdo de medición. La app guarda primero las modificaciones válidas y confirma esa revisión. Las respuestas perdidas se reintentan sin duplicar ni renovar el periodo.

El alcance automático incluye todo el inventario de la sede, también sus altas durante la ventana. La fecha del piloto debe estar entre mañana y 90 días después de hoy en su zona autorizada. La línea base identifica **siete días locales completos**: intentos de búsqueda con éxito/fallo y segundos, minutos de preparación/registro/ayuda y un criterio de nota útil. El servidor deriva el fin exclusivo y la zona; `capturedAt` registra la admisión de esa declaración, separado del periodo medido. Los números empiezan vacíos y cero requiere entrada expresa; cero éxitos produce mediana `null`.

## Arquitectura y privacidad

Pilot añade el quinto stack, con tabla propia, API JWT, exportador IAM separado y dos alarmas: la definición pasa a once por ambiente. Access sigue resolviendo organización, sede, rol y procedencia técnica. El navegador no elige actores, clasificación o fecha del acuerdo.

Sólo coordinadores autorizados leen o modifican el onboarding. Descripción, protocolo, criterio y actores permanecen en Pilot. El exportador no tiene rutas HTTP ni permisos de escritura: consulta únicamente `PILOT#REGISTRY` y entrega cohortes y agregados con `source=participant-declared`. El observador los combina con S3 administrativo sin reemplazarlo; rechaza conflictos o datos incompletos y conserva los cortes semanales. Los fixtures marcados técnicamente por Access permanecen `technical`, también en producción.

## Validación disponible

Se aprobaron **66 pruebas backend, 19 de CI/IAM, 34 del observador y 50 de Angular**, compilación SSR y lint de infraestructura. La revisión del código comprobó control de revisión, inscripción atómica, reintentos posteriores al inicio, periodo de línea base y exportación sin textos privados. El cliente rechaza respuestas de esquema incompleto y conserva errores recuperables.

Los tres ambientes completaron cada uno CI y despliegue de cinco stacks, 41 comprobaciones de dominio —incluido el nuevo onboarding—, cinco de registro y la verificación web, con sus tres identidades técnicas limpiadas. El observador ejecutó su recorrido con OIDC y el informe privado se volvió a leer desde S3, coincidiendo con su commit/run, cifrado `AES256`, versionado, cinco stacks completos, once alarmas en `OK` y facturación deshabilitada. Los recibos saneados, artefactos y hashes están en el [archivo de evidencia de esta ampliación](2026-11-19-onboarding-piloto-evidence.json), sin registros de participantes ni textos privados.

La [ejecución independiente del observador 44653445316](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44653445316) también terminó en `SUCCESS`, disparada mediante `workflow_dispatch` desde el mismo commit de producción. Su informe del 20 de noviembre a las 01:25:11.358 UTC —19 de noviembre, 19:25 GMT-6— volvió a leerse desde S3 con las mismas guardias y la exportación de Pilot completada. El calendario diario permanece configurado; este resultado verifica la ejecución manual del mismo workflow, no una ejecución futura del cron. Las alarmas siguen sin acciones de notificación, por lo que su estado no acredita entrega de avisos.

Después del smoke, una lectura administrativa entre **2026-11-20 01:24:53.271 y 01:25:04.688 UTC** —19 de noviembre, 19:24–19:25 GMT-6— descubrió las tablas mediante outputs propios y ejecutó `Scan Select=COUNT`, consistente y paginado, sin solicitar `Items`. Access, Assets, Inspections y Pilot devolvieron cada una `Count=0`, `ScannedCount=0` y una página: permanecían sin registros persistidos en sus respectivos cortes tras la limpieza. Son lecturas individuales, no una transacción entre tablas; no cuentan visitas, personas activas ni cuentas Cognito sin workspace. Esta comprobación puntual administradora no añade permisos de Scan al observador.

El navegador local completó inscripción y recarga, preservando el periodo de línea base. Se comprobó escritorio y móvil de 390 px sin desbordamiento horizontal y consola fresca sin errores. Las capturas de [inscripción local](../screenshots/pilot-enrolled-local.jpg) y [vista móvil](../screenshots/pilot-onboarding-mobile.jpg) contienen datos ficticios de evaluación técnica; no representan un participante real. El adaptador local no sustituye Cognito, IAM o persistencia en la nube.

## Continuidad del piloto

La inscripción final es única por organización/sede y se conserva sin editar; esta versión no ofrece cancelación o renovación desde la interfaz. Capturar una línea base declarada no demuestra mejora, actividad por persona, utilidad efectiva de notas, cuatro semanas de uso o aceptación de precio. Personas por rol no son usuarios activos ni una medición de `lastSeen`.

La publicación, los smokes y las lecturas privadas de esta ampliación están aprobados en los tres ambientes. La [guía operativa](../producto/piloto-operativo.md), el [contrato de inscripción](../contracts/pilot-enrollment.md) y el [runbook del observador](../runbooks/piloto-metricas.md) permiten continuar con una inscripción explícita y mantienen separados la captura inicial, las observaciones de semanas 1–4 y la decisión comercial. Los datos técnicos no son participantes ni periodos de uso transcurridos; el piloto real requiere su propia evidencia. Stripe permanece deshabilitado.
