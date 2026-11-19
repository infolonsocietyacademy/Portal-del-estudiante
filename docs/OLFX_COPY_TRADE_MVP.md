# OLFX Copy Trade — MVP (cuentas propias)

Estado: diseño inicial; **no habilitado para ejecutar operaciones reales**.

## Alcance
Una cuenta MT5 maestra origina operaciones y una o más cuentas MT5 propias receptoras las replican mediante agente Windows/VPS. No se usa el conector de estadísticas de solo lectura para ejecutar órdenes.

## Ajustes en Portal del Trader (área del estudiante)
Ruta propuesta: Cuentas MT5 > Copy Trade (solo cuentas verificadas del mismo usuario).
- Activar/desactivar copia (predeterminado: desactivado).
- Seleccionar cuenta maestra y cuentas receptoras; impedir que una receptora sea maestra de sí misma o forme ciclos.
- Modo lotaje: fijo, multiplicador o proporcional al equity; límites de lote por cuenta.
- Copiar aperturas, modificaciones SL/TP, cierres parciales y cierres totales.
- Símbolos permitidos, mapeo de sufijos de broker, desviación máxima, límite de spread y horario.
- Límite de pérdida diaria, exposición máxima, número máximo de posiciones, botón detener copia.
- Estado de conexión, última sincronización, historial de eventos y errores por cuenta.

## Seguridad y arquitectura
1. El servidor comprueba que las cuentas pertenecen al usuario autenticado y que tienen autorización de trading; la contraseña de inversor no sirve para ejecutar.
2. Credenciales de trading nunca se envían al navegador ni se guardan en texto plano; usar almacenamiento cifrado y controles de acceso por cuenta.
3. El agente Windows/VPS lee eventos de la maestra, asigna ID único por operación y los entrega a cada receptora con idempotencia para impedir duplicados tras reconexión.
4. Comprobar volumen mínimo/paso, margen, mercado abierto, símbolos, slippage y modo netting/hedging antes de enviar órdenes.
5. Registrar ticket origen y destino, hora, estado, motivo de rechazo y reconciliación tras reinicio.
6. Arranque solo en DEMO; activación LIVE requiere pruebas y confirmación separada.

## Criterios de aceptación
- Una operación origen produce como máximo una apertura por receptora incluso tras reiniciar el agente.
- SL/TP, cierres parciales y totales se reflejan con auditoría; los errores no provocan aperturas repetidas.
- Si el agente pierde conexión, detiene nuevas ejecuciones hasta reconciliar tickets.
- La desactivación corta nuevas copias, sin cerrar posiciones existentes salvo orden explícita.
- Ningún usuario puede controlar cuentas de otro usuario.

## Próximos pasos técnicos
Identificar frontend y tablas de cuentas MT5 existentes; añadir migración RLS, API autenticada, interfaz de ajustes y worker de ejecución. No modificar el bridge de estrategia actual.
