# SedePulso

**El mantenimiento de cada sede, al día.**

SedePulso es un producto de ZooBeriah Systems para saber qué equipos toca revisar, quién hizo cada inspección y dónde consultar su historial. Su descriptor comercial es **mantenimiento preventivo para operaciones con varias sedes**.

## Usuario y problema

La persona responsable de mantenimiento coordina equipos e inspecciones por sede. El personal técnico registra resultados desde el lugar de trabajo. La hipótesis es que un inventario e historial común reduzcan el tiempo para reunir evidencia y ayuden a completar las revisiones a tiempo.

La primera hipótesis de comprador es una operación con refrigeración comercial. Esa elección delimita el piloto; no afirma demanda validada ni limita la marca a un tipo de equipo.

## Primera versión

1. Una persona coordinadora inicia sesión y elige una de sus sedes asignadas.
2. Registra un equipo y programa una inspección con fecha de vencimiento local.
3. Una persona técnica consulta pendientes, registra resultado y nota y confirma que el cierre quedó guardado.
4. La persona coordinadora revisa el historial con fecha, resultado, nota y autor.

El servidor valida organización, sede y rol en cada operación. Conserva la identidad autenticada y la hora UTC del cierre; el navegador no elige autor ni organización. Los reintentos de altas y programación usan idempotencia durante siete días, y un cierre repetido con el mismo contenido conserva el resultado original.

El piloto se limita a inventario, inspecciones manuales y evidencia textual. Notificaciones, fotografías, mantenimiento correctivo, sensores, facturación y sincronización sin conexión quedan para decisiones posteriores. Los pendientes pueden reflejar un cierre con una demora breve; la confirmación y el historial leen el registro persistido.

## Hipótesis comercial

La propuesta por validar es cobrar una cuota inicial por cargar el inventario y una mensualidad por sede activa. No hay precio aceptado ni disposición de pago demostrada.

El piloto requiere una operación real que acepte participar durante cuatro semanas. Medirá porcentaje de inspecciones completadas a tiempo, tiempo para reunir el historial y disposición del responsable a renovar con un precio explícito. Cada resultado debe incluir número de sedes, equipos e inspecciones y periodo observado. Los datos de demostración y las pruebas automáticas no cuentan como evidencia comercial.

## Entrega e identidad

La aplicación usa Angular servido por Lambda y microservicios AWS separados para acceso, inventario e inspecciones. El dominio de producto es `sedepulso.lynxpardelle.com`; development y testing usan dominios propios. Su publicación y disponibilidad se comprueban por ambiente.

La [decisión de nombre](docs/branding.md) registra alternativas y alcance de la búsqueda pública. La carpeta y el origin conservan su nombre histórico por continuidad con el proyecto remoto.

## Punto de partida

El prototipo [examen-python](https://github.com/LynxPardelle/examen-python/tree/cc308b5e01271c555d8692fb58250f11c4032266) modela dispositivos, tipos, estados, lecturas y mantenimientos. Las entidades de dispositivo y mantenimiento sirvieron como referencia de dominio. Esta implementación es nueva; el original conserva su [licencia MIT](https://github.com/LynxPardelle/examen-python/blob/cc308b5e01271c555d8692fb58250f11c4032266/LICENSE).

## Registro y planes de esta etapa

El registro público confirma el correo con Cognito y crea una organización y sede inicial propias. El acceso Piloto es individual y gratuito en esta etapa, sin tarjeta ni cobros automáticos. Operación y Red son propuestas en diseño, no productos contratables. Sus precios y capacidades se validarán con el piloto; Stripe se incorporará después de definir qué se vende y sus condiciones.

La [propuesta de planes](docs/producto/planes-y-suscripciones.md) separa capacidades actuales de futuras y define las preguntas para poner precio por sede activa. Las invitaciones, la autogestión de más sedes, la recurrencia automática y los informes nuevos requieren implementación antes de ofrecerse como prestaciones disponibles.
