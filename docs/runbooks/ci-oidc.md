# OIDC y publicación de SedePulso

El bootstrap `node infra/tools/configure-ci.mjs` configura la federación del repositorio `LynxPardelle/mantenimiento-por-sede` con AWS sin guardar access keys en GitHub.

## Roles por ambiente

El stack `sedepulso-ci-oidc` en `us-east-1` crea, para cada ambiente `development`, `testing` y `production`:

- `sedepulso-ci-<ambiente>-github`: lo asume GitHub mediante OIDC; gestiona cambios de los cuatro stacks del ambiente, publica artefactos y ejecuta verificaciones con datos temporales.
- `sedepulso-ci-<ambiente>-cloudformation`: lo asume únicamente CloudFormation para crear o actualizar recursos. El rol GitHub sólo puede pasar ese rol específico a CloudFormation.
- `sedepulso-<ambiente>-runtime-boundary`: límite de los roles Lambda. Permite como máximo logs, operaciones de dominio sobre tablas del ambiente e invocaciones entre sus funciones. Cada función sigue necesitando sus permisos propios, que se intersectan con el límite.

CloudFormation sólo puede crear roles Lambda con esa permissions boundary y con el prefijo del ambiente. No puede editar sus roles CI ni modificar la boundary, ni adjuntar políticas administradas diferentes de `AWSLambdaBasicExecutionRole`. No se utiliza `AdministratorAccess`.

El proveedor existente `token.actions.githubusercontent.com` se reutiliza sin modificar thumbprints ni audiencias. Si falta, el bootstrap crea el proveedor con audiencia `sts.amazonaws.com`.

## Confianza y ramas

La confianza usa igualdad exacta de `aud=sts.amazonaws.com` y del subject del repositorio más `:environment:<ambiente>`. El repositorio usa subjects inmutables: `repo:LynxPardelle@74871143/mantenimiento-por-sede@1461766091`. El bootstrap consulta este prefijo en GitHub y conserva `use_immutable_subject=true`; no lo sustituye por el formato clásico ni admite forks u otros repositorios.

Como el subject OIDC con environment no incluye la rama, las políticas de deployment del environment son parte del control:

| Environment | Rama permitida |
| --- | --- |
| development | development |
| testing | testing |
| production | main |

El bootstrap conserva las protecciones existentes. Se detiene si un ambiente existente no restringe ramas o no admite la rama esperada. El workflow de promoción sigue validando PRs development → testing → main; una rama feature no publica directamente en testing o producción.

## Variables de GitHub

Cada environment contiene cuatro variables públicas de configuración, no secretos:

- `AWS_DEPLOY_ROLE_ARN`: rol OIDC del ambiente.
- `CLOUDFORMATION_ROLE_ARN`: rol de servicio que recibe `cloudformation deploy --role-arn`.
- `SIGNUP_WEB_ACL_ARN`: ACL regional compartido para dirigir el signup de Cognito al registro completo.
- `COGNITO_WAF_POOL_READY`: `true` sólo cuando el bootstrap comprobó el pool y autorizó su ARN exacto. `false` crea únicamente la plataforma inicial, sin asociar ACL ni publicar servicios/frontend; después requiere repetir el bootstrap y el workflow.

El job no usa una variable de environment en su `if` previo al arranque. GitHub sólo ofrece esas variables después de declarar/cargar el environment; las entradas del paso de credenciales y del paso de deploy las consumen allí.

## Alcance de permisos

Los stacks permitidos son exactamente platform, assets, inspections y frontend del ambiente. Los objetos del bucket privado de releases se restringen a su prefijo de ambiente. Los recursos con nombres propios usan el prefijo `sedepulso-<ambiente>-`. Route 53 sólo permite A/AAAA del host del ambiente y CNAME de validación ACM bajo ese host, dentro de la zona de `lynxpardelle.com`.

Algunos servicios asignan identificadores aleatorios o exigen `Resource: *` para crear o listar. El rol de servicio enumera las operaciones necesarias, restringe región y cuenta cuando el servicio lo admite y limita la solicitud del certificado al hostname correspondiente. Las escrituras de distribuciones CloudFront y certificados ACM exigen tags Product/Environment del ambiente. El tagging inicial exige los tags solicitados y no puede sobrescribir los de otro producto o ambiente. Las lecturas se separan de las escrituras. OAC y cache/response policies no soportan esos tags y mantienen un alcance de ARN de cuenta con operaciones enumeradas, sujeto al control de stacks y rol de servicio. Las políticas del rol de CloudFormation se dividen en managed policies del bootstrap para respetar cuotas de IAM. No se da un wildcard de acciones. Las rutas HTTP de API Gateway y las políticas CDN se gestionan desde los stacks autorizados.

La verificación puede crear y eliminar identidades Cognito y datos efímeros en el ambiente. Los scripts usan nombres de prueba, suprimen invitaciones y limpian al terminar; no deben migrar información de clientes entre ambientes.

HTTP API V2 presenta una discrepancia entre el catálogo IAM y el proveedor real: `AWS::ApiGatewayV2::Stage` declara `apigateway:TagResource` para crear el stage y la primera creación de testing lo exigió literalmente, aun con los verbos GET/POST/PUT/PATCH/DELETE ya permitidos. Una API temporal sin rutas y una sesión STS limitada a su ARN confirmaron que añadir únicamente ese permiso permite CreateStage con tags; la API se eliminó al terminar. Cada rol CFN recibe una managed policy separada con sólo esa acción sobre `/apis/*/stages` y sus hijos, en us-east-1. Como el catálogo público y cfn-lint la consideran inválida, se omite W3037 exclusivamente en esos tres recursos IAM, sin ignorar lint global ni añadir `apigateway:*`. No se añade UntagResource sin un caso que lo requiera.

Crear un stage con `AccessLogSettings` requiere además las acciones dependientes Create/Get/Update/Delete/ListLogDelivery, PutResourcePolicy y DescribeResourcePolicies de CloudWatch Logs. El catálogo AWS no admite ARN de recurso ni tags para esas operaciones V1: se enumeran con Resource `*` y condición `aws:RequestedRegion=us-east-1`. DescribeLogGroups ya se permite en esa región. Crear/borrar grupos continúa restringido al prefijo del ambiente; no se concede lectura global de eventos ni FilterLogEvents. Los roles runtime tampoco reciben configuración de delivery o resource policies.

La segunda creación de testing demostró esa dependencia con AccessDenied en CreateLogDelivery. Una prueba STS con API HTTP, grupo y policy propios temporales confirmó creación completa de stage con destino de logging. Se retiraron API/stage, grupo y policy propios, y el hash de la policy compartida AWSLogDeliveryWrite20150319 permaneció idéntico antes/después. En producción los permisos sólo son usados por CloudFormation al gestionar los stacks autorizados; no se modifica manualmente ninguna policy compartida. `update-stage --access-log-settings '{}'` es un no-op, no un procedimiento para desactivar logging.

Los dos primeros intentos de testing quedaron en ROLLBACK_COMPLETE antes de crear el pool. Las dos tablas AccessTable nuevas se conservaron temporalmente por Retain mientras se retiraba únicamente la metadata de los stacks fallidos. Después de verificar el ambiente completo se eliminaron esas dos tablas huérfanas: se comprobaron ARN, TableId, fecha de creación, tags exactos y diferencia frente a la tabla activa; Scan consistente con Count=0 y sin LastEvaluatedKey en ambas. La eliminación se confirmó con ResourceNotFound a las 22:42:37/38Z del 19 de noviembre de 2026. La tabla activa, otras tablas y backups se conservaron.

## Registro de Cognito

Un único WebACL regional, `sedepulso-signup-routing`, se comparte entre los tres pools. Tiene tres reglas: método GET, path exacto `/signup` y header Host exacto del dominio Cognito del ambiente. La acción es HTTP302 con `Location` a `/registro` del host del producto correspondiente. El default es Allow: no intercepta `/`, `/login`, `/oauth2/token`, recuperación de contraseña ni los POST.

Las reglas no inspeccionan PII ni registran muestras de solicitudes. Es una regla de enrutamiento del registro, no una suite general de prevención de abuso. AWS WAF tiene cargos propios; compartir el ACL evita crear uno por ambiente.

La asociación de cada pool vive en su stack de plataforma con parámetro `SignupWebAclArn`. El rol CFN tiene permisos de asociación sobre ese ACL y los tres permisos dependientes de Cognito sobre el ARN exacto del pool propio. El bootstrap descubre el recurso `UserPool` del stack de cada ambiente y comprueba ARN, cuenta, región y tags Product/Environment antes de emitir esos permisos. No concede esos permisos cuando aún no existe el pool.

La integración WAF → Cognito no entrega el contexto ResourceTag en esa autorización dependiente: el primer despliegue real de development y una prueba STS acotada confirmaron AccessDenied aun con tags correctos. Por eso no se usa `userpool/*` con tags para esas tres acciones. WAF exige recurso global para desasociar/consultar algunas asociaciones; el permiso dependiente exacto de Cognito conserva el límite del pool propio.

La primera creación de un ambiente requiere dos fases: crear la plataforma con `SignupWebAclArn` vacío, volver a ejecutar el bootstrap administrador para descubrir y autorizar el ARN recién creado, y desplegar de nuevo con el ACL configurado. No publicar el frontend antes de terminar la asociación y las verificaciones. Al sustituir un pool en el futuro, repetir ese bootstrap; nunca ampliar el alcance a todos los pools para evitarlo.

El 19 de noviembre de 2026 el primer deploy OIDC de development confirmó la federación, pero la asociación falló por ese contexto de tags ausente. El rollback intentó quitar las nuevas permissions boundaries y revertir atributos Cognito aditivos, ambas operaciones impedidas. Se completó conservando las boundaries y omitiendo únicamente `HealthFunctionRole`, `AccessFunctionRole`, `ConfigFunctionRole` y `UserPool`. El siguiente deploy, run 44615962505, realineó esos recursos, recreó los triggers y completó los tres smokes. Los runs posteriores confirmaron el estado sano: ese incidente quedó resuelto sin recrear el pool o las tablas ni habilitar la eliminación de boundaries.

## Cambios sólo de documentación

El job `scope` compara el before/base del evento con HEAD, con historial completo. Sólo omite pruebas y deploy cuando todos los archivos modificados están en docs/, plan/ o son Markdown. Un archivo de aplicación, infraestructura o workflow ejecuta la verificación. Eventos manuales, tipos no conocidos, base ausente, rama nueva, error de git o diff vacío ejecutan verificación por defecto.

No se usa paths-ignore en el workflow completo: el job de alcance termina y los checks omitidos tienen estado explícito. Los controles de origen de promoción no cambian.

## Preparar y comprobar

Desde una sesión AWS administradora autorizada para el bootstrap:

```sh
node --test infra/ci/*.test.mjs
node infra/tools/configure-ci.mjs --template-only
cfn-lint --template infra/.artifacts/ci-template.json
node infra/tools/configure-ci.mjs
```

`infra/ci/template.mjs` produce el template; `infra/.artifacts/ci-template.json` es generado e ignorado. El script reutiliza el proveedor, despliega roles y publica las variables de los environments. El manifiesto local `infra/.artifacts/ci-oidc.json` contiene ARN y nombres, sin credenciales.

Antes de subir el template CI, que supera el límite inline de CloudFormation, el bootstrap comprueba el bucket dedicado `sedepulso-artifacts-<cuenta>-us-east-1`. Sólo un 404/NoSuchBucket permite crearlo, bloquear sus cuatro opciones de acceso público y habilitar versionado. Si ya existe, verifica propietario, región, privacidad y versionado sin cambiar su configuración; un 403 u otro fallo se propaga y no intenta crear otro bucket. `--template-only` sale antes de esta preparación y no crea recursos AWS.

En un push a una rama de entrega, el workflow verifica pruebas/build/lint, asume OIDC, empaqueta y despliega. Después ejecuta smoke de dominio, alta/organización aislada y comprobación web/orígenes privados; conserva sólo los reportes JSON seleccionados como artefactos GitHub.

Crear los roles no prueba la federación completa. La evidencia de asunción OIDC y de publicación se obtiene del run real de GitHub para cada rama. Revisar fallos de permisos concretos antes de ampliar una política; conservar los límites de ambiente y runtime.

## Validación real del 19 de noviembre de 2026

La promoción development → testing → main terminó con los cuatro stacks de cada ambiente completos, federación OIDC real y los tres smokes verdes: dominio, alta/organización aislada y web/orígenes privados. Los reruns de testing y production continuaron el mismo push y SHA después del bootstrap exacto; no utilizaron workflow_dispatch ni otro commit.

| Ambiente | Rama / commit de runtime | Run verificado | Intento | Artefacto final |
| --- | --- | --- | --- | --- |
| development | development / `31cc92795e80eec3d5ee3dbbfdd4a64f47a51837` | [44627058265](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44627058265) — SUCCESS | 1 | `14578734056` |
| testing | testing / `5d50187ce8a70edfbed5ecc87986cdea5a613e88` | [44628242897](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44628242897) — SUCCESS | 2 | `14581750821` |
| production | main / `328f7f1b5ada366ad986b25bee1a8571c4448123` | [44631382530](https://github.com/LynxPardelle/mantenimiento-por-sede/actions/runs/44631382530) — SUCCESS | 2 | `14583212671` |

Cada artefacto final contiene manifest.json y los reportes smoke, signup y web del ambiente. En un rerun se seleccionó el artifact ID más reciente por created_at; no se eliminó la evidencia del primer intento. Los IDs y SHA anteriores identifican la aplicación verificada, aunque después se promueva documentación sin volver a desplegar runtime.

El stack `sedepulso-ci-oidc` quedó actualizado y `COGNITO_WAF_POOL_READY=true` en los tres environments. Los tres permisos dependientes de Cognito para WAF se restringen actualmente a estos ARN, verificados contra su stack y tags:

| Ambiente | UserPool autorizado |
| --- | --- |
| development | `arn:aws:cognito-idp:us-east-1:765932874577:userpool/us-east-1_Tq2A8S7Eh` |
| testing | `arn:aws:cognito-idp:us-east-1:765932874577:userpool/us-east-1_VPWb3vlTZ` |
| production | `arn:aws:cognito-idp:us-east-1:765932874577:userpool/us-east-1_aB0goxGzq` |

Una lectura administrativa limitada al grupo ApiAccessLogs de cada stack confirmó entrega real del GET /api/health con status 200 generado por sus smokes. Sólo se registraron boolean y timestamp, sin copiar eventos ni conceder lectura global de logs a los roles CI/CFN.

| Ambiente | Health 200 entregado (UTC) | ApiId de la alarma verificada |
| --- | --- | --- |
| development | 22:21:22.173Z | `v2y5bhxj51` |
| testing | 22:39:31.169Z | `drvnkpw6pb` |
| production | 23:00:04.523Z | `f19ijtny5a` |

Las tres alarmas ApiServerErrors se comprobaron con DescribeStackResource y DescribeAlarms: AWS/ApiGateway, métrica 5xx, dimensión ApiId exacta, Sum/300s, threshold 1 con GreaterThanOrEqualToThreshold y TreatMissingData=notBreaching. AlarmActions está vacío: existe el detector, el canal de notificación sigue pendiente. No se inyectaron fallos ni se alteró artificialmente el estado de las alarmas.

## Fuentes primarias

- [AWS IAM: confianza OIDC y GitHub](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html).
- [GitHub: variables de environment y contextos](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts).
- [AWS Cognito: respuestas y asociación WAF](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-waf.html).
- [AWS: autorización de API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/security_iam_service-with-iam.html).
- [CloudFormation cfn-lint: discrepancia del catálogo para tagging de API Gateway](https://github.com/aws-cloudformation/cfn-lint/issues/4280).
- [AWS HTTP API: permisos dependientes para activar logging](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html).
- [AWS CloudWatch Logs: acciones permission-only y alcance de recursos](https://docs.aws.amazon.com/service-authorization/latest/reference/list_logs.html).
