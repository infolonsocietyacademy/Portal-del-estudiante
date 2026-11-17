# ALPHA PRO X para el mismo bot MT5

Integración candidata 1.0.15 preparada a partir del runtime firmado 1.0.14.
**No está desplegada.** La VPS sigue usando su release firmado existente. El canal de actualización no se ha cambiado porque no está disponible la clave privada original de firma. Los archivos de esta carpeta por sí solos no actualizan el bridge.

## Comportamiento implementado

- Mismo terminal DEMO, cuenta emparejada, lote/configuración local y consola existentes.
- CRT de H1 con MSS/retest M5 conservado. ALPHA funciona como segundo motor con cursor e identificadores propios.
- Ejecución limitada al XAUUSD que ya autoriza el bridge. El módulo de señales conserva la tabla de sesiones y buffers de los otros símbolos del indicador para futuras integraciones; no habilita ejecución en ellos.
- Sesiones de oro en Nueva York: 02:00–02:15, 10:30–10:45 y 18:45–20:00. Cambio de horario de verano calculado sin depender de tzdata en Windows. El adaptador usa la diferencia de reloj observada por el bridge; no fija una zona horaria de bróker.
- Rango de sesión completo, buffer de 0.15 en oro, primer cruce al cierre M5, filtro de calidad Normal con mínimo 5 puntos. El filtro es una puntuación de reglas, no un modelo entrenado.
- Una idea principal por sesión, con reversa si hay cierre en la zona contraria antes de resolver la idea. No se impone un límite global de tres operaciones.
- Una segunda entrada por idea. El núcleo permite Continuation y Retest; el adaptador utiliza Continuation como el código enviado. En oro la distancia de referencia es 0.25 en precio, heredada de la fórmula del indicador; no significa una ganancia garantizada de $25.
- Una orden distinta por entrada con su SL estructural y TP de 2R. TP1 y TP3 se conservan como referencias en las señales. La segunda entrada usa SL a mitad del nuevo entry y el SL original.
- Se preservan validación de spread, precio reciente, lote, distancia máxima de SL, permisos DEMO, restricciones de netting y reconciliación de envíos inciertos.
- Cursores y órdenes persistidos antes del envío evitan repetir señales al reiniciar. El arranque no ejecuta señales históricas.
- Backtesting por ticks preparado con el mismo motor combinado; sin backtest histórico nuevo ejecutado en la VPS.

## Adaptaciones respecto al indicador

Estas decisiones mantienen la regla previamente solicitada: cerrar únicamente al tocar SL o TP.

1. SL real en el bróker por toque. El indicador original solo declaraba pérdida con un cierre M5 fuera de la zona; ese comportamiento no representa un SL duro.
2. La reversa abre una idea opuesta y conserva la orden original hasta su SL/TP. No envía cierres forzosos.
3. La segunda entrada no cambia retrospectivamente entry, SL o TP de la primera. El indicador sobrescribía los niveles de la idea anterior.
4. La segunda entrada exige una vela posterior y entra al cierre M5 observado. No simula una ejecución anterior dentro de la vela.
5. Una vela ambigua que toca SL y TP1 invalida conservadoramente los add-ons. Los resultados del backtest se obtienen de los ticks bid/ask y de operaciones cerradas, no de contadores visuales.
6. Recovery y Rejection en el indicador son avisos sin gestión de órdenes; no se convierten en operaciones adicionales. Ribbon estaba desactivado y los niveles de 15m no se utilizaban para entrar.
7. No se utiliza como probabilidad real la puntuación visual limitada a 55–97%. No se ha calculado WinRate ni se afirma rentabilidad de ALPHA.

## Validación

`python -m unittest discover -s bridge/alpha_pro_x/tests -v`

71 pruebas locales con bróker simulado: compras, ventas, filtro, retest, add-on único, reversas, sesiones completas, cambio de hora, reloj del bróker, cursor persistente, reinicio, cuenta DEMO, lotaje, órdenes manuales, continuidad CRT, SL/TP y replay bid/ask. Incluye construcción con una clave efímera de prueba y rechazo de claves que no corresponden al launcher original. Ninguna prueba conecta con MetaTrader real.

Para compilar: `python -m compileall -q bridge/alpha_pro_x/runtime`.

## Publicación pendiente

`build_release.py` construye el release únicamente con una clave privada que coincida con `bridge/original/update_public_key.json`. La dependencia de build es cryptography; el runtime continúa usando biblioteca estándar más la integración MT5 ya instalada.

Cuando esté disponible el material de firma original: construir el paquete, verificarlo con `parse_release` del launcher existente, guardar release inmutable y actualizar el canal con su commit y SHA256. Después debe verificarse una nueva lectura de estado de la VPS antes de afirmar activación. No sustituir el trust root, omitir la firma ni copiar archivos sueltos sobre el runtime activo.
