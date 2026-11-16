# OLFX MT5 Bridge Residente 2.0.0-rc1

Instalador manual y receptor DEMO paralelo al Bridge 1.0.9. Se conecta a la
terminal propietaria ya abierta por la API oficial de MetaTrader5. No intenta
relanzar un perfil para cada comando. No cambia el actualizador firmado existente.

## Instalar

Descargar el ZIP completo, extraer y ejecutar INSTALAR.cmd en la misma sesion
de Windows de la instalacion OLFX existente. El instalador verifica el manifiesto,
crea un entorno Python aislado, ejecuta las pruebas y hace un diagnostico sin ordenes.
Consulte LEEME_PRIMERO.txt para permisos locales de Python y controles de parada.

No hay ninguna orden de trading en el instalador ni en el buzon inicial.
No se debe confundir un paquete preparado con una instalacion ya comprobada.

## Ordenes

Buzon separado sobre olfx-mt5-bridge:
bridge/resident-v2/control/worker-01-resident.json

Una nueva tarea tiene un ID unico y fecha de expiracion UTC. Las tareas
existentes son inmutables y los IDs no se pueden reutilizar con otro contenido.

Ejemplo de formato (NO esta encolado):

{
  "id": "oro-m5-identificador-unico",
  "action": "trade",
  "expires_at": "2099-01-01T00:00:00Z",
  "symbol": "XAUUSD",
  "direction": "structure",
  "timeframe": "M5",
  "hold_seconds": 300,
  "signal_timeout_seconds": 1800,
  "rr": 2.0
}

La expiracion de ejemplo es solo documentacion; una solicitud operativa debe
expirar en minutos, no en anos. symbol debe coincidir con gold_settings.json local.
Si no se indica lots ni risk_percent se usa la configuracion local ya aprobada.
Esos dos campos se excluyen mutuamente. Limites: 1 lote, riesgo 2%, 3 tareas activas.
direction=structure exige una nueva vela cerrada y ruptura confirmada HH/HL o LH/LL.
El timeframe y hold_seconds son conceptos independientes; no obliga a que el trade
dure todo ese tiempo si antes alcanza SL/TP.

action=close exige target_id de una tarea propia. Solicita cancelar la espera o
cerrar su posicion; el cierre efectivo se confirma en el resultado de target_id.
ping, diagnose y status son de lectura y no admiten campos adicionales.

## Estados y recuperacion

waiting -> submitted -> open -> closing -> done
Un resultado incierto se conserva como uncertain y se reconcilia, sin reenviar
una apertura. Se escribe estado durable antes de order_send.
Las respuestas de red no bloquean el hilo que gestiona posiciones.
Los cierres comprueban cuenta DEMO, terminal, ticket, simbolo y magic de la tarea.
En hedging se admiten posiciones ajenas abiertas. En netting, un conflicto en el
mismo simbolo se comunica y no mezcla el patrimonio de operaciones diferentes.
No se hacen login ni cambios de cuenta desde Python.
Los reinicios de Windows y cierres forzados interrumpen los timers locales;
SL/TP siguen en broker. El receptor debe volver a iniciarse para gestionar tiempos.
Un cierre incierto exige reconciliacion y no se reintenta a ciegas.

El buzon remoto contiene solo resumenes. Cuenta, token DPAPI, tickets y
configuracion privada permanecen locales. No hay puertos entrantes abiertos.

## Validacion

python -m unittest discover -s tests -v
python -m compileall -q .

Pruebas con broker simulado; no equivalen a una prueba de integracion en la VPS.
INSTALAR.ps1 exige las mismas pruebas y doctor antes de iniciar el receptor.
No se envia una orden real de DEMO automaticamente.

## Referencias oficiales

- https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5terminalinfo_py
- https://pypi.org/project/metatrader5/5.0.6231/
