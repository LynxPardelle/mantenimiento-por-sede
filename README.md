# SedePulso

**El mantenimiento de cada sede, al día.** Producto de ZooBeriah Systems para organizar equipos, programar inspecciones preventivas y consultar su resultado e historial en operaciones con varias sedes.

La primera versión cubre inventario, inspecciones manuales y evidencia textual. La hipótesis inicial de comprador es una operación con refrigeración comercial; el nombre permite atender otros equipos sin cambiar la identidad. El piloto y la validación comercial siguen pendientes.

## Arquitectura en la nube

Angular 22 y NgRx SignalStore forman la interfaz. Angular SSR se sirve desde una Lambda Node.js 24 ARM64 detrás de CloudFront; los estáticos se sirven desde S3 privado. CloudFront usa Origin Access Control para ambos orígenes y dirige `/api/*` a API Gateway HTTP API. La Lambda SSR no tiene permisos DynamoDB.

El backend se divide en microservicios con Lambdas, roles, tablas y stacks propios: plataforma y Access, Assets e Inspections. Los servicios resuelven pertenencia y rol invocando Access por IAM; Inspections valida el equipo invocando Assets. No comparten acceso directo a sus tablas. Cognito proporciona inicio de sesión con authorization code y PKCE, cliente público sin secreto y sin registro abierto.

| Ambiente | Rama | Dominio |
| --- | --- | --- |
| development | `development` | `sedepulso-development.lynxpardelle.com` |
| testing | `testing` | `sedepulso-testing.lynxpardelle.com` |
| production | `main` | `sedepulso.lynxpardelle.com` |

Development está publicado y verificado en [sedepulso-development.lynxpardelle.com](https://sedepulso-development.lynxpardelle.com). Testing y producción siguen pendientes. El acceso operativo requiere usuarios de Cognito y sedes asignadas; no hay registro abierto. La evidencia y los límites de verificación se registran en el [plan](plan/feature-mantenimiento-1.md).

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
cfn-lint --template infra/template.yaml infra/services/assets.yaml infra/services/inspections.yaml infra/frontend.yaml
```

Para empaquetar y desplegar development:

```sh
node infra/tools/package.mjs
node infra/tools/deploy.mjs --environment development
```

El despliegue modifica recursos AWS. El [runbook](docs/runbooks/despliegue.md) explica requisitos, identidades técnicas, smoke y actualización de un servicio. Testing y producción siguen `development → testing → main`.

## Documentación y continuidad

- [Producto y piloto](PRODUCTO.md).
- [Arquitectura y contratos](docs/architecture/ARCHITECTURE.md).
- [Plan y evidencia](plan/feature-mantenimiento-1.md).
- [Marca y dominios](docs/branding.md).
- [Promoción entre ambientes](docs/promocion.md).
- [Operación y despliegue](docs/runbooks/despliegue.md).

La carpeta `mantenimiento-por-sede`, el origin `LynxPardelle/mantenimiento-por-sede` y el archivo del plan conservan sus identificadores históricos para mantener los enlaces y el proyecto remoto. La identidad visible y la infraestructura nueva usan **SedePulso** y `sedepulso`.
