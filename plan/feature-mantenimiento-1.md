---
goal: 'SedePulso: registrar y completar una inspección por sede con microservicios AWS y Angular SSR en Lambda'
date_created: 2026-11-17
date_updated: 2026-11-19
status: 'In Progress'
tags: ['feature', 'angular', 'aws-sam', 'microservices', 'ssr']
---

# Plan de la primera funcionalidad de SedePulso

El producto adopta **SedePulso** y `sedepulso.lynxpardelle.com`. Carpeta, repositorio y archivo del plan conservan sus identificadores históricos. La [arquitectura vigente](../docs/architecture/ARCHITECTURE.md) separa plataforma/Access, Assets, Inspections y frontend en stacks con datos e IAM propios.

El recorrido es iniciar sesión → elegir sede asignada → registrar equipo → programar inspección → consultar pendientes → cerrar → comprobar historial persistido. La entrega técnica y el observador privado están publicados y verificados en los tres ambientes; el piloto comercial de cuatro semanas sigue pendiente. Su guía, métricas y seguimiento están operativos, sin participante o aceptación inventados.

## 1. Requisitos

- **REQ-001** Una persona coordinadora registra equipos y programa inspecciones en sedes asignadas.
- **REQ-002** Una persona técnica consulta pendientes, cierra y confirma el resultado persistido.
- **REQ-003** Historial con fecha, resultado, nota y autor del primer cierre. Autor proviene del access token verificado; hora UTC, del servidor.
- **REQ-004** Angular 22 y NgRx SignalStore; SSR desde Lambda Node.js 24 ARM64, estáticos S3 privado y CloudFront OAC. `/api/*` usa HTTP API.
- **REQ-005** Access, Assets e Inspections tienen funciones, roles, tablas y stacks propios. Sólo Access lee membresías. Las llamadas entre servicios usan IAM.
- **REQ-006** Ambientes aislados en `sedepulso-development.lynxpardelle.com`, `sedepulso-testing.lynxpardelle.com` y `sedepulso.lynxpardelle.com`.
- **SEC-001** HTTP API verifica JWT; backend exige `token_use=access`. Organización, pertenencia y rol se resuelven por `sub` en Access, nunca por datos elegidos por el cliente.
- **SEC-002** Token inválido o ausente: `401`; sede ajena: `404`; rol insuficiente en sede propia: `403`.
- **SEC-003** Cognito authorization code con PKCE, cliente sin secreto y autorregistro con correo verificado. El servidor crea una organización y sede inicial propias y asigna el rol coordinador; el navegador no elige organización interna ni privilegios. SSR sin DynamoDB; S3 y Function URL privados por OAC.
- **CON-001** Vencimiento local a sede, separado de instante UTC del cierre.
- **CON-002** Altas y programación idempotentes por actor, operación y sede con `Idempotency-Key` y retención mínima de siete días, prolongada hasta el borrado eventual de TTL. Misma clave con contenido distinto: `409`.
- **CON-003** Cierre condicional: repetición idéntica conserva original; distintos cierres generan un cierre y un `409`. Confirmación por registro primario.
- **CON-004** Promoción development → testing → main. Conservar trabajo y ramas de otros productos.

## 2. Tareas y aceptación

La evidencia de implementación y verificación se registra por ambiente. La promoción development → testing → main terminó con verificaciones propias; publicar el producto no completa el piloto comercial de TASK-006.

| Tarea | Entrega | Aceptación | Estado al 2026-11-19 |
| --- | --- | --- | --- |
| TASK-000 | Marca SedePulso en interfaz, metadatos, paquetes y documentación. | Títulos nuevos consistentes; referencias históricas explicadas y conservadas. | Implementada y verificada en los tres ambientes |
| TASK-001 | Plataforma Cognito/JWT, Access/membresías, sedes y configuración pública. | Token inválido o de uso incorrecto rechazado; sede ajena `404`; rol insuficiente `403`; contexto resuelto por membresía. | Implementada y verificada por API en los tres ambientes |
| TASK-002 | Stack Assets con tabla, alta transaccional e inventario paginado. | Reintento no duplica; cursor no cruza sede; IAM no permite leer tablas de otros servicios. | Implementada y verificada por API en los tres ambientes |
| TASK-003 | Stack Inspections con programación, pendientes, historial y cierre. | Valida equipo por Assets; idempotencia y concurrencia correctas; elimina índice pendiente y confirma registro. | Implementada y verificada por API en los tres ambientes |
| TASK-004 | Sección Angular diferida, sede, inventario, programación y SignalStore. | Alta y programación completas; error de red conserva formulario y permite reintento sin duplicar. | Implementada y probada; publicada en los tres ambientes |
| TASK-005 | Resultado e historial accesibles en móvil. | Cierre y consulta tras recarga; etiquetas, teclado y señal de éxito accesible. | Angular probado y demo recorrida; landing/registro móvil verificados |
| TASK-006 | Recorrido técnico de dos organizaciones/sedes y piloto de cuatro semanas. | Aislamiento/reintentos en nube; operación real participante; métricas con periodo y denominadores. | Recorrido técnico y observador OIDC aprobados en tres ambientes; seguimiento diario activo; piloto real pendiente |
| TASK-007 | SSR Lambda, Function URL IAM, CloudFront/OAC, S3, ACM y DNS. | HTML/hidratación, estáticos, HTTPS, rechazo de acceso directo y API sin caché operativa. | Implementada y verificada en los tres ambientes |
| TASK-008 | Empaquetado y orquestador de cuatro stacks. | Orden correcto y actualización de un servicio sin redesplegar los demás con contrato estable. | Orquestador implementado y entrega aprobada en tres ambientes |
| TASK-009 | CI de pruebas/build/lint y deploy condicional OIDC. | Checks pasan, rol y `AWS_DEPLOY_ROLE_ARN` configurados; promoción por PR permitido. | OIDC, publicación y promoción aprobados en tres ambientes |
| TASK-010 | Aprovisionamiento técnico y smoke real de development. | Usuarios/membresías aislados sin exponer secretos; recorrido persistido y cleanup comprobados. | Smoke real aprobado: 24 comprobaciones; 3 identidades efímeras eliminadas |

## 3. Secuencia

1. Alinear marca, contratos, límites de servicios y arquitectura.
2. Implementar y probar Access, Assets e Inspections.
3. Implementar recorrido Angular y demostración aislada en localhost.
4. Compilar SSR y preparar CloudFront, OAC, S3, certificado, DNS y stacks.
5. Ejecutar pruebas, build y lint; registrar resultados exactos.
6. Desplegar development y verificar Cognito, IAM, DynamoDB, aislamiento y dominio.
7. Integrar en development y promover por PR a testing y después main.
8. Ejecutar el piloto de una operación real y decidir continuación y precio.

Los pasos técnicos que no requieren información del comprador pueden avanzar de forma autónoma. No inventar aceptación comercial, asignaciones del cliente, métricas o renovación.

## 4. Pruebas

| Prueba | Alcance |
| --- | --- |
| TEST-001 | Token inválido/ausente, ID token usado como autorización, rol insuficiente y sede ajena. |
| TEST-002 | Dos organizaciones con identificadores locales coincidentes: lecturas, escrituras y cursores aislados. |
| TEST-003 | Alta y programación repetidas, misma clave con distinto cuerpo y respuesta perdida. |
| TEST-004 | Cierres iguales y distintos concurrentes; autor/hora inmutables; eliminación de claves del GSI. |
| TEST-005 | Alta, programación, cierre e historial Angular; red caída, reintento y recarga. |
| TEST-006 | SSR inicial, hidratación, estáticos, privacidad de caché y acceso directo a orígenes denegado. |
| TEST-007 | Templates válidos, IAM por servicio, despliegue en orden y actualización independiente. |
| TEST-008 | Smoke en development real; demostración localhost no sustituye Cognito/IAM/DynamoDB. |

## 5. Archivos y dependencias

- `infra/template.yaml`: plataforma, identidad, Access y recursos transversales.
- `infra/services/assets.yaml` e `infra/services/inspections.yaml`: stacks de servicios.
- `infra/frontend.yaml`: SSR, distribución, estáticos y dominio.
- `infra/functions/`: handlers, contratos y persistencia.
- `infra/tools/`: demostración, empaquetado, despliegue, smoke y aprovisionamiento.
- `frontend/src/app/maintenance/`: interfaz, HTTP y estado.
- Lockfiles frontend e infra para versiones reproducibles.
- DNS de `lynxpardelle.com`, sesión AWS y certificado ACM `us-east-1`.
- Rol OIDC y `AWS_DEPLOY_ROLE_ARN` para publicar desde CI.
- Operación real, sedes y usuarios autorizados para piloto comercial.

## 6. Evidencia de ejecución

La evidencia vigente corresponde a los runs finales de development `31cc927`, testing `5d50187` y production `328f7f1`, todos SUCCESS con manifiesto limpio y verificaciones propias. Los enlaces, artefactos, capturas y límites están en el [cierre de entrega del 2026-11-19](../docs/releases/2026-11-19-sedepulso.md). Las filas de primera entrega conservan su contexto histórico.

| Comprobación | Resultado |
| --- | --- |
| Punto de partida | Salud, Angular y SignalStore; commit inicial `3fbd4162e8e811cca0bfcccd18c362fbfd4bacef`. |
| Revisión de arquitectura y nombre | SedePulso y microservicios documentados el 2026-11-19. |
| Pruebas/build de la primera entrega | 2026-11-19: 20/20 Node, 12/12 Angular; build SSR sin warnings; cfn-lint de cuatro templates y diff --check aprobados. Recorrido real en navegador local con recarga de historial, consola limpia y vista móvil sin desbordamiento. |
| Primera publicación development y DNS | Cuatro stacks completos en us-east-1. HTTPS verificado en https://sedepulso-development.lynxpardelle.com; CloudFront ECQSEKLOPMF1Q. Releases iniciales frontend/full 6165448df2efdb91 y backend c66e9d4f286e0523; los actuales se identifican por los manifiestos CI. |
| Smoke Cognito/IAM/DynamoDB | 2026-11-19 13:05 America/Mexico_City: 24 comprobaciones aprobadas con usuarios Cognito y persistencia DynamoDB; 3 identidades temporales y sus datos eliminados. |
| CI con rol OIDC | Bootstrap y variables por ambiente configurados; asunción, deploy y tres smokes propios aprobados en cada ambiente. |
| Testing y producción | Publicados y verificados; correo/confirmación propios y limpieza aprobados. Producción también completó PKCE/callback, sede, recarga, logout y guardia de sesión en navegador. |
| Piloto real | Pendiente de operación participante, usuarios/sedes autorizados, cuatro semanas de métricas y decisión de renovación. Sin demanda validada. |

### Evidencia y límites de esta entrega

- Base Git histórica: `3fbd4162e8e811cca0bfcccd18c362fbfd4bacef`; rama de implementación conservada `feature/sedepulso-serverless`. La base se publicó en GitHub en `c54b955`, registro/OIDC en `2045774` y recuperación en `f503e6c`. Sólo los artefactos de la primera entrega anterior al commit registraban `dirty=true`; los manifiestos actuales de CI tienen commit/rama exactos y `dirty=false`. El [cierre de entrega](../docs/releases/2026-11-19-sedepulso.md) identifica los tres commits de runtime verificados y sus artefactos.
- Stacks: `sedepulso-development-platform`, `sedepulso-development-assets`, `sedepulso-development-inspections` y `sedepulso-development-frontend`.
- El navegador completó alta, programación, cierre e historial tras recargar contra la demostración local. La API real de los tres ambientes verificó persistencia y aislamiento con JWT. En producción el navegador completó correo, login PKCE S256/callback, sede coordinadora, recarga, logout y rechazo de `/app` sin sesión; los tokens de los smokes API se obtuvieron mediante autenticación administrativa de identidades efímeras. El registro y la landing también se verificaron en móvil. No se presenta todo el CRUD UI como recorrido manual ejecutado en cada ambiente.
- HTTPS, HTML SSR y JavaScript devolvieron `200`; acceso anónimo directo a Function URL y objeto S3 devolvió `403`.
- Reportes locales ignorados: `infra/.artifacts/smoke-development.json`, `web-development.json`, `manifest.json` y `development.json`. Capturas: `test-results/sedepulso-public.jpg` y `sedepulso-mobile.jpg`.
- Templates empaquetados y manifiesto se archivaron en el bucket privado versionado por ambiente/release/servicio. El despliegue verifica hashes antes de publicar.
- La ampliación se integra y promueve mediante PR y GitHub Actions. Las verificaciones por ambiente y pendientes actuales se registran a continuación; el piloto comercial y el canal de avisos permanecen como decisiones de operación.

## 7. Riesgos y decisiones posteriores

- GSI eventual: confirmar cierre desde registro primario.
- Access es dependencia síncrona; un fallo no abre autorización.
- Inspections depende de contrato Assets; cambios incompatibles requieren migración.
- CDN y SSR no deben reutilizar datos autenticados entre usuarios.
- Tablas y backups pueden sobrevivir al stack: comprobar recuperación antes del piloto.
- Logs retienen 14 días; alarmas requieren canal y destinatario para entrega de avisos.
- Recordatorios, fotografías, sensores, correctivo y operación sin conexión quedan fuera.
- Precio, disposición de pago y utilidad de evidencia textual requieren comprador real.

## 8. Documentación relacionada

[Producto](../PRODUCTO.md) · [Arquitectura](../docs/architecture/ARCHITECTURE.md) · [ADR](../docs/architecture/adr/0002-microservicios-y-angular-ssr.md) · [Marca](../docs/branding.md) · [Promoción](../docs/promocion.md) · [Runbook](../docs/runbooks/despliegue.md)

## Ampliación de registro, planes y promoción (2026-11-19)

| Tarea | Entrega | Evidencia/estado |
| --- | --- | --- |
| TASK-011 | Landing comercial con propuesta, casos de uso, FAQ y planes. | Publicada y verificada en los tres ambientes; capturas de producción y móvil. |
| TASK-012 | Registro, confirmación/reenvío y aprovisionamiento aislado. | Onboarding, formularios y cliente Cognito probados. Correo real confirmado en development 21:18:51, testing 22:42:07 y production 23:04:54 UTC; sede coordinadora automática y cleanup comprobados. Login/logout browser producción 23:06:43 UTC. |
| TASK-013 | OIDC real y roles por ambiente, sin claves de larga duración. | Completada: los tres runs finales pasaron verify/deploy/smokes con roles por ambiente, boundaries conservadas y WAF sobre pools exactos. Evidencia en runbook OIDC y cierre de entrega. |
| TASK-014 | Recuperación de Access mediante backup/restauración aislada. | Aprobada: marcador comparado, tabla/backup/marcador temporales eliminados. Ocho pruebas de guardas y linaje; alcance en runbook. |
| TASK-015 | Propuesta Piloto, Operación y Red. | Documentada; sólo Piloto habilitado. Sin Stripe, precios, pagos ni conversión automática. |
| TASK-016 | Promoción development → testing → main con verificaciones. | Completada: PR #10/#15/#17 hacia testing y PR #18 hacia main, con publicación y comprobaciones propias por ambiente, sin bypass de protecciones. |
| TASK-017 | Resolver observaciones de PR #10 antes de promover. | Completada: serialización de cargas/escrituras, bucket de bootstrap privado/versionado y alarma HTTP 5xx. Regresiones reproducidas/corregidas; cuatro hilos respondidos y resueltos. |
| TASK-018 | Verificar primera creación con roles OIDC. | Completada: TagResource de Stage demostrado con STS y en CREATE real de testing/production. Excepción W3037 limitada a su managedpolicy; temporales retirados y ambas tablas huérfanas vacías eliminadas con guardias, conservando tabla activa. |
| TASK-019 | Permitir configuración de access logs en primera creación. | Completada: siete acciones finitas de configuración en us-east-1, sin lectura global de eventos; 17/17 CI y lint aprobados. Stage+logging y recepción real de health200 verificados, temporales retirados y policy compartida preservada en pruebas. |

Fuentes de ejecución remota: [PR #8](https://github.com/LynxPardelle/mantenimiento-por-sede/pull/8), [Actions](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/workflows/ci.yml) y artefactos JSON por ambiente. Un check de promoción valida el origen de la rama; la aceptación del ambiente exige el job de despliegue y sus tres comprobaciones.

El ejercicio de recuperación del 2026-11-19 verificó un marcador en una copia de Access y terminó su limpieza a las 20:55:37 UTC; no acredita todavía recuperación coordinada de todos los dominios ni un RTO/RPO comercial.

Verificación final: 41/41 pruebas backend, 17/17 de CI y 31/31 de Angular, build SSR y lint aprobados. Cada ambiente pasó 24 comprobaciones de dominio, cinco de alta aislada y web/orígenes privados; tres reportes y manifiesto descargados/comprobados por run. Las capturas y commits exactos están en el [cierre de entrega](../docs/releases/2026-11-19-sedepulso.md). El buzón autorizado sólo se usó para cuentas de prueba eliminadas; no se versionan dirección, código, contraseña, tokens o datos personales.

La [guía operativa del piloto](../docs/producto/piloto-operativo.md) prepara semanas 0–4, métricas y decisión de continuidad; no acredita participante, aceptación ni precio.

## TASK-006: instrumentación y seguimiento del piloto

El 2026-11-19 se implementó un recolector operacional de sólo lectura, separado de las Lambdas del producto. Consulta únicamente Assets e Inspections para cohortes explícitas; no lee nombres, texto de notas o valores de autor. Los informes guardan agregados por código en un bucket privado, versionado y cifrado, con retención definida para reportes. La [guía de operación](../docs/runbooks/piloto-metricas.md) permite retomarlo desde remoto.

- Observación diaria en GitHub Actions a las 07:17 GMT-6; revisión de Codex en este chat a las 08:00. La frescura se comprueba contra `checkedAt`, con señal de atraso después de 26 horas.
- Semanas 1–4 por calendario local: puntualidad con numerador/denominador, pendientes incluidos, cierres, resultados, inventario y evidencia estructural. Tasas sin denominador son nulas. Los cortes semanales se crean una sola vez y se reutilizan al calcular los totales posteriores.
- Fechas `createdAt` del servidor para nuevas altas y programaciones, estables al reintentar. No se reconstruyen fechas ausentes en registros anteriores.
- Registro privado inicial vacío: `awaiting-participant`, `pilotWeek=null`. Las pruebas técnicas no inscriben un participante ni demuestran demanda.
- Línea base puntual de producción 23:23:06–17 UTC: Access, Assets e Inspections sin registros. Nueve alarmas propias en OK, sin canal de notificación. Los metadatos aproximados del observador no equivalen a un conteo de clientes.
- Historial comparado con la línea base, esfuerzo humano, utilidad semántica de las notas, coste atribuible y aceptación de oferta requieren evidencia real. No se asignan ceros ficticios ni se activa Stripe.

Verificación final: 43 pruebas backend, 19 CI/IAM, 27 del piloto y 31 Angular aprobadas, build SSR y lint de los cuatro templates y del bootstrap aprobados. La primera comprobación OIDC encontró que `DescribeAlarms` por prefijo requiere alcance global; se reprodujo con STS y se corrigió consultando los nombres exactos descubiertos en stacks propios, sin ampliar el ARN de CloudWatch.

Las promociones por PR #22/#23 → #24 → #25 terminaron con CI/deploy completos: development `00ce03a`, run `44640475740`; testing `1c0f1b3`, run `44641440002`; producción `e1dae94`, run `44642357476`. Cada ambiente pasó 26 comprobaciones de dominio, cinco de registro y verificación web, con datos temporales limpiados, además de observación con su rol OIDC separado. Los tres informes se leyeron desde S3 y coincidieron con commit/run, AES256, versionado, nueve alarmas OK y facturación deshabilitada.

El workflow independiente del observador también pasó en producción, run `44643237388`, con lectura posterior del reporte. El cron de las 07:17 GMT-6 está configurado; la siguiente ejecución futura del cron aún no ha ocurrido. El heartbeat local está activo a las 08:00 GMT-6. El corte administrativo posterior al smoke, 2026-11-20 00:07:15–27 UTC (19 de noviembre 18:07 GMT-6), confirmó las tres tablas sin registros persistidos; no mide visitantes ni cuentas Cognito sin espacio aprovisionado.

El [cierre de TASK-006](../docs/releases/2026-11-19-piloto.md) y sus [recibos técnicos](../docs/releases/2026-11-19-piloto-evidence.json) permiten continuar desde remoto. TASK-006 sigue abierto únicamente por la operación real, su línea base, cuatro semanas observadas y decisión comercial: `awaiting-participant`, `pilotWeek=null`. Stripe permanece deshabilitado.
