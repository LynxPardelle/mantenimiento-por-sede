# Promoción de SedePulso entre ambientes

| Ambiente GitHub | Rama | Dominio |
| --- | --- | --- |
| development | `development` | `sedepulso-development.lynxpardelle.com` |
| testing | `testing` | `sedepulso-testing.lynxpardelle.com` |
| production | `main` | `sedepulso.lynxpardelle.com` |

El trabajo nuevo se integra en development. Se abre PR de development a testing y después de testing a main. Se usan merge commits en las promociones para conservar el historial. Una rama de implementación no llega directamente a testing o main.

## Control de origen

`promocion.yml` usa `pull_request_target` y la definición del destino. Sólo lee metadatos: compara ramas e identificador del repositorio, sin checkout ni ejecución del código del PR. Los checks son `zoo/promotion/testing` y `zoo/promotion/production`.

Estos checks validan origen, no pruebas ni publicación. Las reglas y ambientes activos se consultan en GitHub al promover; la definición en Git no acredita el estado actual de los rulesets de la cuenta. Una corrección de testing o main se implementa en development y sigue la misma cadena.

## CI y entrega

CI valida pruebas, build y templates. El deploy es condicional a `AWS_DEPLOY_ROLE_ARN`: sin esa variable no se publica. El rol se asume mediante OIDC, con confianza acotada al repositorio y ramas o ambientes autorizados; no se guardan claves AWS de larga duración.

El orquestador `infra/tools/deploy.mjs` selecciona dominio y stacks por ambiente. Development es el destino inicial. Testing y producción requieren la rama correspondiente y árbol limpio. Un deploy local de development no configura OIDC ni acredita que el pipeline remoto funcione.

Antes de promover, conservar evidencia de:

- Pruebas backend y frontend, build SSR y lint de todos los templates.
- Acceso por rol/sede y rechazo de otra organización.
- Idempotencia, concurrencia del cierre e historial persistido.
- HTTPS, Cognito, callback, OAC y orígenes privados.
- Outputs de stacks y recorrido de la aplicación publicada.

Identidades y datos de demostración no se trasladan a producción como datos de cliente. El piloto requiere usuarios y sedes autorizados.

## Comprobar controles

En el PR, verificar check de promoción y CI. Revisar Settings → Rules → Rulesets y Settings → Environments para confirmar reglas y ramas. La conexión OIDC y las tres publicaciones quedaron verificadas el 2026-11-19; el estado y los límites se registran en el [plan](../plan/feature-mantenimiento-1.md) y el [cierre de entrega](releases/2026-11-19-sedepulso.md). El [runbook](runbooks/despliegue.md) describe la operación.

[Rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) · [Ambientes GitHub](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
