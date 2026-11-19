# SedePulso

**El mantenimiento de cada sede, al día.** Producto de ZooBeriah Systems para organizar equipos, programar inspecciones preventivas y consultar su resultado e historial en operaciones con varias sedes.

La primera versión cubre inventario, inspecciones manuales y evidencia textual. La hipótesis inicial de comprador es una operación con refrigeración comercial; el nombre permite atender otros equipos sin cambiar la identidad. El piloto y la validación comercial siguen pendientes.

## Arquitectura en la nube

Angular 22 y NgRx SignalStore forman la interfaz. Angular SSR se sirve desde una Lambda Node.js 24 ARM64 detrás de CloudFront; los estáticos se sirven desde S3 privado. CloudFront usa Origin Access Control para ambos orígenes y dirige `/api/*` a API Gateway HTTP API. La Lambda SSR no tiene permisos DynamoDB.

El backend se divide en microservicios con Lambdas, roles, tablas y stacks propios: plataforma y Access, Assets e Inspections. Los servicios resuelven pertenencia y rol invocando Access por IAM; Inspections valida el equipo invocando Assets. No comparten acceso directo a sus tablas. Cognito proporciona inicio de sesión con authorization code y PKCE, cliente público sin secreto y registro con correo verificado.

| Ambiente | Rama | Dominio |
| --- | --- | --- |
| development | `development` | `sedepulso-development.lynxpardelle.com` |
| testing | `testing` | `sedepulso-testing.lynxpardelle.com` |
| production | `main` | `sedepulso.lynxpardelle.com` |

Development está publicado y verificado en [sedepulso-development.lynxpardelle.com](https://sedepulso-development.lynxpardelle.com). Testing y producción siguen pendientes. La versión nueva añade registro público con correo confirmado y crea una organización con su primera sede; la publicación y verificación de cada ambiente se consulta en GitHub Actions. La evidencia y los límites de verificación se registran en el [plan](plan/feature-mantenimiento-1.md).

## Registro y planes

La landing explica el producto y compara los planes. `/registro` solicita organización, sede, zona horaria, correo y contraseña; después de confirmar el código recibido se crea un espacio propio con rol coordinador. Las pertenencias existentes se conservan y el cliente no elige roles ni organizaciones internas.

Piloto está disponible gratuitamente en esta etapa, sin tarjeta ni cobros automáticos. Operación y Red están en diseño; precios y funciones adicionales deben validarse antes de venderse. Stripe no está integrado. Consulta la [propuesta de planes](docs/producto/planes-y-suscripciones.md), la [guía de piloto de cuatro semanas](docs/producto/piloto-operativo.md) y el [contrato de registro](docs/contracts/registration.md).

## Desarrollo local

Requiere Node.js 24.15 o superior de la rama 24 y npm 11. Instala las versiones de los lockfiles:

```sh
npm --prefix infra ci
npm --prefix frontend ci
node infra/tools/serve-local.mjs
```

En otra terminal:

```sh
npm --prefix frontend start
```

Abre `http://localhost:4200`. El proxy envía `/api` al adaptador en `127.0.0.1:4301`. La demostración local usa datos aislados; no sustituye la validación de Cognito, IAM, DynamoDB y aislamiento de la nube.

## Verificación y despliegue

```sh
npm --prefix frontend test -- --watch=false
npm --prefix frontend run build
node --test infra/test/*.test.mjs
node --test infra/ci/*.test.mjs
cfn-lint --template infra/template.yaml infra/services/assets.yaml infra/services/inspections.yaml infra/frontend.yaml
```

Para empaquetar y desplegar development desde PowerShell, una vez completado el [bootstrap OIDC y vinculado el pool exacto](docs/runbooks/ci-oidc.md):

```powershell
node infra/tools/package.mjs
$env:COGNITO_WAF_POOL_READY = 'true'
node infra/tools/deploy.mjs --environment development
```

Un ambiente nuevo usa primero `COGNITO_WAF_POOL_READY=false`; el script crea sólo plataforma y se detiene. Repetir el bootstrap y reejecutar el workflow original de push con el pool preparado, antes de publicar el resto. Las entregas habituales se hacen por GitHub Actions.

El despliegue modifica recursos AWS. El [runbook](docs/runbooks/despliegue.md) explica requisitos, identidades técnicas, smoke y actualización de un servicio. Testing y producción siguen `development → testing → main`.

## Documentación y continuidad

- [Producto y piloto](PRODUCTO.md).
- [Arquitectura y contratos](docs/architecture/ARCHITECTURE.md).
- [Plan y evidencia](plan/feature-mantenimiento-1.md).
- [Marca y dominios](docs/branding.md).
- [Promoción entre ambientes](docs/promocion.md).
- [Operación y despliegue](docs/runbooks/despliegue.md).
- [OIDC de GitHub Actions](docs/runbooks/ci-oidc.md).
- [Recuperación de datos](docs/runbooks/recuperacion.md).

La carpeta `mantenimiento-por-sede`, el origin `LynxPardelle/mantenimiento-por-sede` y el archivo del plan conservan sus identificadores históricos para mantener los enlaces y el proyecto remoto. La identidad visible y la infraestructura nueva usan **SedePulso** y `sedepulso`.
