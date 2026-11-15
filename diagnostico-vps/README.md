# Diagnostico live para la VPS Windows

Descarga [OLFX_DIAGNOSTICO_VPS.cmd](../OLFX_DIAGNOSTICO_VPS.cmd), guardalo en la VPS y ejecutalo con doble clic. Necesita Python 3.12 x64 e Internet. El CMD contiene el monitor completo y comprueba su integridad; prepara Playwright 1.65.2 en una carpeta propia, sin cambiar los paquetes del conector.

1. Para capturar tambien la consola del conector, detén su CMD anterior con `Ctrl+C`. Si lo dejas abierto, el monitor detecta el proceso y evita iniciar otra copia; no puede recuperar la salida de una consola que ya estaba abierta.
2. Ejecuta el nuevo CMD. Abre Microsoft Edge o Chrome; si no encuentra un navegador compatible, instala Chromium para el diagnostico.
3. Inicia sesion en el portal que abre el monitor y reproduce el problema. Deja abiertas la consola y el navegador.
4. Los eventos aparecen en vivo y se guardan en `%LOCALAPPDATA%\OLFXConnect\diagnostico\logs\portal-live.jsonl`.
5. `Ctrl+C` o cerrar el navegador detiene el monitor. Si el monitor inicio el conector, tambien detiene ese proceso; despues puedes volver al CMD habitual.

## Eventos registrados

- Errores JavaScript con mensaje, archivo, linea y stack; mensajes de consola.
- Respuestas HTTP con metodo, ruta, estado, identificador y tiempo; fallos de red y errores JSON de la API.
- Navegacion, pantalla activa, salida del portal hacia el login, mantenimiento y estado de conectividad.
- Apertura, cierre y errores de conexiones WebSocket, sin leer sus mensajes.
- Estados de cuentas que la sesion recibe del conector: cuenta enmascarada, balance, equity, movimientos, fecha de sincronizacion y ultimo error. Solo se registran campos permitidos, cuando cambian.
- Salida del agente instalado, cuando el monitor lo inicia. Se conserva su comportamiento de sincronizacion; el modo diagnostico no actualiza su codigo.
- Presencia del proceso del agente en Windows cada 15 segundos, con aviso si desaparece.
- Disponibilidad del portal y respuesta del endpoint cada 30 segundos. La prueba del endpoint usa `OPTIONS`: comprueba acceso HTTP/CORS, no certifica el funcionamiento interno de la base de datos.

Cada evento incluye hora UTC, hora local con zona, sesion del diagnostico y secuencia. El archivo rota al llegar a 5 MB y conserva cuatro archivos anteriores (hasta unos 25 MB). Los errores de sesiones de otros dispositivos y los logs internos del servidor requieren instrumentacion adicional; este monitor observa el navegador que abre y su VPS.

## Datos y privacidad

No lee formularios, contraseñas, cookies, almacenamiento del navegador, claves privadas ni el archivo de configuracion del agente. No registra cabeceras ni cuerpos de peticiones; elimina queries, fragmentos y credenciales de las URLs, y filtra secretos en mensajes. La sesion del navegador es temporal. No genera capturas, HAR ni videos. Los logs no se suben automaticamente.

**Los logs pueden incluir montos y detalles tecnicos de cuentas visibles en esa sesion.** Guardalos en la VPS y compartelos solo de forma privada. No contienen el historial de todas las cuentas del portal ni constituyen un extracto de MT5. No ejecuta operaciones ni modifica registros financieros.

## Desarrollo y pruebas

`python3 scripts/build-vps-diagnostics.py` regenera el CMD desde `portal_monitor.py`; `--check` detecta un paquete desactualizado. Las pruebas Python verifican redaccion, eventos, aislamiento de datos y el paquete. Para una prueba local sin agente: `python portal_monitor.py --no-agent --headless --seconds 10` (requiere Playwright y navegador).
