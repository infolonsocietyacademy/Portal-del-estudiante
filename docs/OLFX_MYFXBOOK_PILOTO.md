# OLFX × Myfxbook — piloto privado (solo administrador)

Esta integración es una **prueba controlada**, no un reemplazo completo de MetaApi ni una fuente oficial de operaciones para el TOP TRADER.

## Antes de comenzar
1. En el celular abre https://www.myfxbook.com y crea una cuenta Myfxbook separada para la academia (siempre que sus términos permitan este uso).
2. El estudiante conecta su MT4/MT5 a Myfxbook mediante Auto Update, proporcionando **solo la contraseña de inversor** y tras aceptar expresamente participar en la prueba.
3. Comprueba que Myfxbook muestra resultados y que el sistema de actualización seleccionado admite el bróker.
4. Obtén autorización de Myfxbook para usar su API en el entorno de academia/suscripción; sus guías indican que las aplicaciones que utilizan la API deberían ser gratuitas. No asumir aprobación comercial.

## Configuración de Supabase (no pegues credenciales en GitHub ni en ChatGPT)
- Proyecto: Portal del Trader.
- **Edge Function Secrets**:
  - `MYFXBOOK_EMAIL`: correo exclusivo de la cuenta Myfxbook autorizada.
  - `MYFXBOOK_PASSWORD`: contraseña **de Myfxbook**, no contraseña de trading MT4/MT5.
- Función desplegada: `olon-myfxbook-trial`. La cuenta permanece privada; el navegador nunca ve estos secrets.

## Prueba en el portal
1. Inicia sesión como administrador.
2. Ve a **Centro administrativo → Myfxbook (prueba)**.
3. Presiona **Detectar cuentas Myfxbook**.
4. Selecciona la cuenta identificada y el estudiante correspondiente.
5. Confirma que tienes autorización del estudiante y elige **Vincular cuenta de prueba**.
6. Presiona **Sincronizar prueba** y compara el balance y los resultados contra los que muestra Myfxbook.

Los datos se guardan por separado en:
- `public.olon_myfxbook_links`: datos generales y última sincronización.
- `public.olon_myfxbook_daily`: hasta 45 días de resultados diarios consultados, separados por cuenta.

## Seguridad y limitaciones
- El módulo está oculto y restringido por servidor a administradores activos.
- Las cuentas vinculadas y los agregados diarios tienen RLS de lectura restringida por estudiante, sin escrituras desde el navegador.
- La API oficial de Myfxbook **solo devuelve las últimas 50 transacciones** en `get-history`. La prueba **no** incorpora esas operaciones al historial definitivo ni al Top Trader.
- No existe garantía de que Myfxbook actualice exactamente a las 5:15 p. m. de Nueva York.
- La API documenta sesiones vinculadas a la IP. Si el servicio cambia de IP entre llamadas, las consultas podrían fallar; hay que comprobarlo con una cuenta real.
- Al ser un servicio externo gratuito, la disponibilidad, las condiciones comerciales y límites pueden cambiar.
- La integración existente de MetaApi y todas sus tablas y movimientos continúan intactos.
- No se habilita un cron de Myfxbook hasta terminar la prueba y confirmar autorización de uso.

Referencia: https://www.myfxbook.com/api
