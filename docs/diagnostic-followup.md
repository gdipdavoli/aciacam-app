# Seguimiento del diagnóstico — 19 septiembre 2026

## Correcciones críticas

- Las rutas administrativas de socios e invitaciones verifican identidad contra Auth y permisos contra datos confiables. `user_metadata` no concede permisos.
- La consulta por usuario permite la ficha propia o acceso de staff/admin. Las consultas de fichas no se cachean.
- El envío de constancias recibe únicamente un identificador, consulta cierre y destinatario guardados, escapa HTML y rechaza cierres anulados. Sin proveedor devuelve 503, nunca éxito simulado.
- La función de confirmación de pagos exige un operador autenticado, respeta RLS y toma el autor real de la sesión. Repetir la misma confirmación (pedido, estado y lote de pagos idénticos) devuelve éxito sin insertar pagos nuevamente. Los aportes adicionales se registran como operaciones distintas. No se conciliaron posibles duplicados históricos.
- El stock se ajusta por diferencia neta, valida cantidades positivas, agrupa productos repetidos y bloquea productos en orden estable durante la operación. No se repite el backfill de la migración 49.
- Regla confirmada por el usuario: cancelar devuelve stock, incluso después de entregar; una segunda cancelación no vuelve a devolverlo.
- Se impide que un socio se cambie rol, identidad vinculada o bloqueo mediante su permiso de editar ficha propia.
- Se eliminaron las políticas públicas permisivas de invitaciones. Anónimos no pueden leer tokens ni modificar invitaciones. Las vistas de socios/documentación respetan RLS; la vista de enlaces queda reservada al servidor.

Las cuatro migraciones críticas de `supabase/migrations` se aplicaron y verificaron en el proyecto existente. No ejecutarlas junto con migraciones históricas como si estas fueran una instalación nueva. La CLI y el servidor pueden asignar distintos timestamps; conciliar por nombre antes de automatizar `db push`.

## Evidencia y límites

- `node --test scripts/test_diagnostic_routes.cjs scripts/test_invitation_auth.cjs`: 20 pruebas offline (rutas e invitaciones).
- `node scripts/test_diagnostic_db.cjs`: 22 comprobaciones sobre PostgreSQL aislado con datos ficticios. Instalar `@electric-sql/pglite@0.3.14` en `../diagnostic-validation`, o indicar su ubicación con `PGLITE_MODULE`.
- TypeScript y compilación de producción aprobados usando valores de configuración ficticios; no se usaron secretos de producción para compilar.
- Verificación productiva: permisos anónimos de pagos/invitaciones deshabilitados; función de pagos sin bypass RLS; dos triggers de stock nuevos; tres vistas con `security_invoker=true`.
- Las pruebas aisladas no simulan múltiples conexiones PostgreSQL concurrentes. La protección concurrente usa bloqueos de filas y actualización condicionada; falta prueba de carga con sesiones independientes en staging.
- No se enviaron correos reales ni se crearon pedidos, pagos o socios de prueba en producción.
- No se investigó explotación histórica de los accesos expuestos; no se afirma que haya ocurrido.
- El asesor de Supabase ya no reporta las tres vistas con bypass RLS. Persisten advertencias en funciones heredadas y tablas del agente fuera del circuito corregido. [Asesor de seguridad](https://supabase.com/docs/guides/database/database-linter).

## Estado de publicación

Correcciones críticas publicadas en main hasta 4b1f931. Vercel confirmó despliegue exitoso. También se corrigieron carga y aprobación de documentos sin autenticación, autenticación de URLs firmadas y políticas que permitían atribuirse documentos ajenos o aprobar los propios.

## Mejoras implementadas en improve/diagnostic-staging

- Ingreso: una consulta autenticada de perfil con cancelación a los 15 segundos; solo un 404 significa ficha inexistente. La documentación se carga en la pantalla de cuenta, sin bloquear la identificación.
- Cierres: el servidor de base de datos construye el contenido y SHA-256; auditoría en la misma transacción; permisos por rol; solo se permite anulación con motivo. Los límites del mes usan Buenos Aires y un extremo final exclusivo. Se conserva el criterio previo de pedidos entregados/retirados según fecha de creación, no una nueva fecha de entrega.
- REPROCANN: aprobación con archivo y fechas completos; fechas de documento y ficha actualizadas juntas; reemplazos guardan la versión anterior, consultable desde el editor. La aprobación requiere confirmación explícita del operador. No se reconstruye historial anterior a esta migración. El extractor externo no se modificó ni se verificó: la revisión manual funciona con los campos existentes.
- PWA: únicamente assets versionados usan caché; páginas, API y documentos requieren red. Al activar el nuevo worker se eliminan las cachés privadas de la política anterior.
- Auditoría genérica: se registra el error devuelto por Supabase; las operaciones heredadas distintas de cierres y confirmación de pagos todavía no tienen auditoría transaccional.

La migración diagnostic_staging_workflows **no está aplicada en producción**. No fusionar esta rama hasta completar la revisión de los circuitos autenticados.

## Entorno de prueba y evidencia

Base PostgreSQL PGlite local descartable con registros ficticios, sin conexión a producción. Ejecutar desde la raíz del repositorio en PowerShell:

```powershell
$env:RUN_STAGING_TESTS='1'
node scripts/test_diagnostic_db.cjs
node --test scripts/test_linked_profile.cjs scripts/test_diagnostic_routes.cjs scripts/test_invitation_auth.cjs
```

Resultado: 30 comprobaciones de base de datos y 22 pruebas de rutas/sesiones/perfil. Se verificaron rollback cuando falla auditoría, rechazo de constancia adulterada, límites mensuales, permisos y conservación del certificado anterior. TypeScript y build aprobados con valores ficticios.

Revisión en Chrome local: ingreso en escritorio y a 390×844; campos visibles, sin errores reportados y navegación a recuperación de contraseña correcta. No representa una prueba completa con Auth/Storage/Resend reales ni una prueba concurrente de varias sesiones PostgreSQL.

El script prebuild impide desplegar Vercel Preview con el proyecto productivo: requiere ACIACAM_PREVIEW_SUPABASE_REF y URLs del proyecto separado. No se creó un proyecto Supabase pago ni se copiaron datos productivos. Un enlace automático de Vercel no constituye todavía un entorno de pruebas autenticado.

Para la validación completa: provisionar Supabase de prueba, cargar esquema base y estas migraciones conciliando historial, configurar sus claves únicamente en Preview, crear socio/operador ficticios y probar invitación, constancia, reemplazo/aprobación de REPROCANN y cancelación concurrente. El correo de pruebas debe ir a un buzón de prueba o proveedor sandbox. Esta validación queda pendiente antes de pasar las mejoras a main.
