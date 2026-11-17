# Mantenimiento por Sede

Base de ZooBeriah Systems para dar seguimiento a equipos e inspecciones preventivas. La aplicación de arranque consulta la disponibilidad de la API y permite volver a comprobarla. El flujo de inventario e inspecciones está en el plan de la primera funcionalidad.

## Desarrollo local

Requiere Node.js 24.15 o superior de la rama 24 y npm 11. Angular 22 y NgRx 22 se instalan con el lockfile de `frontend/`.

Desde la raíz, instala las dependencias y arranca el adaptador HTTP local.

```sh
npm --prefix frontend ci
node infra/tools/serve-local.mjs
```

En otra terminal arranca Angular.

```sh
npm --prefix frontend start
```

Abre [la aplicación local](http://localhost:4200). Angular envía `GET /api/health` al adaptador en el puerto 4301. El adaptador ejecuta el mismo handler que declara SAM. Puedes comprobar la respuesta directamente en [la ruta local de salud](http://127.0.0.1:4301/api/health).

## Verificación

```sh
npm --prefix frontend test -- --watch=false
npm --prefix frontend run build
node --test infra/test/health.test.mjs
cfn-lint --template infra/template.yaml
```

El template SAM declara HTTP API, Lambda y una tabla DynamoDB bajo demanda. Los comandos anteriores ejecutan pruebas, compilación y validación estática en local.

## Documentación

- [Producto y alcance del piloto](PRODUCTO.md)
- [Arquitectura y contratos](docs/architecture/ARCHITECTURE.md)
- [Plan de inventario e inspecciones](plan/feature-mantenimiento-1.md)
