# OLFX: estructura M5, BOS y retest | 1.0.24

Reemplaza Liquidez H4 por MARKET_STRUCTURE_M5_RETEST_TP1.
Cuenta DEMO emparejada, XAUUSD, volumen y filtros locales existentes.
El motor usa exclusivamente velas M5 nativas cerradas.

## Reglas

- Pivotes estrictos con dos velas a izquierda y dos a derecha. Solo se
  conocen después del cierre de las dos velas posteriores.
- Compras: dos máximos y dos mínimos crecientes, cierre alcista por encima
  del máximo confirmado más reciente. Ventas: mínimos y máximos decrecientes
  y cierre bajista por debajo del mínimo confirmado.
- El BOS arma un setup; no abre una operación.
- Una vela M5 posterior debe tocar el nivel roto, con tolerancia del 10%
  del ATR(14) conocido en el BOS (mínimo un tick), y cerrar a favor de la
  estructura y al otro lado del nivel. Se solicita entrada a mercado después
  de ese cierre, no una orden límite retrospectiva.
- El setup caduca después de 12 velas M5, se invalida al cerrar más allá
  del swing contrario y se consume al confirmar un retest.
  El mismo pivote no puede generar otro setup.
- SL detrás del swing y de la vela de retest, con buffer de cinco ticks.
  Para ventas se traslada de bid a ask sumando el spread.
- TP1 cierra todo a 1R respecto a cotización solicitada y SL definitivo.
  El fill real puede variar por slippage. Sin BE, trailing ni cierres por
  tiempo o señal contraria. Se conservan los filtros del bróker, spread y SL.
- Una posición de XAUUSD a la vez, también en hedging. Posiciones y órdenes
  manuales bloquean nuevas entradas. Se mantienen lotes y límites.

Se persiste el cursor y se consume el setup ANTES de aceptar la orden.
Un arranque nuevo reconstruye 512 velas M5 sin entrar en patrones históricos.
Al reconectar se mantienen niveles y órdenes consumidas. Los nuevos envíos
exigen una señal cerrada hace diez segundos o menos y cotización validada.
Una intención enviada o incierta nunca se reenvía tras un reinicio.
Las posiciones aceptadas conservan sus SL/TP originales.

## Verificación

    python -m unittest discover -s bridge/market_structure_m5/tests -v

19 pruebas offline con bróker simulado: ambos sentidos, retest posterior,
caducidad, invalidación, persistencia, precios bid/ask, RR, permisos,
cuenta DEMO, posición única, warmup sin entradas y duplicados.
No son una medición de rentabilidad ni un backtest de mercado.

El paquete parte de la versión instalada 1.0.21, conserva su raíz de confianza
y se firma con la clave privada original fuera del repositorio.
Se verifica con bridge/original/bridge_bootstrap.py.
Los backtests del motor anterior no se atribuyen a esta estrategia.
La activación requiere observar versión 1.0.24, estrategia M5, cotizaciones
frescas y permisos activos; publicar el paquete no confirma su instalación.

## Backtest de ticks | bridge 1.0.25

Añade acciones de backtest de 14/30 días y consulta de progreso para esta
estrategia, sin modificar el motor activo 1.0.24. Usa velas M5 nativas
cerradas, 512 velas de calentamiento y ticks históricos bid/ask. El replay
ejecuta el mismo motor de entradas, estado y SL/TP contra un bróker en memoria.
El acceso al MT5 real es de lectura: no se expone order_send ni order_check.

Reporta cobertura, operaciones cerradas, WinRate, beneficio bruto, profit
factor, drawdown de balance y posiciones abiertas al finalizar. No modela
comisión, swap ni slippage de mercado; utiliza términos actuales de margen.
Las barras M1 sirven para auditar cobertura de ticks, nunca para sustituir
las velas M5 nativas de la estrategia. La ventana termina en un cierre M5.

24 pruebas offline incluyen causalidad M5, retest posterior, protección de
reinicios, réplica del TP con ticks y bloqueo del API real de órdenes.
