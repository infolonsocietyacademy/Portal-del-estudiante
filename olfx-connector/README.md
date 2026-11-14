# OLFX CONNECT V1 — Cuenta MT5 propia, sin MetaApi

**Primera versión de prueba**: conexiones desde el Portal del Trader para MT5, agente Windows privado, con respaldo de historiales existentes. El nuevo botón de conexión no llama a MetaApi.

## Prueba local antes de comprar una VPS

Puedes validar **una cuenta real de Axi MT5**, sin cargar contraseñas ni transferir historiales al portal. En una computadora Windows con MT5 abierto y con la cuenta iniciada:

1. Instala Python 3.12 de 64 bits (no Python 3.15).
2. Descarga la carpeta `olfx-connector`.
3. Ejecuta `01_PROBAR_SIN_VPS.bat`, o en PowerShell:
   ```powershell
   py -3.12 -m pip install -r requirements.txt
   py -3.12 olfx_agent.py doctor
   ```
4. El diagnóstico confirma lectura de cuenta e historial de 7 días; **no comprueba todavía la sincronización con Supabase**. No envíes claves ni capturas con credenciales.

**Para conectar estudiantes desde el portal hay que emparejar primero el agente Windows.** Si no existe un agente emparejado, el formulario indicará que el servicio está en preparación. La computadora Windows puede sustituir a la VPS durante las pruebas.

## Instalación en tu computadora Windows (no requiere VPS)
1. Instala Python 3.11 o 3.12 (64 bits), y MetaTrader 5 de Axi. Recomendado: Python 3.12 64-bit. **No uses Python 3.15 para la librería MetaTrader5**: no existe un paquete compatible publicado para esa versión.
2. Descarga el directorio `olfx-connector` del repositorio y descomprímelo.
3. Abre PowerShell dentro del directorio y ejecuta:
   ```powershell
   py -3.12 -m pip install -r requirements.txt
   py -3.12 olfx_agent.py init
   ```
4. Copia **solamente la clave pública** mostrada entre BEGIN/END PUBLIC KEY.
5. En tu Portal del Trader entra como administrador a **OLFX CONNECT · MT5**, pega la clave pública y pulsa **Emparejar equipo**.
6. El portal mostrará **una sola vez** un token privado. No lo compartas por WhatsApp, capturas ni GitHub. En la computadora ejecuta `py -3.12 olfx_agent.py configure` y pega el token cuando lo pida. Introduce la ruta del archivo `terminal64.exe` de MT5.
7. Prueba `py -3.12 olfx_agent.py once`. Para actualizaciones mientras la PC está encendida ejecuta `py -3.12 olfx_agent.py run`; también puedes usar el Programador de tareas de Windows para ejecutarlo al iniciar sesión.

**Acceso desde iPad:** Los estudiantes y el administrador abren el Portal del Trader en Safari. No necesitan instalar Python ni conectarse por Escritorio Remoto para ver las estadísticas; el agente sí debe ejecutarse en un Windows/VPS encendido para sincronizar.

**Sincronización rápida al conectar una cuenta nueva:** Desde Windows descarga `OLFX_SINCRONIZACION_RAPIDA_WINDOWS.cmd` en la raíz del repositorio y ejecútalo una sola vez. Utiliza la configuración ya guardada en `%LOCALAPPDATA%\\OLFXConnect` y actualiza el agente, sin volver a emparejar ni compartir el token. Mantén la ventana abierta y la computadora encendida. El agente consulta cada **15 segundos** si se han registrado nuevas cuentas MT5. Cuando encuentre una en estado `waiting`, importa su historial de hasta 365 días en lotes de 150; las cuentas ya activas se actualizan una vez cada 24 horas. Si la contraseña de inversor es incorrecta, registra error y no reintenta indefinidamente.

**Actualización manual:** `py -3.12 olfx_agent.py once` fuerza una sincronización incluso de cuentas activas. **Modo continuo:** `py -3.12 olfx_agent.py watch` o `py -3.12 olfx_agent.py run`; ambos ahora detectan conexiones nuevas rápidamente y refrescan las ya sincronizadas una vez cada 24 horas. Si Windows se apaga, la sincronización se interrumpe. `watch` no instala por sí mismo un servicio de Windows ni crea una tarea programada.

## Instrucciones para estudiantes
1. En el Portal del Trader, abre **Mis cuentas MT4/MT5**.
2. Selecciona **MT5**. MT4 aún no se admite con este conector.
3. Selecciona Axi y escribe manualmente el **nombre EXACTO del servidor** que aparece en su MetaTrader.
4. Introduce el **número de cuenta** y **contraseña de inversor (solo lectura)**, nunca la clave principal.
5. Toca **Conectar cuenta desde el portal**. El navegador cifra la información con la clave pública del equipo Windows antes de enviarla a Supabase.
6. Aparecerá **Esperando computadora**; al ejecutar el agente Windows, el estado cambiará a **Cuenta sincronizada**.
7. Si no se conecta, revisa el error y confirma la contraseña de inversor. No envíes credenciales al administrador por mensajes.

## Qué se obtiene
Balance y equity, historial (primera sincronización: últimos 365 días; posteriores: se revisan últimos siete días), tipo de movimiento, comisiones, swaps y P&L por operación. El portal conserva los datos de Supabase aun con la PC apagada.

## Importante
- La interfaz y la función nueva no utilizan MetaApi ni cobran su licencia. **Las cuentas antiguas de MetaApi y su tarea de sincronización son independientes**, y pueden seguir generando cargos en MetaApi hasta que el administrador cancele sus despliegues y desactive esa tarea; verifica la factura antes de cancelarla.
- La primera versión NO es multi-MT4 ni garantiza el historial anterior a 365 días. Los rankings con datos incompletos no deben considerarse verificados.
- El worker Windows **sí requiere** MetaTrader 5 instalado en esa computadora; puede ejecutarse en tu computadora personal sin VPS.
- Si otro usuario controla el perfil Windows podría leer el archivo de clave privada y el token; protege la cuenta Windows con contraseña y BitLocker si está disponible.
- No cambies ni borres `private_key.pem` después de enlazar cuentas; si pierdes la clave, los estudiantes deben reconectar sus cuentas.
- La conexión puede fallar si el broker limita el acceso o las credenciales no sirven. La aplicación móvil no ejecuta Python.
- Si la misma cuenta ya estaba enlazada en MetaApi, el historial se conserva mediante Account Vault y no se mezcla con otros números de cuenta.
- Las operaciones se insertan de forma idempotente (por vault_account_id y deal_id). Sincroniza solamente cuentas autorizadas.
- El agente inicia sesión sucesivamente. No se ha probado todavía con una cuenta real de Axi; requiere prueba supervisada antes de hacer un cambio general.

## VPS Windows: autoactualizacion permanente del agente Python

**Usa el nuevo lanzador** [OLFX_VPS_AUTOACTUALIZABLE.cmd](../OLFX_VPS_AUTOACTUALIZABLE.cmd), ubicado en la raiz de GitHub, una sola vez para reemplazar la ventana antigua del paso 6.

1. En la VPS, detén el CMD anterior de OLFX CONNECT con `Ctrl+C` (solo una ventana/agente activo).
2. Descarga `OLFX_VPS_AUTOACTUALIZABLE.cmd` desde GitHub a la VPS y haz doble clic.
3. El lanzador utiliza los archivos ya existentes en `%LOCALAPPDATA%\\OLFXConnect`: `settings.json`, `private_key.pem` y `olfx_agent.py`.
4. Valida el codigo nuevo descargado de la rama `main` y ejecuta `py -3.12 -u olfx_agent.py watch`.
5. Cada **5 minutos** revisa si el archivo Python de la rama `main` ha cambiado. Al terminar cualquier sincronizacion de MT5, valida sintaxis y componentes esperados, guarda un respaldo `olfx_agent.py.previous` y reemplaza el agente de forma atomica.
6. El lanzador detecta el codigo de salida **75**, inicia la nueva version y, si esa version falla inmediatamente, restaura el respaldo y desactiva temporalmente las actualizaciones para evitar bucles.

**Limites y precauciones:** No modifica ni sube al repositorio `settings.json`, `private_key.pem`, contraseñas, tokens ni datos de estudiantes. La descarga de codigo tiene como origen fijo el propio repositorio de OLON y usa HTTPS. No actualiza automaticamente Python, MetaTrader 5 ni las dependencias de `requirements.txt`. Para funcionar tras reinicios completos de Windows sigue siendo necesaria una tarea de inicio de sesion y que MT5 sea accesible. El CMD viejo puede sincronizar, pero **no** reinicia las nuevas versiones sin el lanzador supervisado.

**Si hay un error de GitHub:** se conserva el agente instalado y vuelve a intentarlo en cinco minutos. Si un cambio nuevo se instala pero falla en su inicio, el lanzador restaura el codigo previo.

## Sincronizacion MT5 exclusivamente a solicitud del estudiante

A partir de esta version **registrar una cuenta MT5 no importa operaciones**. Queda guardada con estado `registered` y la misma clave de inversor cifrada, hasta que el estudiante autenticado haga clic en **Actualizar estadísticas**. Ese boton invoca `refresh-my-accounts` en `olon-own-connect`, que pone las cuentas de ese estudiante en `waiting`; la VPS solo lee esa cola cada 15 segundos. Al terminar todos los lotes, el servidor vuelve la cuenta a `active`. Si ocurre un error se conserva lo ya sincronizado y no se programa un nuevo intento por tiempo. **No hay refresco diario ni automatico al conectar.**

Pulsar **Reintentar sincronización** de una cuenta especifica tambien es una orden manual explicita. **Actualizar acceso de inversor** solo guarda las credenciales nuevas cifradas; no solicita descarga hasta que el estudiante pulse el boton de actualización. La pantalla puede consultar Supabase para mostrar estados actualizados, pero esas lecturas **no** conectan al bróker ni importan movimientos nuevos.

La autoactualizacion de Python es independiente de los datos: el CMD supervisado puede actualizar codigo desde GitHub cada 5 minutos, pero nunca dispara una sincronizacion MT5 sin una solicitud previa. Si la VPS tiene el agente antiguo, hay que ejecutar una vez el CMD autoactualizable con la nueva version para obtener este comportamiento.

