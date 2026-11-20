# Operación y despliegue de SedePulso

Este procedimiento no acredita por sí mismo que se haya ejecutado. Registrar evidencia y límites por ambiente en el [plan](../../plan/feature-mantenimiento-1.md).

## Requisitos

Node.js 24.15 o superior de la rama 24, npm 11, AWS CLI y sesión AWS autorizada. La cuenta necesita permisos para CloudFormation/SAM, Lambda, IAM, DynamoDB, HTTP API, Cognito, S3, CloudFront, ACM y Route 53, y acceso a la zona `lynxpardelle.com`.

CloudFront requiere certificado ACM en `us-east-1`. No sustituir nameservers ni modificar registros de otros productos. No incluir tokens, claves o contraseñas en documentación, logs, CI o artefactos versionados.

## Preparación local

```sh
npm --prefix infra ci
npm --prefix frontend ci
npm --prefix frontend test -- --watch=false
npm --prefix frontend run build
node --test infra/test/*.test.mjs
node --test infra/ci/*.test.mjs
node --test infra/pilot/*.test.mjs
cfn-lint --template infra/template.yaml infra/services/assets.yaml infra/services/inspections.yaml infra/services/pilot.yaml infra/frontend.yaml
node infra/tools/package.mjs
```

Para la demostración: `node infra/tools/serve-local.mjs` y, en otra terminal, `npm --prefix frontend start`. Escucha en localhost y usa datos aislados. No valida Cognito, IAM o persistencia DynamoDB. Si 4200 está ocupado por otro producto, usa `node infra/tools/serve-local.mjs --frontend-port 4217` y `npm --prefix frontend start -- --host 127.0.0.1 --port 4217`; no detengas procesos ajenos.

## Desplegar development

El workflow obtiene `COGNITO_WAF_POOL_READY` de las variables del environment de GitHub. El orquestador exige un valor explícito `true` o `false`; no basta con invocar el script sin esa configuración. El bootstrap `node infra/tools/configure-ci.mjs` comprueba los pools existentes y publica ese valor, los roles OIDC/CloudFormation y `SIGNUP_WEB_ACL_ARN` por ambiente.

Para una plataforma de development ya creada y cuyo pool exacto fue autorizado por el bootstrap, desde PowerShell en la raíz:

```powershell
$env:COGNITO_WAF_POOL_READY = 'true'
node infra/tools/deploy.mjs --environment development
```

Usar `true` únicamente después de que `configure-ci.mjs` haya descubierto y autorizado el ARN real del pool. El comando modifica AWS y despliega plataforma → Pilot → Assets → Inspections → frontend. Conservar región, nombres y outputs de los cinco stacks. El dominio esperado es `https://sedepulso-development.lynxpardelle.com`; comprobar emisión del certificado, DNS y CloudFront antes de informar disponibilidad.

La creación inicial de cada ambiente tiene dos fases:

1. Ejecutar `configure-ci.mjs` desde la sesión administradora autorizada. Si el pool todavía no existe, el bootstrap publica `COGNITO_WAF_POOL_READY=false`. La primera ejecución del workflow crea sólo la plataforma con `SignupWebAclArn` vacío y se detiene deliberadamente con salida no exitosa. No publica los servicios ni el frontend, y no acredita una entrega del ambiente.
2. Volver a ejecutar `configure-ci.mjs`: descubre el pool creado, comprueba cuenta/región/tags y autoriza su ARN exacto para la asociación WAF. Publica `COGNITO_WAF_POOL_READY=true`. Reejecutar el workflow del mismo ambiente para asociar el ACL y completar servicios, frontend y comprobaciones.

Para crear únicamente esa plataforma inicial en una sesión local de development:

```powershell
$env:COGNITO_WAF_POOL_READY = 'false'
node infra/tools/deploy.mjs --environment development --service platform
node infra/tools/configure-ci.mjs
$env:COGNITO_WAF_POOL_READY = 'true'
node infra/tools/deploy.mjs --environment development
```

La detención tras la primera instrucción de despliegue es intencional: comprobar que la plataforma terminó de crearse y ejecutar después las instrucciones siguientes. La variable local no sustituye la verificación del bootstrap. Si se reemplaza un pool, repetir estas fases para autorizar el nuevo ARN; no ampliar los permisos a todos los pools. El [runbook OIDC](ci-oidc.md) explica el alcance de roles, las variables y el enrutamiento WAF del registro.

Para actualizar un único servicio conservando sus contratos:

```powershell
$env:COGNITO_WAF_POOL_READY = 'true'
node infra/tools/deploy.mjs --environment development --service assets
```

Para actualizar sólo la inscripción y el exportador del piloto con sus contratos actuales:

```powershell
$env:COGNITO_WAF_POOL_READY = 'true'
node infra/tools/deploy.mjs --environment development --service pilot
```

Para preparar sólo backend sin recompilar Angular, usa `node infra/tools/package.mjs --backend-only`.

Los valores de `--service` son `platform`, `pilot`, `assets`, `inspections`, `frontend` y `all`. La entrega de un servicio no requiere recrear sus datos. Si cambia un contrato o output consumido, coordinar la actualización de sus dependientes. Antes de incorporar Pilot a un ambiente existente, aplicar el bootstrap actualizado para autorizar su stack y la invocación del exportador exacto; no ampliar permisos globales para evitar esa preparación.

## Identidades y smoke

Para ejecutar la prueba de nube de development:

```sh
node --use-system-ca infra/tools/smoke-cloud.mjs
```

El smoke crea identidades efímeras de dos organizaciones y sedes y limpia sus recursos de prueba en `finally`. Comprobar también su resultado y limpieza; no asumir que un proceso interrumpido alcanzó el bloque final. No publicar contraseñas o tokens en el reporte.

La versión actual ejecuta 60 comprobaciones de dominio, incluidas autorización de Pilot, inscripción/línea base, revisiones semanales, inmutabilidad e idempotencia, comparación numérica, ausencias y exportación privada. Los fixtures llevan procedencia `technical` en la pertenencia administrada de Access; no se clasifican por nombre y no se convierten en cohortes reales en producción. El helper `infra/tools/weekly-smoke.mjs` simula un calendario maduro sólo para un fixture recién creado y marcado: verifica membresía, organización/sede, tablas del mismo ambiente, clasificación, códigos y ausencia de revisiones antes de dos escrituras condicionadas. No cambia el reloj HTTP ni las reglas de la aplicación.

La limpieza se limita al namespace efímero propio `smoke-a-<8 hex>` y a la tabla Pilot descubierta del ambiente. Prevalida seis claves conocidas con lectura consistente antes de cualquier borrado: inscripción, cuatro revisiones e índice exportable. Una inscripción exige clasificación técnica y código esperado; la excepción de clasificación ausente sólo admite un borrador explícito. Cada revisión se ata a clasificación/código/semana; el índice, a clasificación/código/organización/sede. Usa eliminación condicionada y confirma ausencia. Un fallo o una interrupción no autoriza borrar otras cohortes o tablas. El helper y sus guardas se encuentran en `infra/tools/pilot-smoke.mjs`.

Para asignar una sede a una persona que ya existe en Cognito:

```sh
node infra/tools/provision-member.mjs --environment development --username <usuario-cognito-existente> --org-id <organizacion> --site-id <sede> --site-name <nombre> --role coordinator --time-zone America/Mexico_City
```

El script no crea usuarios ni envía correos y no cambia la organización de una membresía existente. `--role` acepta `coordinator` o `technician`. Comprobar el `sub` de la identidad y los datos de sede autorizados; no inventar organizaciones o asignaciones del comprador.

El smoke y el recorrido manual deben comprobar sedes, alta de equipo, programación, pendientes, cierre e historial. Repetir altas y cierre; probar token inválido, uso incorrecto, rol insuficiente, otra organización y cursores ajenos. La idempotencia de altas/programación se conserva al menos siete días y hasta el borrado eventual de TTL; no garantiza deduplicación indefinida. Confirmar el cierre en el registro primario, porque el índice pendiente es eventual.

Para Pilot, abrir `/app/piloto` como coordinador, guardar y recargar un borrador, indicar un inicio futuro y una semana base local de siete días completos, y confirmar únicamente datos técnicos durante QA. La inscripción es única y queda conservada; repetir la confirmación consulta el original, no renueva el periodo. Verificar también el caso de técnico sin permiso y errores recuperables. El [contrato de onboarding](../contracts/pilot-enrollment.md) distingue borrador, confirmación y procedencia de la línea base.

## Verificar la web

Comprobar HTML SSR, hidratación sin errores, navegación y estáticos. Verificar que `/api/*` llega a HTTP API y que no se cachean respuestas operativas ni datos personalizados entre usuarios.

Probar acceso anónimo directo a S3 y Function URL: debe denegarse. La política de SSR limita CloudFront al ARN de la distribución e incluye `lambda:InvokeFunctionUrl` y `lambda:InvokeFunction`. Comprobar PKCE, callback del ambiente y cierre de sesión.

Un `200` de salud sólo verifica Health. No confirma autorización, tablas o renderizado SSR.

## CI, promoción y operación

Las alarmas Lambda detectan fallos de invocación. La alarma `ApiServerErrors` usa `AWS/ApiGateway`, métrica HTTP API `5xx`, dimensión `ApiId`, suma de cinco minutos y umbral de un error. Incluye las respuestas 500 manejadas por Access, Assets e Inspections que no incrementan Lambda Errors. Consultar el estado de alarma y los access logs por requestId/ruta/status; no registrar cuerpos, tokens o datos personales para diagnosticar. Referencia: [métricas oficiales de HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-metrics.html). Su configuración no acredita una prueba de fallo real ni entrega de notificaciones; el canal y destinatario siguen pendientes de decisión operativa.

Configurar un rol OIDC de alcance mínimo y `AWS_DEPLOY_ROLE_ARN` para GitHub Actions. Mientras no esté verificado, distinguir CI de pruebas de un pipeline capaz de publicar. Seguir [development → testing → main](../promocion.md): testing usa `sedepulso-testing.lynxpardelle.com`; producción, `sedepulso.lynxpardelle.com`.

La nueva API Pilot también contribuye a la métrica HTTP `5xx` cuando devuelve un error manejado. Sus dos alarmas Lambda adicionales llevan la definición a once alarmas por ambiente. El observador consulta los nombres exactos de los cinco stacks, verifica `billingEnabled=false` y persiste su informe privado con el rol OIDC separado. Comprobar el resultado y lectura posterior; estos detectores no acreditan entrega de avisos. Véase [métricas y seguimiento](piloto-metricas.md).

Los logs tienen retención de 14 días. Las alarmas de errores requieren definir canal y destinatario para entregar avisos. El ejercicio de recuperación de Access en development pasó el 2026-11-19: comparó un marcador restaurado con su valor esperado y comprobó la eliminación de tabla, backup y marcador temporales. El [runbook de recuperación](recuperacion.md) conserva alcance y evidencia. La recuperación coordinada de inventario, inspecciones, identidad y estáticos, así como RTO/RPO comerciales, todavía no está acreditada.

Si falla un stack, revisar sus eventos y resolver antes de continuar con los dependientes. No borrar tablas, usuarios o buckets para forzar una entrega. Los recursos conservados pueden sobrevivir a la retirada del stack.

El empaquetado registra hashes de código, dependencias y templates, más commit, rama y estado local. El despliegue comprueba esos hashes y conserva templates empaquetados y manifiesto en el bucket privado de artefactos por ambiente/release/servicio. Antes de actualizar SSR se suben los estáticos con nuevos hashes; los anteriores se conservan. Para revertir código, redesplegar el template empaquetado anterior compatible del servicio. El ejercicio de Access no sustituye un procedimiento de recuperación coordinada de la aplicación. Los cambios de esquema o contrato requieren una migración; revertir sólo una Lambda puede ser insuficiente.

Registrar fecha, ambiente, commit o estado local, pruebas, outputs, URL comprobada y pendientes. No marcar testing, producción o piloto completos cuando sólo se comprobó development.
