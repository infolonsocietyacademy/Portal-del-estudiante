# OLFX Liquidez H4: entradas M1, SL estructural y TP1 1R

Reemplazo del motor Breakout/Fake Breakout por la estrategia del archivo
OLFX_LIQUIDEZ_H4_ESTRATEGIA.pine. Runtime 1.0.20; cuenta DEMO emparejada,
XAUUSD, configuracion de lote/riesgo existente sin ampliacion de limites.

Compra: primera perforacion de un LOW de las ultimas tres H4 cerradas,
cierre M1 por encima del nivel, cierre anterior dentro y vela alcista.
Venta: primera perforacion de un HIGH H4 y confirmacion inversa con vela bajista.
Si hay rechazo de ambos lados en la misma vela se descarta la entrada.
Se consumen los niveles en su primera perforacion aunque no haya entrada.
La opcion de pivotes existe en el motor puro; por defecto esta desactivada,
igual que en Pine. Minimo de barrida: un tick. Buffer del SL: cinco ticks.

SL fijo detras de la vela de barrida. En ventas se suma el spread al extremo
bid para trasladar el SL al precio ask que lo activa. El TP1 cierra todo el
volumen a 1R respecto a la cotizacion de entrada solicitada y al SL definitivo.
El fill real puede cambiar esa relacion por slippage. Sin parciales, trailing,
BE, cierre por tiempo ni cierre por senal contraria. Si el SL no cumple los
limites del broker o de la configuracion local, se omite la entrada.

Una posicion de XAUUSD a la vez, tambien en cuentas hedging. Se respetan
posiciones manuales u otras ya abiertas. Historial y posiciones anteriores
se reconcilian; los intentos antiguos sin enviar se cancelan. Las nuevas
ordenes del motor anterior se rechazan. El arranque reconstruye niveles e
historial sin ejecutar senales pasadas; el cursor y los niveles consumidos
se guardan antes de aceptar cada evento.

Se utilizan H4 nativas del broker, no agrupaciones UTC. Distintos feeds o
sesiones H4 pueden dar niveles diferentes respecto a TradingView. Solo se
usan H4 y M1 cerradas. La entrada real se solicita en la primera cotizacion
valida despues del cierre M1, dentro de diez segundos. Se conserva la
verificacion de cuenta DEMO, terminal, cuenta emparejada y frescura del precio.

Validacion: `python -m unittest discover -s bridge/liquidez_h4/tests -v`.
29 pruebas con broker simulado y verificacion de firma y archivos del paquete.
No son un backtest de rentabilidad. Las acciones de backtest del motor anterior
devuelven LIQH4_BACKTEST_NOT_IMPLEMENTED para no atribuir resultados anteriores
a esta estrategia.

El paquete se firma con la identidad instalada existente; no cambia la raiz
de confianza. La clave privada queda fuera del repositorio y de la VPS.
Instalacion por el canal automatico existente, seguida de inicio y lectura
nueva de estado. La publicacion por si sola no confirma la activacion.
