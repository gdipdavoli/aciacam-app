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

Las tres migraciones de `supabase/migrations` se aplicaron y verificaron en el proyecto existente. No ejecutarlas junto con migraciones históricas como si estas fueran una instalación nueva. La CLI y el servidor pueden asignar distintos timestamps; conciliar por nombre antes de automatizar `db push`.

## Evidencia y límites

- `node --test scripts/test_diagnostic_routes.cjs scripts/test_invitation_auth.cjs`: 17 pruebas offline.
- `node scripts/test_diagnostic_db.cjs`: 19 comprobaciones sobre PostgreSQL aislado con datos ficticios. Instalar `@electric-sql/pglite@0.3.14` en `../diagnostic-validation`, o indicar su ubicación con `PGLITE_MODULE`.
- TypeScript y compilación de producción aprobados usando valores de configuración ficticios; no se usaron secretos de producción para compilar.
- Verificación productiva: permisos anónimos de pagos/invitaciones deshabilitados; función de pagos sin bypass RLS; dos triggers de stock nuevos; tres vistas con `security_invoker=true`.
- Las pruebas aisladas no simulan múltiples conexiones PostgreSQL concurrentes. La protección concurrente usa bloqueos de filas y actualización condicionada; falta prueba de carga con sesiones independientes en staging.
- No se enviaron correos reales ni se crearon pedidos, pagos o socios de prueba en producción.
- No se investigó explotación histórica de los accesos expuestos; no se afirma que haya ocurrido.
- El asesor de Supabase ya no reporta las tres vistas con bypass RLS. Persisten advertencias en funciones heredadas y tablas del agente fuera del circuito corregido. [Asesor de seguridad](https://supabase.com/docs/guides/database/database-linter).

## Mejoras para entorno separado

Ingreso: distinguir error técnico de ficha inexistente y evitar que la documentación retrase la apertura.

Cierres: construir el contenido y hash en servidor y guardar auditoría en la misma transacción. La tabla productiva tiene RLS habilitado sin políticas, por lo que el flujo actual desde el navegador no tiene acceso normal; no se debe interpretar ese error como ausencia de un cierre.

REPROCANN: conservar versiones de documentos, confirmar los datos extraídos antes de actualizar la ficha y unificar la fecha vigente. La extracción está delegada a un servicio de agente externo; su implementación no está en este repositorio.

Móvil: existe PWA. Priorizar caché segura para datos privados y pruebas del recorrido móvil; una app nativa requiere requisitos adicionales y no se implementa como parte de esta corrección.
