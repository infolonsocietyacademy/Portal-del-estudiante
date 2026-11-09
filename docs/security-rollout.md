# OLFX Security Center

El portal sigue usando Supabase Auth para autenticar y PostgreSQL para autorizar. El centro se descarga al abrir su sección. El código de inicio de sesión carga solo el componente de MFA cuando una cuenta lo necesita.

## Revisión previa al despliegue

1. Verificar la configuración de Auth y probar en un entorno aislado con dos estudiantes y un administrador. Revisar `tests/security-rls.sql` y comprobar los flujos de facturación, rebates, clases, perfiles y ranking con sesiones reales del entorno.
2. Confirmar una copia restaurable de la base de datos, el esquema vigente y las configuraciones de Auth y Edge Functions. Verificar el proceso de restauración con el plan de Supabase del proyecto. Mantener la copia fuera del repositorio y cifrada. Los archivos de Storage requieren su propia estrategia de copia.
3. Confirmar SMTP de Auth y los redireccionamientos permitidos para las URL exactas del portal `recuperar.html?mode=invite` y `recuperar.html?mode=update`. Configurar las plantillas de `supabase/email-templates/` y verificar ambos enlaces. Comprobar el mínimo de 12 caracteres, la opción de cambio de contraseña con verificación de la contraseña actual si la versión de Auth la ofrece, y el cambio seguro de correo. Activar la protección de contraseñas filtradas si el plan la admite.
4. Verificar que la opción TOTP esté habilitada y que permita dos factores verificados. Identificar a la persona que administra el proyecto de Supabase y comprobar su acceso antes de exigir MFA en el portal.
5. Coordinar la publicación de la interfaz, el SQL y las funciones. Publicar primero la interfaz aprobada para que el administrador pueda completar su inscripción. La interfaz incluye compatibilidad temporal de lectura con la versión anterior del ranking. Mientras se completa la publicación, las acciones nuevas mostrarán indisponibilidad si el servicio asociado todavía no está publicado.
6. Aplicar únicamente la migración de seguridad revisada. El historial de migraciones del repositorio debe cotejarse con el del proyecto antes de ejecutar un despliegue masivo. Desplegar `registration-gateway` con la validación de JWT desactivada en el gateway para mantener la solicitud pública. Las acciones administrativas se autentican y autorizan dentro de la función. Conservar la configuración de gateway y los secretos de `portal-notifications` y configurar `OLON_PORTAL_URL` si se usa otro dominio.
7. En **Seguridad de mi cuenta**, registrar y comprobar el autenticador principal y un segundo autenticador en un dispositivo independiente. Probar el inicio de sesión con cada uno. Abrir **OLFX SECURITY CENTER** y activar MFA obligatorio cuando todos los administradores activos tengan ambos factores.
8. Verificar que una sesión administrativa AAL1 no pueda consultar el directorio completo, facturas o rebates ni ejecutar acciones privilegiadas. Verificar el acceso habitual de un estudiante sin MFA y de otro con MFA. Repetir con una sesión revocada.

## Recuperación

- Un estudiante que olvida su contraseña solicita un enlace que llega al correo de su cuenta. Si ya registró TOTP, Supabase también exige verificarlo para guardar una contraseña nueva.
- Un administrador que pierde su autenticador principal utiliza el segundo. Si pierde ambos, escalar a la persona propietaria del proyecto de Supabase por un canal verificado previamente. Confirmar la identidad fuera del portal y documentar la aprobación. Usar la gestión oficial de factores de Supabase con acceso autorizado, revocar las sesiones previas y hacer que el titular registre dos factores nuevos. Mantener el requisito global de MFA. Si Auth no permite un restablecimiento seguro en la configuración activa, usar una cuenta administradora de recuperación previamente verificada o escalar a soporte de Supabase. Ensayar este procedimiento antes de activar el requisito global.
- Las suspensiones del centro afectan el acceso al portal y eliminan sus sesiones existentes de Auth. La reactivación requiere iniciar sesión de nuevo. Las URL de archivos ya firmadas pueden seguir utilizables hasta que venza su firma.

## Alcance de la telemetría

Las sesiones se calculan a partir de los registros vigentes de Auth y no representan presencia en línea. La lista privada usa el agente de navegador registrado por el proveedor y no muestra ubicación o IP. El centro muestra el estado del MFA y registra actividad de seguridad nueva sin guardar contraseñas, códigos, tokens ni el contenido de las operaciones.

El historial del portal muestra los avisos de cambios de seguridad al abrir la sección. Las alertas por correo para cambios de contraseña, correo o factores requieren habilitar las notificaciones correspondientes de Supabase Auth y probar su entrega. El contador de intentos fallidos se mantiene como no disponible hasta configurar una fuente autorizada de registros de Auth. Revisar el volumen y la retención de la auditoría antes de ampliar el acceso al portal.

La aplicación actual es estática y usa el almacenamiento de sesión del SDK en el navegador. Migrar a cookies HTTP-only requiere un backend de sesión y queda fuera de este cambio.
