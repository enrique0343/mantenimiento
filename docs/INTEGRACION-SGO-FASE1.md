# Conector privado SGO — fase 1 local

Estado: implementación local, desactivada por defecto, sin despliegue ni migración productiva. Contrato [RC1](INTEGRACION-SGO-KPI.openapi.json).

## Componentes

- `migrations/0050_sgo_integration.sql`: UUID lógico de instancia, proyección mínima de activos/órdenes, revisiones y journal por pareja sede/rubro. Incluye traslados, eliminaciones y cambios indirectos. No cambia usuarios ni sus roles.
- `src/lib/integraciones/sgo/store.mjs`: normalización y cortes materializados inmutables. Ningún GET publica o escribe.
- `src/lib/sgo/`: autenticación Cloudflare Access de servicio, allowlist por pareja, cursores firmados, cinco KPI correctivos y evidencia.
- `/api/integraciones/sgo/v1/{meta,references,records,changes,kpis}` y `/kpis/{calculation_id}/evidence`: únicamente GET. DTO sin narrativas, personas, series, clínica, costos ni adjuntos.
- `/api/cron/sgo-snapshot`: POST interno con secreto exclusivo. [Cron opcional](../cron-worker/README-SGO.md), apagado por defecto y sin cambiar el horario existente.

## Configuración pendiente

No hay secretos ni grants productivos preconfigurados. API: `SGO_INTEGRATION_ENABLED`, `SGO_ACCESS_ISSUER`, `SGO_ACCESS_AUD`, `SGO_API_ORIGIN`, `SGO_SERVICE_PRINCIPALS_JSON`, `SGO_CURSOR_SECRET`, `SGO_PUBLISH_SECRET`. Base: `sgo_instance.enabled=1` y `snapshot_ttl_seconds` explícito. La cobertura por pareja empieza en `unknown`; conciliar antes de marcarla completa.

La lista de principales es un array de objetos con `principal_id`, `common_name` del service token, `grant_version`, `valid_from`, `valid_until` y `scopes` con `site_id`, `maintenance_area_id`, `valid_from`, `valid_until`. Cada fecha es UTC. La API comprueba JWT RS256 del issuer/audiencia configurados, identidad de servicio y vigencias en cada solicitud; una cookie humana nunca autoriza la integración. Configurar secretos exclusivamente en el gestor del entorno. Proteger y probar los dominios alternativos antes de habilitar.

Las cabeceras `CF-Access-Client-Id` y `CF-Access-Client-Secret` son credenciales para el borde de Cloudflare Access. En la comprobación real de la conexión se observó Access autorizado y el JWT presente en origen, con ambas cabeceras de credenciales retiradas. Por ello, el origen autentica exclusivamente el JWT firmado de `Cf-Access-Jwt-Assertion` y resuelve `common_name` contra los principales y ámbitos permitidos. Si llega una cabecera Client ID, debe coincidir con el JWT; nunca lo sustituye. Se conservan los límites de tamaño y el rechazo de tokens humanos, firma/issuer/audiencia incorrectos, vigencias vencidas y servicios no autorizados.

`SGO_AUTH_DIAGNOSTICS_ENABLED='true'` habilita temporalmente registros de rechazos con categorías cerradas y booleanos; no registra tokens, credenciales, identidades ni valores de cabeceras. Está desactivado por defecto y debe retirarse o fijarse en `false` al concluir el diagnóstico.

RC1 calcula de forma determinista en memoria sobre un corte inmutable. `calculation_id` firmado está separado del ID de entidad; `calculated_at` es hora de consulta. Los GET solo hacen SELECT y no invocan motores legacy. SGO conserva las generaciones; `supersedes_calculation_id` es nulo en origen.

## Calidad y límites

MNT-01 registrados, MNT-02 abierta, MNT-03 pendientes, MNT-06 antigüedad media y MNT-11 horas transcurridas de resolución. No son horas trabajadas, SLA, MTTR ni disponibilidad. Sin cobertura suficiente el valor es nulo; un promedio sin casos es nulo. Las fechas civiles de vencimiento no se convierten en horas inventadas. Los filtros de período usan America/El_Salvador.

La migración no acredita historia previa al journal. Las actualizaciones iniciales desconocidas quedan nulas. Sólo cambios de campos exportables generan una revisión. La caducidad de un corte no elimina datos: no hay purga automática de journal/cortes. La política de retención, carga y reconciliación se define antes del uso prolongado. Los límites técnicos producen error explícito, nunca una sincronización incompleta presentada como completa.

## Validación

`npm test` incluye suites existentes, `test-sgo-store.mjs`, `test-sgo-api.mjs` y `test-sgo-publisher-cron.mjs`. `npm run build` valida los wrappers Astro. Todas las pruebas son locales, con datos ficticios, claves efímeras y efectos externos interceptados. Para publicar se requiere una etapa posterior autorizada, respaldo, migraciones aditivas, configuración de Access/secretos/ámbitos y conciliación de resultados.
