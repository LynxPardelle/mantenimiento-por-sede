# ADR 0002. Microservicios por dominio y Angular SSR en Lambda

- Estado: aceptada para la implementación de SedePulso.
- Fecha: 2026-11-19.
- Actualiza la [ADR 0001](0001-api-http-y-datos-por-sede.md).

## Contexto

La base inicial tenía salud y una tabla prevista para el dominio. Se requiere arquitectura de microservicios en la nube, Angular servido por Lambdas y subdominios de `lynxpardelle.com`. Dividir un handler en archivos no proporciona propiedad de datos ni entrega independiente.

## Alternativas

1. Una Lambda y tabla de dominio simplifican el primer deploy, pero acoplan autorización, inventario e inspecciones.
2. Varias Lambdas con tabla compartida separan ejecución, pero mantienen dependencia de estructuras y permisos ajenos; un stack común también acopla entregas.
3. Lambdas, tablas, roles y stacks propios separan datos y despliegues, a cambio de contratos y fallos entre servicios.

Se elige la tercera opción, sin añadir mensajería antes de tener un flujo que necesite procesamiento desacoplado.

## Decisión

La plataforma contiene HTTP API, Cognito, autorizador JWT, Access y membresías, además de salud y configuración. Assets e Inspections reciben referencias de API, autorizador y servicios por parámetros, y administran sus propias funciones, roles, tablas, rutas e integraciones.

Access es el único propietario de las pertenencias. Assets e Inspections lo invocan por IAM para resolver organización, sede y rol del `sub` autenticado. Inspections valida el equipo mediante Assets. Ningún servicio accede directamente a la tabla de otro. La organización no procede del cliente ni depende de un atributo personalizado que no viene en los access tokens de Cognito.

Angular 22 usa SSR en Lambda Node.js 24 ARM64. CloudFront obtiene HTML desde Function URL con `AWS_IAM` y OAC, y estáticos desde S3 privado con OAC. SSR no accede a DynamoDB. `/api/*` usa HTTP API sin caché operativa.

Cognito usa authorization code con PKCE, cliente público sin secreto y sin alta libre. HTTP API verifica JWT; backend exige access token y contexto Access. Los scopes OIDC pertenecen al inicio de sesión; las rutas de dominio no exigen `openid` como autorización de negocio.

La marca es SedePulso y producción usa `sedepulso.lynxpardelle.com`; development y testing usan subdominios propios y stacks/datos aislados. Carpeta y origin históricos se conservan.

## Consecuencias y comprobación

Los cambios internos se entregan por stack sin redesplegar los demás cuando conservan contrato. Access añade una dependencia síncrona de autorización; un fallo no concede acceso. Inspections depende del contrato Assets al programar.

No hay transacciones entre servicios. Idempotencia y cierre condicional pertenecen a la tabla propia; el índice de pendientes es eventualmente consistente.

Se debe verificar SSR, hidratación, OAC, acceso anónimo denegado a orígenes, HTTPS, callbacks Cognito, IAM y recorrido persistido de dos organizaciones. El modo local y la salud no sustituyen esa evidencia. Los resultados se registran en el plan.
