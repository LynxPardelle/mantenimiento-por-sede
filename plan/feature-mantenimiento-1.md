---
goal: 'Registrar y completar una inspección en una sede'
date_created: 2026-11-17
status: 'Planned'
tags: ['feature', 'angular', 'aws-sam']
---

# Plan de la primera funcionalidad

La base local ya sirve la página inicial y la comprobación de salud. Este plan cubre el primer flujo de negocio y su validación antes del piloto.

## 1. Requisitos y restricciones

- **REQ-001** Una persona coordinadora puede dar de alta un equipo y programar una inspección en una sede asignada.
- **REQ-002** Una persona técnica puede consultar pendientes de sus sedes, cerrar una inspección y comprobar el resultado persistido.
- **REQ-003** El historial muestra fecha, resultado, nota y autor de cada cierre. El servidor genera la fecha UTC y selecciona la identidad del token verificado.
- **SEC-001** Validar pertenencia y rol en cada llamada de dominio. Rechazar accesos a sedes de otra organización.
- **CON-001** La fecha de vencimiento es local a la sede. Conservar separado el instante UTC de registro.
- **CON-002** Conservar estable una operación repetida. Altas y programación admiten un encabezado `Idempotency-Key` por actor, ruta y sede. Un reintento con contenido diferente devuelve `409`.

## 2. Pasos de implementación

### Fase 1. Datos y API

| Tarea    | Entrega                                                                                                                                                                                               | Aceptación                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TASK-001 | En `infra/template.yaml` agregar un autorizador JWT por emisor y audiencia para rutas de dominio. Mantener salud pública. Crear módulo de autorización en `infra/functions/domain/authorization.mjs`. | Token ausente o inválido devuelve `401`. Sede ajena devuelve `404`. Rol insuficiente en sede propia devuelve `403`.                                                   |
| TASK-002 | En `infra/functions/domain/assets.mjs` implementar alta y consulta paginada de activos con el patrón de claves documentado. Usar una escritura transaccional para persistir alta e idempotencia.      | Dos altas idénticas con la misma clave registran un equipo. La página siguiente queda acotada a la misma sede.                                                        |
| TASK-003 | En `infra/functions/domain/inspections.mjs` implementar programación, lista de pendientes, historial y cierre condicional.                                                                            | Dos cierres iguales devuelven el mismo resultado. Cierres distintos en paralelo producen un cierre y un `409`. El cierre elimina la entrada del índice de pendientes. |

### Fase 2. Interfaz y prueba de piloto

| Tarea    | Entrega                                                                                                                                                                                     | Aceptación                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| TASK-004 | Agregar una sección diferida en `frontend/src/app/maintenance/` con selección de sede, registro de equipo y agenda de pendientes. Implementar cliente HTTP y SignalStore por funcionalidad. | El coordinador completa el alta y programa una inspección. Un error de red deja el formulario listo para reintentar.    |
| TASK-005 | Agregar formulario de resultado e historial en la misma sección. Usar etiquetas asociadas, navegación por teclado y señal de éxito accesible.                                               | El técnico cierra una inspección desde ancho móvil y verifica el historial tras recargar.                               |
| TASK-006 | Ejecutar un recorrido de prueba con dos sedes y dos organizaciones. Después probar con una operación que acepte un piloto y registrar métricas de cumplimiento y tiempo de consulta.        | Pruebas de aislamiento, reintentos y navegación completadas. Métricas publicadas con número de inspecciones observadas. |

## 3. Alternativas

- **ALT-001** Generar inspecciones periódicas automáticamente. Evaluar la periodicidad cuando el piloto confirme la frecuencia y la carga administrativa.
- **ALT-002** Aceptar evidencia fotográfica. Incorporarla después de validar cómo se usa la evidencia textual y quién necesita retener imágenes.

## 4. Dependencias

- **DEP-001** Angular y NgRx resueltos desde el lock local de `frontend/`.
- **DEP-002** Contratos de datos y claves de DynamoDB en la arquitectura.
- **DEP-003** Un emisor OIDC y dos identidades de prueba por organización para verificar el entorno de integración.

## 5. Archivos

- **FILE-001** `infra/template.yaml` y `infra/functions/domain/` para configuración AWS y contratos HTTP.
- **FILE-002** `frontend/src/app/maintenance/` para interfaz, estado y cliente HTTP.

## 6. Pruebas

- **TEST-001** Pruebas de API con un token inválido, un rol insuficiente y una sede ajena.
- **TEST-002** Pruebas de integración de idempotencia, actualización condicional y paginación por sede.
- **TEST-003** Prueba de interfaz para alta, programación, cierre y lectura del historial.
- **TEST-004** Repetir build, pruebas del frontend, pruebas Node, lint SAM y un recorrido contra un entorno de prueba autorizado.

## 7. Riesgos y supuestos

- **RISK-001** La lista de pendientes es eventualmente consistente. Confirmar el cierre desde el registro de la tabla y actualizar la lista después de cerrar.
- **ASSUMPTION-001** La operación piloto registra notas en línea y puede generar inspecciones de forma manual.

## 8. Lectura relacionada

- [Producto](../PRODUCTO.md)
- [Arquitectura y patrones de acceso](../docs/architecture/ARCHITECTURE.md)
