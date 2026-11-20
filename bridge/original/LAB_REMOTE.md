# OLFX Bridge 1.0.32 — Administración de OLFX Lab

OLFX Lab era un programa separado que el bridge no podía actualizar ni consultar.
Esta versión añade un administrador con tareas fijas y el Lab de rango BUY/SELL
con SL en estructura, TP1 1R y TP2 2R dentro del mismo paquete firmado.

El launcher original acepta el paquete con su clave pública actual. Conserva
el servicio de estrategia y la configuración del bridge; no cambia sus reglas
de trading. La capacidad nueva se aplica al laboratorio de simulación.

## Tareas remotas

| Acción | Resultado |
| --- | --- |
| lab_discover | Busca instalaciones en Desktop, Downloads y Documents, hasta cuatro niveles; publica identificadores opacos. |
| lab_attach | Vincula uno de esos identificadores; no acepta una ruta remota. |
| lab_update | Instala solo el payload firmado y respalda los archivos Python anteriores. |
| lab_status | Publica versión, ocupado/libre y estado del trabajo remoto. |
| lab_prepare | Prepara dependencias fijas de PyPI en el entorno del Lab, con Windows/Python 3.12. |
| lab_doctor | Comprueba dependencias, configuración y lectura de MT5. |
| lab_run | Inicia optimización y validación con la configuración existente. |
| lab_demo | Inicia simulación local de cotizaciones, sin órdenes de trading. |
| lab_stop | Pide cancelación cooperativa al trabajo iniciado por el administrador. |
| lab_results | Devuelve métricas y ventanas 14/30/60/90, sin configuración ni mensajes privados. |

Cada tarea usa id único y expires_at. Solo lab_attach admite un campo adicional,
candidate_id. No hay argumentos de shell, URL, código ni ruta recibidos por la cola.

## Actualización de una instalación existente

El administrador localiza una instalación por sus archivos del Lab. Si varias
coinciden, selecciona únicamente una instalación ocupada inequívoca; en otro
caso requiere lab_attach. Si no existe una, crea una bajo el directorio del bridge.

Nunca sobrescribe config.json, validaciones_consumidas.json, experimentos,
registros ni el entorno .venv existente. Guarda una copia del Python previo.
Si la ventana del Lab mantiene su instancia bloqueada, la actualización queda
pendiente y el bridge vuelve a intentarlo cada minuto. Basta cerrar esa ventana
para permitir que se aplique. No termina el Lab abierto ni MT5.

Después de un cambio de motor, los experimentos anteriores conservan sus fechas
consumidas. Una demo congelada con otro motor no continúa bajo el motor nuevo.
No se inventan costos ni se confirma el horario automáticamente: lab_doctor
devuelve LAB_CONFIG_REQUIRED si los datos existentes no están completos.

El stop remoto se comprueba entre sesiones históricas y en el bucle de demo.
Puede tardar mientras termina una lectura de historial de MT5. Conserva el
registro de validación y marca la campaña interrumpida; no fuerza la muerte
de otros procesos. La interfaz local ignora el marcador remoto de cancelación.

## Validación de esta entrega

- 16 pruebas del administrador: acciones, preservación de archivos, espera por
  instancia ocupada, rollback, rutas, nonce y filtrado de resultados.
- 22 pruebas del motor del Lab y cancelación remota.
- 2 pruebas del paquete firmado contra el launcher original.
- La suite histórica de trading contiene 7 errores de fixtures anteriores al
  cambio, reproducidos también sobre el release 1.0.31 original: esperan XAUUSD
  y estructura M1 cuando el motor activo ya usa rango NAS100. No se modifican
  sus reglas de trading para satisfacer esos fixtures.
- La recepción en VPS requiere un heartbeat nuevo con version 1.0.32.
  Un estado antiguo con state=online no demuestra conexión actual.

