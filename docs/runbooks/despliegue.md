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
cfn-lint --template infra/template.yaml infra/services/assets.yaml infra/services/inspections.yaml infra/frontend.yaml
node infra/tools/package.mjs
```

Para la demostración: `node infra/tools/serve-local.mjs` y, en otra terminal, `npm --prefix frontend start`. Escucha en localhost y usa datos aislados. No valida Cognito, IAM o persistencia DynamoDB. Si 4200 está ocupado por otro producto, usa `node infra/tools/serve-local.mjs --frontend-port 4217` y `npm --prefix frontend start -- --host 127.0.0.1 --port 4217`; no detengas procesos ajenos.

## Desplegar development

Desde la raíz:

```sh
node infra/tools/deploy.mjs --environment development
```

El comando modifica AWS. Despliega plataforma → Assets → Inspections → frontend. Conservar región, nombres y outputs de los stacks. El dominio esperado es `https://sedepulso-development.lynxpardelle.com`; comprobar emisión del certificado, DNS y CloudFront antes de informar disponibilidad.

Para actualizar un único servicio conservando sus contratos:

```sh
node infra/tools/deploy.mjs --environment development --service assets
```

Para preparar sólo backend sin recompilar Angular, usa `node infra/tools/package.mjs --backend-only`.

Los valores de `--service` son `platform`, `assets`, `inspections`, `frontend` y `all`. La entrega de un servicio no requiere recrear sus datos. Si cambia un contrato o output consumido, coordinar la actualización de sus dependientes.

## Identidades y smoke

Para ejecutar la prueba de nube de development:

```sh
node --use-system-ca infra/tools/smoke-cloud.mjs
```

El smoke crea identidades efímeras de dos organizaciones y sedes y limpia sus recursos de prueba en `finally`. Comprobar también su resultado y limpieza; no asumir que un proceso interrumpido alcanzó el bloque final. No publicar contraseñas o tokens en el reporte.

Para asignar una sede a una persona que ya existe en Cognito:

```sh
node infra/tools/provision-member.mjs --environment development --username <usuario-cognito-existente> --org-id <organizacion> --site-id <sede> --site-name <nombre> --role coordinator --time-zone America/Mexico_City
```

El script no crea usuarios ni envía correos y no cambia la organización de una membresía existente. `--role` acepta `coordinator` o `technician`. Comprobar el `sub` de la identidad y los datos de sede autorizados; no inventar organizaciones o asignaciones del comprador.

El smoke y el recorrido manual deben comprobar sedes, alta de equipo, programación, pendientes, cierre e historial. Repetir altas y cierre; probar token inválido, uso incorrecto, rol insuficiente, otra organización y cursores ajenos. La idempotencia de altas/programación se conserva al menos siete días y hasta el borrado eventual de TTL; no garantiza deduplicación indefinida. Confirmar el cierre en el registro primario, porque el índice pendiente es eventual.

## Verificar la web

Comprobar HTML SSR, hidratación sin errores, navegación y estáticos. Verificar que `/api/*` llega a HTTP API y que no se cachean respuestas operativas ni datos personalizados entre usuarios.

Probar acceso anónimo directo a S3 y Function URL: debe denegarse. La política de SSR limita CloudFront al ARN de la distribución e incluye `lambda:InvokeFunctionUrl` y `lambda:InvokeFunction`. Comprobar PKCE, callback del ambiente y cierre de sesión.

Un `200` de salud sólo verifica Health. No confirma autorización, tablas o renderizado SSR.

## CI, promoción y operación

Configurar un rol OIDC de alcance mínimo y `AWS_DEPLOY_ROLE_ARN` para GitHub Actions. Mientras no esté verificado, distinguir CI de pruebas de un pipeline capaz de publicar. Seguir [development → testing → main](../promocion.md): testing usa `sedepulso-testing.lynxpardelle.com`; producción, `sedepulso.lynxpardelle.com`.

Los logs tienen retención de 14 días. Las alarmas de errores requieren definir canal y destinatario para entregar avisos. Verificar recuperación y backup antes del piloto con datos reales.

Si falla un stack, revisar sus eventos y resolver antes de continuar con los dependientes. No borrar tablas, usuarios o buckets para forzar una entrega. Los recursos conservados pueden sobrevivir a la retirada del stack.

El empaquetado registra hashes de código, dependencias y templates, más commit, rama y estado local. El despliegue comprueba esos hashes y conserva templates empaquetados y manifiesto en el bucket privado de artefactos por ambiente/release/servicio. Antes de actualizar SSR se suben los estáticos con nuevos hashes; los anteriores se conservan. Para revertir código, redesplegar el template empaquetado anterior compatible del servicio; la restauración de datos todavía requiere una prueba de recuperación. Los cambios de esquema o contrato requieren una migración; revertir sólo una Lambda puede ser insuficiente.

Registrar fecha, ambiente, commit o estado local, pruebas, outputs, URL comprobada y pendientes. No marcar testing, producción o piloto completos cuando sólo se comprobó development.
