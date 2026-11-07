# Publicación interna de cortes para SGO

La configuración versionada del Cron Worker habilita la publicación SGO hacia `https://mantenimiento.complejoavante.dev`. Se conserva el horario diario existente (`0 12 * * *`, 06:00 en El Salvador), `APP_URL`, `CRON_SECRET` y la generación de preventivos. El horario adicional `5 * * * *` se dedica exclusivamente a publicar cortes SGO. No contiene credenciales; requiere el secret dedicado y que la API de Mantenimiento esté habilitada.

El Worker discrimina `event.cron`: el horario diario ejecuta los preventivos y, si `SGO_INTEGRATION_ENABLED` es exactamente `true`, una publicación de corte. El horario adicional ejecuta únicamente una publicación cuando esa bandera está activa; nunca genera preventivos. Los eventos con otros horarios no ejecutan trabajos. El endpoint manual `/run` continúa ejecutando únicamente preventivos.

| Variable del Cron Worker | Condición |
| --- | --- |
| `SGO_INTEGRATION_ENABLED` | Configurada como `true` en producción. Ausente u otro valor desactiva el trabajo adicional. |
| `SGO_API_ORIGIN` | Origen HTTPS de Mantenimiento, sin credenciales, puerto no estándar, ruta, consulta ni fragmento. Es independiente de `APP_URL`. |
| `SGO_PUBLISH_SECRET` | Secret dedicado de 32–4096 caracteres, compartido con el publicador de Mantenimiento. No reutiliza `CRON_SECRET` ni credenciales del consumidor SGO. |

El trabajo envía `POST /api/cron/sgo-snapshot` con `X-SGO-Publish-Secret`, `Content-Type: application/json` y `Origin` derivado del origen canónico configurado. Esto permite la publicación a través de la protección de origen de Astro, sin desactivarla. No admite parámetros del usuario, no sigue redirecciones, tiene un límite total de diez segundos y acepta hasta 4096 bytes de respuesta. Exige una confirmación JSON válida con `ok: true` y `snapshot_id`; errores de transporte, respuestas HTTP fallidas o confirmaciones inválidas producen un fallo del trabajo, con un código saneado. No registra el cuerpo remoto, la URL ni secretos, y no reintenta dentro del mismo evento.

Mantenimiento exige, por separado, su propio `SGO_INTEGRATION_ENABLED=true`, el mismo secret de publicación y la configuración interna de `sgo_instance`: `enabled=1` y una vigencia de corte explícita (`snapshot_ttl_seconds`). La cobertura continúa desconocida hasta su conciliación. El publicador no cambia esos valores ni acredita cobertura automáticamente.

Esta ruta interna escribe el corte en Mantenimiento. El consumidor de SGO conserva exclusivamente sus seis rutas GET privadas y nunca ejecuta la publicación. La frecuencia es horaria; los secretos y la vigencia del corte se administran por separado. Las variables públicas quedan versionadas para conservar la activación en futuros despliegues del Worker.

Prueba local sin conexiones externas:

```sh
node --test scripts/test-sgo-publisher-cron.mjs
```

La prueba compila el Worker real con esbuild y comprueba los horarios diario y horario, bandera desactivada, credenciales separadas, origen, método, aislamiento de `/run`, redirecciones, errores, respuestas sobredimensionadas y vencimiento de solicitudes o streams bloqueados.
