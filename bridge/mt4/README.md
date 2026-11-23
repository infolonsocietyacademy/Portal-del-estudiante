# OLFX Bridge: soporte MT4, versión 1.0.40

Amplía el bridge existente con detección y administración limitada de archivos
de MT4. Conserva los 38 archivos del runtime firmado 1.0.39, con cambios en
bridge_agent.py y la adición de mt4_manager.py. MT5 y OLFX Lab conservan su
configuración. El supervisor instalado recibe el runtime por el canal firmado.

## Acciones

Todas llevan `id`, `action` y `expires_at`, con los mismos controles de
caducidad, resultados persistentes y deduplicación del bridge.

| Acción | Campos adicionales | Resultado |
| --- | --- | --- |
| mt4_discover | ninguno | Candidatos de MT4 con ID opaco, etiqueta y proceso detectado |
| mt4_attach | candidate_id | Vincula una carpeta descubierta |
| mt4_status | ninguno | Inventario de Experts EX4 y Presets SET, con hashes |
| mt4_read_preset | filename | Lee parámetros; omite campos privados |
| mt4_edit_preset | filename, expected_sha256, changes | Edita parámetros existentes y conserva respaldo |
| mt4_install_file | filename, source_path, source_ref, source_sha256, expected_sha256 | Copia EX4 o SET desde un commit y hash verificados |

`source_path` debe estar en `bridge/mt4/assets/`, con el mismo tipo de extensión
que el destino. `source_ref` es un SHA completo de commit. `expected_sha256`
debe coincidir con el archivo anterior; `null` solo permite crear uno nuevo.

La detección usa `%APPDATA%/MetaQuotes/Terminal/*/origin.txt`, carpetas estándar
y rutas de procesos `terminal.exe`. Solo acepta carpetas con MQL4 y terminal.exe;
excluye MT5. Distingue `/portable` de la carpeta AppData. No cambia el equipo al
que está conectado el bridge: si MT4 está en otro ordenador se necesita un
bridge en ese ordenador.

Los destinos se limitan a MQL4/Experts y MQL4/Presets de la carpeta vinculada.
Rechaza rutas remotas recibidas como parámetros, traversal, symlinks, junctions,
comandos libres y cambios de credenciales. No publica rutas, cuentas, bases de
contraseñas, argumentos de procesos ni logs. Respalda las sustituciones en
`mt4-management/backups/<backup_id>/` dentro de los datos locales del bridge.

Guardar un SET no actualiza los inputs de un EA ya cargado: requiere volver a
cargarlo desde sus propiedades en MT4. La respuesta declara expresamente
`loaded_in_chart_verified: false`. El bridge no inicia MT4, cambia AutoTrading,
habilita DLL, abre/cierra operaciones ni altera el código compilado del EX4.

## Validación

`python -m unittest discover -s bridge/mt4/tests -v`

29 pruebas sobre descubrimiento, portable, exclusión de MT5, cola y deduplicación,
caducidad, rutas, credenciales, hashes, respaldo, conservación del encoding y
regresión de OLFX Lab. La publicación se verifica con el launcher instalado y
su clave pública; el canal apunta a un commit inmutable de la release firmada.

Referencias oficiales de MetaQuotes:

- https://www.metatrader4.com/en/trading-platform/help/userguide/start_comm
- https://www.metatrader4.com/en/trading-platform/help/service/start_conf_file
