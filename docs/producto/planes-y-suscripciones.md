# Planes y suscripciones de SedePulso

Estado: propuesta de producto al 2026-11-19. Piloto es el único acceso implementado para esta etapa. Stripe, cobros, cambio de plan y renovación automática no están activos. La publicación, el envío de correo y la confirmación del registro se verifican por ambiente en el [plan de ejecución](../../plan/feature-mantenimiento-1.md); este documento no acredita por sí mismo disponibilidad operativa.

## Propuesta inicial

SedePulso vende claridad sobre qué equipo revisar, en qué sede y quién dejó el último resultado. La hipótesis de cobro es una mensualidad por sede activa, con carga inicial de inventario como servicio opcional. Debe validarse con una operación real; publicar una landing no acredita demanda.

| Plan | Persona y trabajo principal | Capacidades implementadas | Alcance que se propone desarrollar | Modelo comercial a validar |
| --- | --- | --- | --- | --- |
| Piloto | Responsable que empieza con una sede y quiere probar el recorrido completo. | Registro con correo confirmado, organización y sede inicial propias, cuenta individual coordinadora, inventario, programación manual, pendientes, resultado con nota e historial. | Medición de uso y acompañamiento de una operación participante. | Gratuito en esta etapa, sin tarjeta ni conversión automática a cobro. |
| Operación | Coordinador y técnicos que necesitan trabajar juntos en una sede. | El motor de permisos coordinador/técnico y la evidencia ya existen; la administración se hace mediante herramientas técnicas. | Invitaciones y roles administrables desde la aplicación, exportación y automatización de inspecciones recurrentes, con pruebas y límites definidos antes de venderlos. | Mensualidad por sede; evaluar capacidad incluida y evitar que el cobro incentive compartir cuentas. Precio pendiente. |
| Red | Responsable de varias sedes que necesita comparar y coordinar la operación. | Aislamiento por organización y selección de sedes asignadas en el motor actual. | Administración de múltiples sedes, visión consolidada, informes y configuración acompañada. Integraciones se cotizarían sólo al existir un alcance viable. | Paquete por número de sedes activas y servicios de puesta en marcha separados. Precio pendiente. |

La comparación pública distingue lo disponible de lo que está en diseño. Las capacidades existentes del motor de permisos y sedes no convierten Operación o Red en planes contratables. Ambos siguen sin checkout, prestaciones comerciales habilitadas ni promesas de fecha. No se ofrecen recordatorios automáticos, sensores, imágenes, trabajo sin conexión, SLA o soporte permanente como prestaciones actuales.

## Límites y datos del plan

El registro público crea una única sede inicial y una cuenta coordinadora. No existe todavía una pantalla de invitación de usuarios ni creación adicional de sedes. La infraestructura soporta asignaciones administrativas, pero eso no equivale a autogestión comercial.

No se publican cupos ficticios de activos, inspecciones o usuarios. Antes de fijar un límite deben existir contadores, validación del servidor y una política de qué ocurre al alcanzarlo. La interfaz nunca será la autoridad de permisos o capacidad.

La organización creada por el servidor contiene `plan=pilot` y `status=active`. El registro no acepta un plan, rol o identificador interno proporcionado por el navegador. No hay fecha de expiración ni borrado automático asociados a la etiqueta Piloto.

## Qué medir antes de poner precios

- Operaciones participantes, sedes, equipos y personas que efectivamente usan el producto.
- Porcentaje de inspecciones completadas a tiempo, con periodo y denominador explícitos.
- Tiempo para encontrar el historial de un equipo y preparar una revisión.
- Trabajo necesario para cargar inventario, asignar personas y ayudar a una sede.
- Coste observado de infraestructura por sede y volumen; no confundir tarifas AWS con coste completo del servicio.
- Disposición a renovar ante una oferta con precio y condiciones explícitos.

La decisión de precio debe documentar a quién se entrevistó, qué oferta vio y qué aceptó. No se usarán visitas a la landing o cuentas de prueba como aceptación comercial.

El observador privado de TASK-006 aporta conteos y razones para evaluar el piloto; sus informes administrativos no constituyen todavía una pantalla de analítica para clientes ni una prestación contratada de Operación o Red. El ahorro de tiempo, esfuerzo de soporte, uso por persona y coste atribuible siguen pendientes de medición; no se fijarán cuotas o precios a partir del consumo de lectura del recolector.

## Preparación para pagos posteriores

1. Confirmar alcance, límites y precio de Operación con el piloto.
2. Implementar las prestaciones que se vayan a vender y aplicar permisos/cupos desde el servidor.
3. Añadir un dominio de suscripción separado de la identidad: estado, plan, sedes activas y vigencia. El usuario no podrá editar su derecho de acceso desde el cliente.
4. Diseñar alta, cambio, cancelación y tratamiento de un pago fallido. Conservar acceso razonable a los registros y evitar pérdida de evidencia por un fallo de cobro.
5. Integrar Stripe en entornos de prueba, verificar webhooks idempotentes y asociación correcta con organización y ambiente.
6. Habilitar contratación real únicamente con precio y condiciones visibles y una acción explícita del comprador. El registro gratuito no autoriza cobros posteriores.

## Referencias de mercado

Como referencia de separación de capacidades, MaintainX distingue acceso básico de automatización, analítica y operación multisede en sus planes; Fracttal describe suscripciones y capacidad de usuarios por plan. Son referencias para estructurar preguntas del piloto, no validación del precio o demanda de SedePulso. Consultadas el 2026-11-19: [planes MaintainX](https://www.getmaintainx.com/pricing) y [preguntas frecuentes Fracttal](https://www.fracttal.com/es/preguntas-frecuentes).
