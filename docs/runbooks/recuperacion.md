# Comprobación de recuperación de SedePulso

La prueba usa exclusivamente la tabla Access del stack `sedepulso-development-platform` en `us-east-1`. Comprueba que un backup bajo demanda puede restaurarse en una tabla temporal y recuperar un marcador conocido mediante lectura por clave.

## Ejecutar

Requiere Node.js 24, AWS CLI y una sesión autorizada en la cuenta del proyecto.

```sh
node infra/tools/recovery-check.mjs --environment development
```

El script rechaza testing y producción. Obtiene el origen desde los outputs de CloudFormation; no admite una tabla de origen o destino arbitraria por línea de comandos. Un nonce aleatorio de doce caracteres hexadecimales identifica todos los recursos de la ejecución.

## Recorrido y controles

1. Comprobar identidad AWS, ARN y estado activo de la tabla Access de development. Confirmar que el destino temporal no existe.
2. Escribir únicamente `pk=RECOVERY#<nonce>`, `sk=CHECK`, con condición de inexistencia y un valor de prueba aleatorio.
3. Crear un backup `USER` con nombre `sedepulso-development-recovery-<nonce>` y esperar `AVAILABLE`.
4. Restaurar ese backup con capacidad bajo demanda en una tabla cuyo nombre coincide exactamente con `sedepulso-development-recovery-<nonce>`. Esperar `ACTIVE`.
5. Vincular la respuesta exitosa de `RestoreTableFromBackup` al ARN del backup solicitado y al nombre, ARN y `TableId` inmutable del destino. Si `DescribeTable` incluye `RestoreSummary`, sus campos presentes deben coincidir con el origen y backup propios; si lo omite, se exige la prueba capturada y el mismo `TableId`.
6. Leer exclusivamente el marcador propio en la tabla restaurada, por clave y con consistencia fuerte, y comprobar su valor. No se realizan scans ni lecturas de registros de usuarios.
7. En `finally`, eliminar la tabla temporal, el backup propio y el marcador del origen. Volver a comprobar su ausencia.

Antes de las eliminaciones se vuelve a comprobar la cuenta AWS. El backup debe conservar nombre, ARN, tipo `USER` y origen exactos. La tabla temporal debe corresponder a la restauración exitosa de ese backup y conservar su `TableId`. El marcador se elimina únicamente si su valor coincide con el que generó la ejecución, mediante condición DynamoDB. Un recurso inesperado provoca un fallo y permanece sin modificar.

`SourceTableArn` y `SourceBackupArn` son campos opcionales de `RestoreSummary`. En la comprobación real, `DescribeTable` omitió el resumen completo después de alcanzar `ACTIVE`. La herramienta conserva el vínculo directo de la llamada de restauración exitosa con el `TableId`, de modo que la ausencia de ese resumen no elimina la verificación del origen y tampoco permite borrar una tabla reemplazada bajo el mismo nombre. Cualquier campo de linaje presente que contradiga la ejecución sigue provocando rechazo.

La tabla fuente, sus datos operativos, PITR, TTL, IAM y demás configuración se conservan. La restauración produce una copia temporal completa dentro de la misma cuenta y región; la comprobación lee sólo el marcador de prueba.

## Evidencia

`infra/.artifacts/recovery-development.json` registra ambiente, cuenta, tabla fuente, tabla temporal, backup, prueba de restauración vinculada al `TableId`, digest del marcador, etapas, resultado, duración y estado de limpieza. No contiene contraseñas, tokens, el valor del marcador ni datos de cliente. Se escribe durante el recorrido, para conservar los identificadores de la ejecución si se interrumpe el proceso.

La comprobación de guardas se ejecuta con:

```sh
node --test infra/test/recovery.test.mjs
```

Incluye rechazo de producción, del origen como destino, de prefijos parecidos, de ARN de otra cuenta y de una tabla que no procede del backup propio. También comprueba limpieza después de una validación de marcador fallida y el tratamiento de metadata de restauración opcional sin aceptar cambios de `TableId`.

## Esperas, limpieza y cargos

El script informa avance cada quince segundos durante las esperas. Permite hasta cuarenta y cinco minutos para disponibilidad del backup y restauración. La eliminación de tabla y backup tiene esperas de hasta diez minutos.

La ejecución genera un backup bajo demanda, una restauración y capacidad/almacenamiento temporales en AWS. El reporte cuenta esas operaciones; el importe exacto corresponde a la facturación AWS y no se estima a partir de esta prueba. Los recursos temporales se eliminan al terminar correctamente.

Ante una interrupción externa, revisar el JSON antes de actuar. Confirmar cuenta, origen, nonce, nombre temporal, ARN del backup, `TableId` y prueba de restauración con las mismas reglas del script. Si falta esa prueba, comprobar además el evento exitoso exacto de `RestoreTableFromBackup` en CloudTrail y la fecha de creación del destino antes de completar manualmente la limpieza; no inferir propiedad sólo por el prefijo del nombre. No borrar la tabla Access, no desactivar PITR y no eliminar backups de otras ejecuciones para resolver un fallo.

## Alcance de recuperación acreditado

Un resultado satisfactorio acredita la recuperación del marcador en una copia de una tabla Access de development. Inventario, inspecciones, Cognito, S3, configuraciones del servicio y recuperación coordinada de varios dominios requieren ejercicios propios. También quedan por establecer RTO/RPO comerciales, restauración entre regiones y procedimiento de conmutación de la aplicación.

Al restaurar para una recuperación operativa, se deben preparar explícitamente las configuraciones asociadas a la tabla, como TTL, streams, alarmas, IAM y políticas de escalado. La prueba no cambia esas configuraciones de la fuente ni conecta la tabla temporal a la aplicación.

Referencias: [restaurar desde backup con AWS CLI](https://docs.aws.amazon.com/cli/latest/reference/dynamodb/restore-table-from-backup.html), [campos opcionales de RestoreSummary](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_RestoreSummary.html), [backup bajo demanda](https://docs.aws.amazon.com/cli/latest/reference/dynamodb/create-backup.html) y [backup y restauración en DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GettingStartedBackupsAWS.html).
