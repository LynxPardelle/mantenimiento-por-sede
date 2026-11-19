# ADR 0001. API HTTP por solicitud y datos organizados por sede

- Estado: aceptada para la base local
- Fecha: 2026-11-17
- Evolución: la [ADR 0002](0002-microservicios-y-angular-ssr.md), del 2026-11-19, separa datos y stacks por servicio e incorpora Angular SSR en Lambda. Esta ADR conserva el contexto histórico; la arquitectura vigente es la de SedePulso.

## Contexto

La primera versión registra inspecciones intermitentes y consultas paginadas. Las escrituras deben mantener un registro por equipo y distinguir organizaciones. El piloto necesita métricas de uso antes de dimensionar notificaciones o servicios de ejecución continua.

## Decisión

Usar API Gateway HTTP API y AWS Lambda Node.js 24 para las solicitudes. Usar DynamoDB bajo demanda con claves por organización, sede y equipo, más un índice disperso para inspecciones pendientes. Se entregan infraestructura declarativa con SAM y una ruta de salud sin permisos sobre DynamoDB.

## Alternativas consideradas

- Una API en un contenedor persistente proporciona más control del entorno y conexiones disponibles en todo momento. Introduce capacidad y operación permanente para un uso inicial intermitente.
- Una base relacional facilita reportes con joins y filtros libres. Los accesos iniciales están definidos por sede y equipo. Si el piloto necesita consultas cruzadas frecuentes, reevaluar el modelo antes de extenderlo.
- Un proceso programado podría enviar recordatorios sin que el usuario abra la aplicación. El piloto inicia con una consulta de pendientes y registra si esa vista resulta suficiente.

## Consecuencias

La capacidad sigue la carga observada y el índice hace eficiente la consulta de pendientes por sede. El modelo requiere anticipar patrones de lectura. El servidor debe validar membresía incluso cuando un identificador de sede tenga una forma válida. La interfaz puede ver una actualización tardía en el índice inmediatamente después de completar una inspección.
