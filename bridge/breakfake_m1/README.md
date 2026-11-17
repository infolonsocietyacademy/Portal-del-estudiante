# Breakout + Fake Breakout M1: SL estructural y TP1

Estado: integración candidata 1.0.16, preparada a partir del runtime firmado 1.0.14. **No instalada en la VPS.** El canal sigue en la release firmada anterior porque la clave privada original de actualización no está disponible. Guardar este código no cambia el runtime instalado.

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

Al instalar esta candidata, el worker automático utilizaría esta estrategia M1 en lugar de CRT. Los intentos antiguos que todavía no se han enviado se cancelan; las posiciones ya abiertas conservan sus SL y TP del bróker. El camino de órdenes manuales existente sigue separado.

## Validación reproducible

`python -m unittest discover -s bridge/breakfake_m1/tests -v`

47 pruebas distintas con bróker simulado: tipos de señal, SL estructurales en compras y ventas, spread, tick del bróker, distancia mínima, límite máximo de SL, riesgo porcentual, TP1 completo, disparos bid/ask, cuenta DEMO, netting, rechazo de órdenes, envíos inciertos y reinicios.

`pine_signal_cases.json` contiene 1,000 velas de prueba evaluadas con el bloque de señales del Pine original mediante su AST y ATR/EMA de referencia. Coincidieron las 44 señales y sus SL. La prueba repite esta comparación después de restauraciones de estado. Esto verifica correspondencia lógica; **no es compilación de TradingView, backtest histórico ni prueba de rentabilidad**.

`python -m compileall -q bridge/breakfake_m1/runtime`

## Instalación pendiente

`build_release.py` prepara la release 1.0.16 (secuencia 16) solo si la clave privada proporcionada coincide con la clave pública del launcher original. No incluye ni publica claves privadas ni datos de cuenta. No cambia automáticamente el canal y no sustituye el mecanismo de confianza del actualizador.

Falta recuperar el entorno de firma original, publicar la release verificada y observar un estado nuevo de la VPS que confirme `BREAKOUT_FAKEBREAKOUT_M1_TP1`, periodo M1 y objetivo 1R. Hasta entonces la VPS continúa con CRT de la versión anterior.
