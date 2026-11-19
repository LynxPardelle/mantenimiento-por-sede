---
goal: 'SedePulso: registrar y completar una inspección por sede con microservicios AWS y Angular SSR en Lambda'
date_created: 2026-11-17
date_updated: 2026-11-19
status: 'In Progress'
tags: ['feature', 'angular', 'aws-sam', 'microservices', 'ssr']
---

# Plan de la primera funcionalidad de SedePulso

El producto adopta **SedePulso** y `sedepulso.lynxpardelle.com`. Carpeta, repositorio y archivo del plan conservan sus identificadores históricos. La [arquitectura vigente](../docs/architecture/ARCHITECTURE.md) separa plataforma/Access, Assets, Inspections y frontend en stacks con datos e IAM propios.

El recorrido es iniciar sesión → elegir sede asignada → registrar equipo → programar inspección → consultar pendientes → cerrar → comprobar historial persistido. El piloto comercial requiere completar antes la verificación en nube con identidades y sedes aisladas.

## 1. Requisitos

- **REQ-001** Una persona coordinadora registra equipos y programa inspecciones en sedes asignadas.
- **REQ-002** Una persona técnica consulta pendientes, cierra y confirma el resultado persistido.
- **REQ-003** Historial con fecha, resultado, nota y autor del primer cierre. Autor proviene del access token verificado; hora UTC, del servidor.
- **REQ-004** Angular 22 y NgRx SignalStore; SSR desde Lambda Node.js 24 ARM64, estáticos S3 privado y CloudFront OAC. `/api/*` usa HTTP API.
- **REQ-005** Access, Assets e Inspections tienen funciones, roles, tablas y stacks propios. Sólo Access lee membresías. Las llamadas entre servicios usan IAM.
- **REQ-006** Ambientes aislados en `sedepulso-development.lynxpardelle.com`, `sedepulso-testing.lynxpardelle.com` y `sedepulso.lynxpardelle.com`.
- **SEC-001** HTTP API verifica JWT; backend exige `token_use=access`. Organización, pertenencia y rol se resuelven por `sub` en Access, nunca por datos elegidos por el cliente.
- **SEC-002** Token inválido o ausente: `401`; sede ajena: `404`; rol insuficiente en sede propia: `403`.
- **SEC-003** Cognito authorization code con PKCE, cliente sin secreto y registro abierto deshabilitado. SSR sin DynamoDB; S3 y Function URL privados por OAC.
- **CON-001** Vencimiento local a sede, separado de instante UTC del cierre.
- **CON-002** Altas y programación idempotentes por actor, operación y sede con `Idempotency-Key` y retención mínima de siete días, prolongada hasta el borrado eventual de TTL. Misma clave con contenido distinto: `409`.
- **CON-003** Cierre condicional: repetición idéntica conserva original; distintos cierres generan un cierre y un `409`. Confirmación por registro primario.
- **CON-004** Promoción development → testing → main. Conservar trabajo y ramas de otros productos.

## 2. Tareas y aceptación

La evidencia de implementación y verificación se registra por ambiente. El recorrido técnico en development no completa la promoción a testing/producción ni el piloto comercial.

| Tarea | Entrega | Aceptación | Estado al 2026-11-19 |
| --- | --- | --- | --- |
| TASK-000 | Marca SedePulso en interfaz, metadatos, paquetes y documentación. | Títulos nuevos consistentes; referencias históricas explicadas y conservadas. | Implementada y verificada en development |
| TASK-001 | Plataforma Cognito/JWT, Access/membresías, sedes y configuración pública. | Token inválido o de uso incorrecto rechazado; sede ajena `404`; rol insuficiente `403`; contexto resuelto por membresía. | Implementada y verificada en development |
| TASK-002 | Stack Assets con tabla, alta transaccional e inventario paginado. | Reintento no duplica; cursor no cruza sede; IAM no permite leer tablas de otros servicios. | Implementada y verificada en development |
| TASK-003 | Stack Inspections con programación, pendientes, historial y cierre. | Valida equipo por Assets; idempotencia y concurrencia correctas; elimina índice pendiente y confirma registro. | Implementada y verificada en development |
| TASK-004 | Sección Angular diferida, sede, inventario, programación y SignalStore. | Alta y programación completas; error de red conserva formulario y permite reintento sin duplicar. | Implementada y verificada en development |
| TASK-005 | Resultado e historial accesibles en móvil. | Cierre y consulta tras recarga; etiquetas, teclado y señal de éxito accesible. | Implementada y verificada en development |
| TASK-006 | Recorrido técnico de dos organizaciones/sedes y piloto de cuatro semanas. | Aislamiento/reintentos en nube; operación real participante; métricas con periodo y denominadores. | Recorrido técnico en nube aprobado; piloto real pendiente |
| TASK-007 | SSR Lambda, Function URL IAM, CloudFront/OAC, S3, ACM y DNS. | HTML/hidratación, estáticos, HTTPS, rechazo de acceso directo y API sin caché operativa. | Implementada y verificada en development |
| TASK-008 | Empaquetado y orquestador de cuatro stacks. | Orden correcto y actualización de un servicio sin redesplegar los demás con contrato estable. | Implementada y verificada en development |
| TASK-009 | CI de pruebas/build/lint y deploy condicional OIDC. | Checks pasan, rol y `AWS_DEPLOY_ROLE_ARN` configurados; promoción por PR permitido. | Conexión OIDC pendiente de comprobar |
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

| Comprobación | Resultado |
| --- | --- |
| Punto de partida | Salud, Angular y SignalStore; commit inicial `3fbd4162e8e811cca0bfcccd18c362fbfd4bacef`. |
| Revisión de arquitectura y nombre | SedePulso y microservicios documentados el 2026-11-19. |
| Pruebas/build de ampliación | 2026-11-19: 20/20 Node, 12/12 Angular; build SSR sin warnings; cfn-lint de cuatro templates y diff --check aprobados. Recorrido real en navegador local con recarga de historial, consola limpia y vista móvil sin desbordamiento. |
| Publicación development y DNS | Cuatro stacks completos en us-east-1. HTTPS verificado en https://sedepulso-development.lynxpardelle.com; CloudFront ECQSEKLOPMF1Q. Release frontend/full 6165448df2efdb91, backend c66e9d4f286e0523. |
| Smoke Cognito/IAM/DynamoDB | 2026-11-19 13:05 America/Mexico_City: 24 comprobaciones aprobadas con usuarios Cognito y persistencia DynamoDB; 3 identidades temporales y sus datos eliminados. |
| CI con rol OIDC | Workflow preparado; consulta del 2026-11-19 confirma que AWS_DEPLOY_ROLE_ARN no está configurada en variables del repositorio. Sin ejecución remota acreditada. |
| Testing y producción | Pendientes; no inferirlos de development. |
| Piloto real | Pendiente de operación participante, usuarios/sedes autorizados, cuatro semanas de métricas y decisión de renovación. Sin demanda validada. |

### Evidencia y límites de esta entrega

- Base Git: `3fbd4162e8e811cca0bfcccd18c362fbfd4bacef`; rama local `feature/sedepulso-serverless`, con cambios sin commit ni push. Los artefactos registran `dirty=true` y hashes de los bytes publicados; no atribuir estos cambios al commit base.
- Stacks: `sedepulso-development-platform`, `sedepulso-development-assets`, `sedepulso-development-inspections` y `sedepulso-development-frontend`.
- El navegador completó alta, programación, cierre e historial tras recargar contra la demostración local. La vista móvil no mostró desbordamiento; consola sin errores. En nube se verificó la página y la redirección real a Cognito con PKCE; el canje/callback está cubierto por pruebas Angular, y los tokens reales del smoke se obtuvieron mediante autenticación administrativa de identidades efímeras.
- HTTPS, HTML SSR y JavaScript devolvieron `200`; acceso anónimo directo a Function URL y objeto S3 devolvió `403`.
- Reportes locales ignorados: `infra/.artifacts/smoke-development.json`, `web-development.json`, `manifest.json` y `development.json`. Capturas: `test-results/sedepulso-public.jpg` y `sedepulso-mobile.jpg`.
- Templates empaquetados y manifiesto se archivaron en el bucket privado versionado por ambiente/release/servicio. El despliegue verifica hashes antes de publicar.
- Queda pendiente integrar/publicar la rama de trabajo, configurar y verificar OIDC de CI, promover development → testing → main, dar acceso a usuarios reales, elegir canal de alarmas y comprobar recuperación de datos antes del piloto.

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
