# Entrega de SedePulso — 2026-11-19

Estado de la entrega: **publicación técnica completada y verificada en development, testing y production**. Esta evidencia distingue publicación técnica, registro real y validación comercial.

## Código y producto

El repositorio conserva su identificador histórico `LynxPardelle/mantenimiento-por-sede`. La marca visible es SedePulso. Angular SSR se sirve desde Lambda ARM64 detrás de CloudFront; S3 y el acceso directo a Function URL son privados. Access, Assets e Inspections tienen Lambdas, roles y datos propios. Cognito verifica el correo y el servidor crea organización, sede y rol coordinador.

La landing incluye propuesta de valor, recorrido, casos, FAQ y planes. Piloto es gratuito en esta etapa, individual y con una sede inicial. Operación y Red son propuestas; no tienen contratación, precios, Stripe ni cargos automáticos.

## Verificación por ambiente

| Ambiente | Commit del despliegue | Resultado | Actions |
| --- | --- | --- | --- |
| development | `31cc92795e80eec3d5ee3dbbfdd4a64f47a51837` | Cuatro stacks y tres smokes aprobados. | [Run 44627058265](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44627058265) |
| testing | `5d50187ce8a70edfbed5ecc87986cdea5a613e88` | Cuatro stacks y tres smokes aprobados, intento 2. | [Run 44628242897](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44628242897) |
| production | `328f7f1b5ada366ad986b25bee1a8571c4448123` | Cuatro stacks y tres smokes aprobados, intento 2. | [Run 44631382530](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44631382530) |

Artefactos finales comprobados: development `14578734056`, testing `14581750821` y production `14583212671`. Cada ZIP contiene los tres reportes y el manifiesto, con commit/rama correspondientes y `dirty=false`. Las ramas remotas contienen el mismo árbol de producto; los commits posteriores de cierre sólo actualizan documentación y capturas, sin nuevo despliegue de runtime.

El [resumen JSON sin datos personales](2026-11-19-evidence.json) conserva las comprobaciones, los SHA-256 de los manifiestos y la relación con cada run/artefacto.

Los smokes comprueban 24 casos de dominio con JWT real, cinco de aprovisionamiento aislado y la web: HTTPS, SSR, JavaScript, registro, redirección Hosted UI y rechazo de acceso directo anónimo a S3 y Function URL. Las identidades y datos de prueba se eliminan al terminar. Los artefactos incluyen manifiesto y reportes de dominio, signup y web; no contienen contraseñas, códigos o tokens.

Las verificaciones actuales pasan 41 pruebas backend, 17 de CI y 31 de Angular, además de build SSR y lint. El refresco y las escrituras de mantenimiento se serializan desde store y controles, preservando listas, cursores y cambios de sede.

## Registro y correo

Entrega real al buzón autorizado, confirmación desde `/registro`, sede coordinadora creada automáticamente y lectura autorizada mediante JWT verificadas en development a las 21:18:51 UTC, testing a las 22:42:07 UTC y production a las 23:04:54 UTC. Cuentas, membresías y organizaciones temporales eliminadas. El buzón y sus códigos no se versionan.

En producción se completó además el login real desde Cognito con authorization code y PKCE S256, callback y acceso a `/app` con sede/rol correctos, recarga conservando acceso, logout y rechazo de `/app` sin sesión. Verificación final a las 23:06:43 UTC, antes de la limpieza. Las pruebas de interfaz también cubren PKCE/callback; los otros ambientes comprobaron correo/confirmación en navegador, redirección y JWT real mediante sus smokes. El recorrido completo de altas, programación, cierre e historial se comprobó en la demostración Angular y por API persistida en los tres ambientes; no se presenta como una ejecución manual de todas las escrituras UI en cada ambiente.

Capturas sin datos personales: [landing](../screenshots/sedepulso-production-landing.jpg), [registro confirmado](../screenshots/sedepulso-production-registro-confirmado.jpg), [operación autenticada](../screenshots/sedepulso-production-operacion-autenticada.jpg) y [vista móvil](../screenshots/sedepulso-production-mobile.jpg). La cuenta de prueba mostrada fue eliminada; no es una cuenta permanente entregada al usuario.

## OIDC, observabilidad y recuperación

Los roles OIDC se separan por environment, con subject inmutable del repositorio y audiencia STS exactos. El rol de CloudFormation mantiene la boundary de los roles runtime. No se guardan access keys en GitHub ni se rebajan las protecciones development → testing → main.

La primera creación exige dos fases: plataforma sin asociación WAF, descubrimiento y autorización del ARN exacto del pool, y reejecución del push para completar la entrega. Las dependencias reales de tagging y delivery de logs de HTTP API se comprobaron con STS y recursos temporales eliminados. La excepción W3037 queda limitada a las políticas StageTagging, según el [runbook OIDC](../runbooks/ci-oidc.md).

La alarma HTTP API 5xx cubre respuestas de error manejadas por los servicios; el canal de notificación sigue pendiente. En los tres ambientes se confirmó recepción real de un access log de salud: development 22:21:22 UTC, testing 22:39:31 UTC y production 23:00:04 UTC. No se inyectaron fallos ni se verificó entrega de avisos.

Las dos tablas Access vacías retenidas de los intentos fallidos de testing se eliminaron a las 22:42:37/38 UTC tras comparar ARN, TableId, fecha, tags, tabla activa distinta y Scan consistente vacío sin cursor. Ambas devolvieron ResourceNotFound; la tabla activa conservó su identidad y estado. Los recursos de diagnóstico temporales también se eliminaron; las policies compartidas se conservaron durante las pruebas.

La restauración aislada de Access en development comparó un marcador y completó su limpieza. Ese ejercicio no acredita recuperación coordinada de todos los dominios ni RTO/RPO comerciales. Véase el [runbook](../runbooks/recuperacion.md).

## Continuidad comercial

El [piloto operativo](../producto/piloto-operativo.md) prepara cuatro semanas de métricas y decisión de continuidad. Siguen pendientes participante y alcance reales, canal de avisos, ensayo de recuperación coordinada y validación de precio/prestaciones antes de ofrecer planes de pago. Preparar la guía y publicar el producto no acreditan demanda ni aceptación comercial.

## Continuación de TASK-006

La ampliación posterior de métricas privadas, seguimiento y promociones verificadas se registra en [el cierre del piloto técnico](2026-11-19-piloto.md). Este documento conserva la evidencia de la entrega anterior.
