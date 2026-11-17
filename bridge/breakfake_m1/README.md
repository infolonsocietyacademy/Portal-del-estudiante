# Breakout + Fake Breakout M1: SL estructural y TP1

Estado: versión 1.0.18 firmada con la clave original aceptada por el bridge instalado. Se recuperó una copia válida del firmante original: la actualización puede aplicarse por el canal automático existente, sin cambiar la clave pública de la VPS. La activación se confirma únicamente con una lectura nueva del bridge y del worker M1. La estrategia anterior permanece pausada hasta verificar el cambio.

## Orden solicitada

- Estrategia automática: Breakout + Fake Breakout del indicador adjunto, entradas confirmadas al cierre de **1 minuto**.
- Activo ejecutable: XAUUSD ya autorizado localmente. Lote y riesgo se leen de la configuración existente; no se amplía el límite de pérdida ni la distancia máxima de SL.
- Salida: **100% del volumen en TP1**, definido como 1R respecto al precio de entrada solicitado y el SL final redondeado. La ejecución real puede variar por deslizamiento.
- SL de breakout: detrás del extremo contrario del rango de 20 velas, más 0.20 ATR.
- SL de fake de una vela: detrás del extremo barrido, más 0.20 ATR.
- SL de fake tras ruptura: detrás del extremo completo observado desde la ruptura hasta el regreso, más 0.20 ATR.
- El ATR se toma de la vela anterior ya cerrada. El margen mínimo siempre es de un tick.
- En ventas se suma el spread observado al nivel estructural calculado con barras bid, dado que el stop de una venta se activa con ask. Un cambio posterior de spread todavía puede afectar cuándo se activa.
- SL y TP1 se incluyen en la solicitud inicial al bróker. Si la geometría, el spread, el redondeo, el lote o la distancia mínima no pasan la validación, se omite la entrada. No se abre una orden sin protección.
- No hay TP2, TP3, cierres parciales, trailing, breakeven ni cierre por tiempo para esta estrategia. Una señal opuesta no liquida posiciones anteriores.

## Señales y continuidad

Se conservan los valores por defecto del indicador: rango previo de 20 velas, ATR 14, EMA 50 para breakout, cuerpo mínimo 55%, cierre en el 25% exterior de la vela, buffer 0.10 ATR, mecha mínima 35% en fake de una vela y regreso al rango en hasta 3 velas para fake posterior. El cooldown de 3 velas se aplica a señales normales; la reversa confirmada de una ruptura puede saltarlo, igual que en Pine. No hay filtro horario por defecto.

El estado de ATR, EMA, rango, ruptura pendiente y rearme se guarda antes de aceptar una orden. El arranque y la recuperación de datos históricos no ejecutan señales antiguas. Un mismo evento no puede enviarse de nuevo con otro identificador. Se mantiene la restricción DEMO, cuenta emparejada, terminal correcto, comprobación de cotizaciones y reconciliación de envíos inciertos.

Se eliminó el motor CRT H1/M5 del runtime nuevo. Se rechazan nuevas órdenes CRT y se bloquea también el envío de órdenes CRT antiguas persistidas. Las posiciones ya aceptadas solo se reconcilian y conservan sus SL/TP. Al instalar esta candidata, el worker automático utilizaría esta estrategia M1 en lugar de CRT. Los intentos antiguos que todavía no se han enviado se cancelan; las posiciones ya abiertas conservan sus SL y TP del bróker. El camino de órdenes manuales existente sigue separado.

## Validación reproducible

`python -m unittest discover -s bridge/breakfake_m1/tests -v`

63 pruebas distintas (51 del motor, 9 de la recuperación archivada y 3 de la versión firmada actual) con bróker simulado: tipos de señal, SL estructurales en compras y ventas, spread, tick del bróker, distancia mínima, límite máximo de SL, riesgo porcentual, TP1 completo, disparos bid/ask, cuenta DEMO, netting, rechazo de órdenes, envíos inciertos y reinicios.

`pine_signal_cases.json` contiene 1,000 velas de prueba evaluadas con el bloque de señales del Pine original mediante su AST y ATR/EMA de referencia. Coincidieron las 44 señales y sus SL. La prueba repite esta comparación después de restauraciones de estado. Esto verifica correspondencia lógica; **no es compilación de TradingView, backtest histórico ni prueba de rentabilidad**.

`python -m compileall -q bridge/breakfake_m1/runtime`

## Actualización automática por el bridge existente

La versión actual está en `releases/release_1.0.18.json` y en el canal oficial de actualizaciones. Está firmada con la identidad original. La clave privada no se publica ni se copia a la VPS. Las pruebas verifican que el launcher original acepta la firma y que el archivo contiene exactamente el runtime probado.

El bridge valida la firma y los hashes, instala en una versión aislada y cambia de motor cuando queda libre. Se conserva la configuración existente. Después de observar la versión nueva, se envía el inicio normal de la estrategia por el buzón.

La carpeta `recovery` conserva el procedimiento alternativo preparado antes de localizar la clave original. Es un archivo histórico; no es necesario ejecutarlo para la actualización actual.

La instalación solo se confirma al observar versión 1.0.18, `BREAKOUT_FAKEBREAKOUT_M1_TP1`, periodo M1, objetivo 1R, cuenta DEMO y estado operativo en una lectura nueva de la VPS.
