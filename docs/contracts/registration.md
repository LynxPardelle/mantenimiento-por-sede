# Registro y activación de SedePulso

El registro público crea una organización nueva y una primera sede. No agrega personas a organizaciones existentes. Cognito conserva la identidad y verifica la posesión del correo; el servicio de acceso conserva organización, pertenencia y rol. El navegador no selecciona esos permisos ni un plan de pago.

## Formulario y atributos

La interfaz usa las operaciones `SignUp`, `ConfirmSignUp` y, cuando la persona lo solicita, `ResendConfirmationCode` de Cognito. El inicio de sesión posterior conserva authorization code con PKCE. La contraseña sólo se entrega a Cognito y no llega a las funciones de aprovisionamiento.

| Dato | Atributo Cognito | Regla |
| --- | --- | --- |
| Correo | `email` | Correo válido, hasta 320 caracteres. Cognito verifica su posesión. |
| Organización | `custom:organizationName` | Texto de 1 a 120 caracteres, sin controles; se eliminan espacios exteriores al guardar el espacio de trabajo. |
| Primera sede | `custom:siteName` | Texto de 1 a 120 caracteres, sin controles. |
| Zona horaria | `custom:timeZone` | Identificador aceptado por `Intl.DateTimeFormat`, hasta 100 caracteres; se guarda su forma canónica. |

Los tres atributos personalizados son de tipo String e inmutables. El cliente público puede escribir `email` y esos tres atributos, y leerlos junto con `email_verified`. No se define un secreto para el cliente. `ClientMetadata` no es una fuente de permisos ni de datos persistidos para este recorrido.

## Validación previa

`infra/functions/onboarding/index.mjs`, exportación `preSignUp`, atiende `PreSignUp_SignUp`. Valida los atributos y fija `autoConfirmUser`, `autoVerifyEmail` y `autoVerifyPhone` en `false`: el registro no evita la verificación normal de Cognito. Rechaza atributos personalizados adicionales, incluidos intentos de indicar organización, rol o plan mediante claves diferentes de las tres admitidas.

`PreSignUp_AdminCreateUser` conserva el flujo administrativo con IAM, que permite crear identidades de prueba con entrega de correo suprimida. No habilita una ruta de registro público. La federación externa no está configurada y un origen de ese tipo se rechaza.

## Activación tras confirmar

La exportación `postConfirmation` atiende `PostConfirmation_ConfirmSignUp`. Requiere un `sub` válido y `email_verified` exactamente igual a la cadena `true`. `PostConfirmation_ConfirmForgotPassword` no crea ni modifica organizaciones. Los handlers tampoco aceptan eventos HTTP que intenten simular un trigger de Cognito.

El servidor deriva identificadores estables del `sub` con SHA-256 y un espacio de nombres versionado. Los identificadores tienen las formas `org_<32 hex>` y `site_<32 hex>`; dos registros con el mismo nombre comercial no comparten organización.

La activación escribe dos registros de `AccessTable` en una transacción condicional:

| Registro | PK | SK | Contenido principal |
| --- | --- | --- | --- |
| Pertenencia | `USER#<sub>` | `MEMBERSHIP` | `orgId`, primera sede con nombre y zona, rol `coordinator`, fecha UTC y `onboardingVersion`. |
| Organización | `ORG#<orgId>` | `META` | Nombre, `ownerSub`, `initialSiteId`, `plan=pilot`, `status=active`, origen `cognito` y fecha UTC. |

Ambas escrituras usan `attribute_not_exists(pk)`. Si el evento se repite o compite con otra confirmación, se conserva el registro original. Una pertenencia ya asignada administrativamente nunca cambia de organización ni adquiere otro rol por este trigger. Los conflictos transitorios se reintentan de forma acotada con las mismas claves y un retraso corto; no se reintentan errores de validación de DynamoDB.

`plan=pilot` identifica la etapa inicial del producto. No aplica cobros, Stripe ni límites comerciales todavía. Los planes de suscripción se diseñan por separado; no se anuncian cuotas o capacidades pagadas como controles ya aplicados por este dato.

## Infraestructura y permisos

- Paquete de ejecución: `.artifacts/onboarding/`, con los módulos `.mjs` y las dependencias SDK. La validación previa no carga el cliente DynamoDB.
- Handlers: `index.preSignUp` e `index.postConfirmation`.
- Variable de la función de activación: `ACCESS_TABLE_NAME`.
- La activación necesita `dynamodb:GetItem` y `dynamodb:PutItem` únicamente sobre `AccessTable`. Las escrituras transaccionales usan el permiso de las operaciones `PutItem` subyacentes.
- La función previa no requiere permisos de tablas.
- La política de invocación de ambos triggers permite `cognito-idp.amazonaws.com` y limita `SourceArn` al pool de este ambiente y `SourceAccount` a la cuenta. No se agregan Function URLs ni rutas HTTP públicas para estas funciones.
- No referenciar el pool desde una variable de la función si el pool ya referencia su ARN en `LambdaConfig`: evitar un ciclo de CloudFormation. El permiso de invocación limita el origen por pool.

Outputs esperados de plataforma: `PreSignUpFunctionName` y `PostConfirmationFunctionName`. La automatización usa además `UserPoolId`, `ClientId`, `AccessTableName` y los datos públicos existentes de la API.

## Recuperación de una activación incompleta

Una falla de infraestructura después de que Cognito confirme la cuenta puede dejar una identidad confirmada sin pertenencia. El código falla de forma cerrada: el acceso a sedes no se abre y el trigger no registra atributos o errores personales en logs. Después de corregir la infraestructura, una persona operadora con IAM puede repetir la activación desde los atributos persistidos de esa cuenta:

```sh
node --use-system-ca infra/tools/provision-signup-smoke.mjs --environment development --repair --username <usuario-Cognito>
```

El modo reparación consulta `AdminGetUser`, exige cuenta habilitada y `CONFIRMED`, y correo verificado. Invoca la función existente mediante IAM, conserva cualquier membresía previa y no crea cuentas, no cambia contraseñas ni envía correo. No sustituye datos faltantes por información inventada. Las cuentas anteriores que no tengan atributos de registro pueden asignarse mediante el [aprovisionamiento administrativo](../runbooks/despliegue.md).

## Prueba por ambiente

```sh
node --test infra/test/onboarding*.test.mjs
node --use-system-ca infra/tools/provision-signup-smoke.mjs --environment development
node --use-system-ca infra/tools/provision-signup-smoke.mjs --environment testing
node --use-system-ca infra/tools/provision-signup-smoke.mjs --environment production
```

La prueba en nube crea una cuenta administrativa de nombre `smoke-signup-*`, atributos de prueba y correo marcado como verificado administrativamente, con `MessageAction=SUPPRESS`. No envía correo a direcciones ficticias. Invoca el trigger por IAM, comprueba organización, sede, rol, plan piloto, repetición idempotente y acceso a la sede por JWT real a través de CloudFront. Borra cuenta y los dos registros temporales en `finally` y comprueba la eliminación de registros. No borra datos de otras organizaciones.

Los reportes `infra/.artifacts/signup-<ambiente>.json` no contienen contraseñas ni tokens. Registran expresamente `emailDeliveryTested=false`: este smoke no acredita entrega de correo ni el canje de un código que una persona recibió. Esa parte se verifica por separado con un buzón autorizado.

## Referencias primarias

- [AWS: trigger previo al registro](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-sign-up.html).
- [AWS: trigger posterior a la confirmación](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-post-confirmation.html).
- [AWS: permisos de transacciones DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html).
