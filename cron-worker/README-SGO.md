# Publicación interna de cortes para SGO

La integración viene desactivada. Se conserva el horario diario existente (`0 12 * * *`, 06:00 en El Salvador), `APP_URL`, `CRON_SECRET` y la generación de preventivos. El horario adicional `5 * * * *` se dedica exclusivamente a publicar cortes SGO. No contiene credenciales ni activa por sí solo la integración.

El Worker discrimina `event.cron`: el horario diario ejecuta los preventivos y, si `SGO_INTEGRATION_ENABLED` es exactamente `true`, una publicación de corte. El horario adicional ejecuta únicamente una publicación cuando esa bandera está activa; nunca genera preventivos. Los eventos con otros horarios no ejecutan trabajos. El endpoint manual `/run` continúa ejecutando únicamente preventivos.

| Variable del Cron Worker | Condición |
| --- | --- |
| `SGO_INTEGRATION_ENABLED` | Ausente por defecto. Únicamente la cadena `true` activa el trabajo adicional. |
| `SGO_API_ORIGIN` | Origen HTTPS de Mantenimiento, sin credenciales, puerto no estándar, ruta, consulta ni fragmento. Es independiente de `APP_URL`. |
| `SGO_PUBLISH_SECRET` | Secret dedicado de 32–4096 caracteres, compartido con el publicador de Mantenimiento. No reutiliza `CRON_SECRET` ni credenciales del consumidor SGO. |

El trabajo envía `POST /api/cron/sgo-snapshot` con la cabecera `X-SGO-Publish-Secret`. No admite parámetros del usuario, no sigue redirecciones, tiene un límite total de diez segundos y acepta hasta 4096 bytes de respuesta. Exige una confirmación JSON válida con `ok: true` y `snapshot_id`; errores de transporte, respuestas HTTP fallidas o confirmaciones inválidas producen un fallo del trabajo, con un código saneado. No registra el cuerpo remoto, la URL ni secretos, y no reintenta dentro del mismo evento.

Mantenimiento exige, por separado, su propio `SGO_INTEGRATION_ENABLED=true`, el mismo secret de publicación y la configuración interna de `sgo_instance`: `enabled=1` y una vigencia de corte explícita (`snapshot_ttl_seconds`). La cobertura continúa desconocida hasta su conciliación. El publicador no cambia esos valores ni acredita cobertura automáticamente.

Esta ruta interna escribe el corte en Mantenimiento. El consumidor de SGO conserva exclusivamente sus seis rutas GET privadas y nunca ejecuta la publicación. La frecuencia preparada es horaria; la activación, vigencia y publicación se realizan en el despliegue coordinado. Este archivo no configura secretos ni activa entornos.

Prueba local sin conexiones externas:

```sh
node --test scripts/test-sgo-publisher-cron.mjs
```

La prueba compila el Worker real con esbuild y comprueba los horarios diario y horario, bandera desactivada, credenciales separadas, origen, método, aislamiento de `/run`, redirecciones, errores, respuestas sobredimensionadas y vencimiento de solicitudes o streams bloqueados.
