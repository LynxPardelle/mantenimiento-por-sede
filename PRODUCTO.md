# Mantenimiento por Sede

## Usuario y problema

El responsable de mantenimiento de una operación con varias sedes necesita saber qué equipos toca revisar, quién hizo la inspección y dónde encontrar la evidencia. La primera hipótesis es atender operaciones con refrigeración comercial. El responsable coordina desde una vista por sede y los técnicos registran resultados en el lugar de trabajo.

## Primera versión

1. La persona responsable da de alta equipos dentro de una sede.
2. Programa una inspección con fecha de vencimiento para un equipo.
3. El técnico consulta las inspecciones pendientes de su sede y registra el resultado con una nota.
4. La persona responsable revisa cuándo se completó, quién la registró y el historial del equipo.

El piloto se limita a inventario de equipos, inspecciones manuales y evidencia textual. Las notificaciones, imágenes, mantenimiento correctivo, sensores, facturación y sincronización sin conexión quedan para decisiones posteriores.

## Hipótesis comercial

Cobrar una cuota inicial por cargar el inventario y una mensualidad por sede activa. Probar la propuesta con una operación real durante cuatro semanas. Medir el porcentaje de inspecciones completadas a tiempo, el tiempo para reunir el historial de un equipo y la disposición del responsable a renovar con un precio explícito. Las métricas y el precio requieren validación con el comprador.

## Punto de partida

El prototipo [examen-python](https://github.com/LynxPardelle/examen-python/tree/cc308b5e01271c555d8692fb58250f11c4032266) modela dispositivos, tipos, estados, lecturas y mantenimientos. Se usaron las entidades de dispositivo y mantenimiento como referencia de dominio. Esta implementación es nueva. El original conserva su [licencia MIT](https://github.com/LynxPardelle/examen-python/blob/cc308b5e01271c555d8692fb58250f11c4032266/LICENSE).
