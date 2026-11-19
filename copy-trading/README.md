# OLFX Copy Trade · piloto con ajustes en el portal

Una maestra copia a tus propias cuentas receptoras. El panel guarda la configuración en Supabase y el agente Windows consulta solo el grupo del propietario que emparejó OLFX CONNECT. Las cuentas de otros estudiantes no se utilizan ni se importan como receptoras.

## Puesta en marcha

1. Descarga esta carpeta completa del repositorio en Windows. Mantén sus archivos juntos.
2. Requiere Python 3.12 de 64 bits y MetaTrader5: `py -3.12 -m pip install -r requirements.txt`.
3. Usa una instalación independiente de MT5 por cuenta. Inicia cada sesión manualmente. No reutilices el terminal del sincronizador de estadísticas: ese agente cambia de cuenta y el copiador lo bloquea expresamente.
4. En **Copy Trade** del portal configura número, servidor, ruta de cada terminal y mapa de símbolos exacto. La maestra puede ser de lectura; las receptoras demo necesitan permiso de trading algorítmico. No escribas contraseñas en el panel.
5. Guarda primero en **Simulación**. Los cambios dejan el grupo pausado. Ejecuta `INICIAR_COPY_PORTAL.cmd`, que reutiliza localmente el token de `%LOCALAPPDATA%\OLFXConnect\settings.json` sin mostrarlo ni subirlo al repositorio.
6. Espera «Pausa confirmada» y pulsa **Iniciar modo seleccionado**. Verifica los registros de Windows y los estados de receptoras. Antes de cambiar a demo, pausa y espera confirmación.

## Comportamiento

- Solo modos `paper` (sin enviar órdenes) y `demo` (receptoras demo con hedging). La ejecución en cuentas reales no está habilitada.
- Solo nuevas posiciones a mercado; no replica órdenes pendientes. Las posiciones previas a la primera activación forman una base y se omiten.
- Multiplicador de volumen por receptora, redondeo hacia abajo al paso del bróker. No eleva el volumen al mínimo ni lo recorta silenciosamente al máximo: bloquea entradas fuera de límites.
- Exige SL; replica TP si está definido. Ajusta SL sin ampliar riesgo, refleja cierres completos y parciales y conserva registros para evitar duplicados al reiniciar.
- Valida equivalencia de contratos, precio reciente, spread, desviación, riesgo por entrada, posiciones y pérdida diaria (desde el equity de la primera lectura del día UTC). Son filtros de nuevas entradas, no un cierre forzoso de pérdidas.
- `max_positions` cuenta posiciones del copiador en esa receptora; no limita las posiciones manuales.
- Cada envío vuelve a consultar pausa y revisión. Si el portal falla o cambia la revisión, se detiene la solicitud. Un envío ya aceptado por el bróker puede finalizar mientras llega la pausa; el panel diferencia solicitud y confirmación.
- Pausar detiene entradas **y seguimiento**. No cierra posiciones. Desactivar una receptora también detiene su seguimiento. Sus SL/TP continúan en el bróker.
- El estado persistente está en `%LOCALAPPDATA%\OLFXCopy`. No lo borres para resolver errores: un resultado incierto requiere revisar MT5 antes de reanudar.
- Cambiar identidad, ruta o lista de receptoras después de haber iniciado el motor bloquea el grupo para proteger su historial. Los ajustes de límites y símbolos conservan el estado. Para ampliar un grupo en uso se requiere migrar su estado; no está automatizado en este piloto.

## Validación realizada

Pruebas unitarias del motor con intermediario simulado, validación del contrato, aislamiento de usuarios y controles del panel. Ninguna orden real ni demo fue enviada durante el desarrollo. Falta validar en Windows con tus terminales, cuentas demo y permisos del bróker. La latencia real y ejecución de múltiples terminales todavía no están medidas.
