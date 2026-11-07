# Rondas y verificación independiente

Implementación local para revisión, basada en `main` en `d0cbb8b8c47539e3c419727587664d0490cecd0c`. No supone que esta versión esté desplegada ni que el hospital haya aprobado criterios clínicos, responsables o límites. No se envían correos reales por este módulo.

## Uso

1. Abrir **Rondas** desde la navegación compartida. Un jefe/admin configura sede, zona, turno, hora/ventana y desfase UTC; asigna encargado, suplente, verificador y relevo distintos de los ejecutores.
2. Seleccionar puntos del catálogo de 11 grupos, definir criterio aprobado, frecuencia individual, primera fecha y evidencia proporcional. Los puntos inactivos conservan motivo; un punto obligatorio no admite exclusión operativa. El catálogo no asigna frecuencias técnicas universales ni límites clínicos.
3. Publicar la plantilla con motivo y fecha de vigencia. Cada edición crea una versión inmutable. Generar entre 1 y 31 días de obligaciones; el generador usa la versión vigente en cada fecha. Repetir no duplica instancias.

   **Si la plantilla no se guarda:** el catálogo comienza con 21 puntos activos, cada uno con su propio criterio por completar. Completar un criterio no completa los demás. El contador indica cuántos criterios y motivos de exclusión faltan; al guardar se muestra una lista de pendientes con el nombre de cada punto. Seleccionar un pendiente abre su grupo y lleva al campo correspondiente. Desactivar un punto requiere explicar por qué se excluye. El responsable y el validador deben ser personas distintas. Los errores conservan lo escrito en el formulario para corregirlo y volver a intentar; no equivalen a un borrador guardado ni sobreviven a recargar la página.

4. El encargado/suplente revisa y guarda cada punto: Conforme, Hallazgo o No aplica con motivo. No hay respuestas preseleccionadas ni aprobación masiva. Los cambios sin guardar se conservan en la pestaña y se advierte antes de salir.
5. Cuando un punto exige presión: ingresar valor numérico en la unidad configurada. Si exige foto, cargar fotografía real del indicador (JPEG, PNG o WebP, máximo 10 MB). Sin ella no se guarda como revisado. La foto se valida estructuralmente y queda protegida por autenticación; el verificador determina si representa el indicador y sostiene la lectura. No hay OCR ni lectura inventada. Valores fuera de límites configurados por el jefe requieren Hallazgo. No aplica no evita un control de medición/foto obligatorio: queda pendiente para supervisión. No fotografiar pacientes ni información clínica.
6. **Enviar a validación** requiere todos los puntos revisados. El jefe/relevo designado revisa y valida o devuelve con observaciones. Ni el ejecutor ni sus contribuyentes pueden verificar su propio trabajo. Una ronda validada puede conservar acciones abiertas.
7. En la misma vista el jefe revisa solicitudes y **Aprueba y programa** indicando prioridad basada en riesgo, fecha y ejecutor interno o proveedor con coordinador interno. Se crea/vincula la OT de forma transaccional. Ninguna solicitud genera una OT ejecutable antes de esa aprobación.
8. La OT usa el flujo común: ejecución → pendiente de verificación → aprobación independiente y cierre, o devolución. Cerrar la ronda no cierra OTs; su estado se consulta por enlaces vivos sin reescribir la inspección histórica.

## Equipos y preventivo

La ronda lee equipos de su ubicación y descendientes. Por cada plan real muestra frecuencia, última ejecución verificada, evidencia, días transcurridos, próxima obligación calculada y fecha del calendario guardado. Cada actividad del equipo se evalúa separadamente.

- El cumplimiento (`vigente`, `vencido`, `sin_historial`, `sin_config`) se calcula con ejecución verificada y frecuencia vigente, nunca con creación/programación de una OT.
- La gestión (`sin_ot`, `programada`, `en_proceso`, `ejecutada_pendiente_validacion`, `verificada_cerrada`) es un eje separado. Una OT para mañana no vuelve vigente el mantenimiento vencido hoy.
- Un atraso confirmado crea una solicitud trazable obligatoria; la falta de historia es falta de evidencia, no prueba de que nunca se hizo. No convierte un atraso documental en falla física ni decide urgencia por antigüedad sola.
- La primera observación guarda instantánea de equipos, reglas, historial y fecha de consulta. Los cambios posteriores del plan no reescriben la ronda. La aprobación vuelve a comprobar regla/ciclo e impide aprobar una solicitud obsoleta.
- El sistema anterior no guardaba ciclo inmutable por OT. Los posibles vínculos históricos se etiquetan como inferidos; si existe una OT antigua de la actividad, el jefe debe confirmar el vínculo, en vez de duplicarla o atribuirla silenciosamente a otro ciclo.
- Los registros antiguos que solo identifican al asignado se etiquetan `solo_asignacion`; los nuevos tienen ejecutor real y contribuyentes. Un cierre automático antiguo por sí solo no es prueba verificada.

No se cambian las frecuencias ni se reconfiguran calendarios existentes. Crear una OT aprobada actualiza solo el marcador de generación que utiliza el cron existente. La siguiente fecha PM se avanza una vez al cerrar con revisión independiente, desde la fecha real de ejecución. Una devolución/reapertura no repite el avance. Se conserva la convención existente de cálculo de meses en `frecuencias.ts` (incluido su comportamiento de fin de mes), sin inventar otra frecuencia en rondas.

## Persistencia y concurrencia

- `0051_rondas.sql`: entidades nuevas de plantilla/versiones, ejecuciones, propuestas, relaciones OT, evidencia, eventos, notificaciones y cursor de programación. No migra/destruye PM existente.
- `0052_orden_verificacion.sql`: sidecar de verificación y eventos inmutables para OTs. No cambia estados históricos. Protege los adjuntos incluidos en evidencia histórica.
- Guardado de inspección, solicitudes obligatorias y auditoría en una transacción con control de revisión optimista. Ante carrera o fallo, no se conserva medio guardado.
- Aprobación de solicitudes verifica de nuevo regla y existencia de OTs en la transacción. Los reintentos no crean otra OT.
- Reprogramar conserva fecha original, nueva fecha, motivo y autor; los atrasos siguen visibles. Omitir conserva instancia y razón. Las exclusiones no se presentan como ejecución satisfactoria.
- Las fotos y eventos no tienen endpoints de borrado. Los adjuntos de OT que forman evidencia inmutable tampoco se pueden borrar.

## Notificaciones

La plantilla selecciona destinatarios entre usuarios existentes y eventos. Por defecto no hay destinatarios. La API únicamente procesa en **simulación**, sin contacto externo. Hay deduplicación, registro de intentos, estado de error y reintento con demora; mensajes reales exigirían integración de transporte y activación aprobada por separado. La función de transporte inyectable usa clave de idempotencia: cualquier proveedor futuro debe respetarla para evitar duplicación tras una entrega de resultado incierto. Los resúmenes contienen número/estado y enlace autenticado, sin comentarios clínicos ni fotografías adjuntas.

## Programación automática optativa

`POST /api/cron/rondas` usa `x-cron-secret` y requiere `RONDAS_SCHEDULER_ENABLED=true` tanto en Pages como en el Worker programador. Está deshabilitada por defecto. No se ha activado ni desplegado aquí. El Worker conserva su horario PM existente; el programador de rondas se ejecuta en sus disparos diario/horario solo al habilitarlo.

El cursor procesa hasta 31 días por plantilla y llamada. Si hubo interrupción prolongada devuelve `backlog:true`; llamadas siguientes siguen desde el cursor sin borrar obligaciones omitidas. Un responsable inválido produce un pendiente de configuración y no avanza el cursor. Las notificaciones siguen en simulación aun con programador activado.

## Revisión y puesta en marcha segura

1. Confirmar repositorio/rama y commit realmente desplegado. GitHub tiene una rama predeterminada histórica distinta de `main`.
2. Respaldar D1 y R2; validar migraciones en una base de ensayo con copia autorizada, sin usar datos de pacientes en fotos.
3. Instalar dependencias con `npm ci`; usar Node 24 para las pruebas SQLite nativas.
4. Ejecutar `npm test`, `npm run test:rondas`, `npm run typecheck:rondas` y `npm run build`.
5. Aplicar `0051` y `0052` primero en ensayo. Revisar permisos, configuración real de usuarios/proveedores, criterios/unidades/límites y enlaces de fotos con el hospital.
6. Probar la ruta móvil y las OTs con dos identidades distintas; comprobar retorno, reintento, concurrencia y revisión de presión sin foto. No importar datos ficticios de pruebas en producción.
7. Solo después de autorización, publicar la versión revisada, aplicar migraciones de producción y habilitar los componentes deseados. Mantener los correos de rondas simulados hasta aprobar explícitamente la integración y sus destinatarios.

No revertir el despliegue eliminando tablas con historia; si hay incidencia, deshabilitar primero el programador y conservar datos para diagnóstico. La migración no proporciona un borrado destructivo de retorno.

## Límites de la validación local

La prueba DOM opcional se ejecuta con `npm run test:rondas:ui`; `scripts/test-rondas-ui.mjs` explica cómo instalar jsdom en un directorio temporal y señalar su ruta, sin agregarlo a producción.

Las suites ejecutan handlers y consultas reales contra SQLite aislado, con almacenamiento R2 simulado para fotos. La compilación de producción y la comprobación TypeScript de módulos nuevos son verificaciones locales, no una prueba de Cloudflare productivo. La comprobación global `astro check` del repositorio exige `@astrojs/check`, ausente en las dependencias originales; su instalación estuvo bloqueada por el acceso de red a dependencias. El navegador/servidor interactivo también encontró restricciones de sockets/interfaces en este entorno; se reportan aparte las verificaciones DOM, sin afirmar una inspección visual de un teléfono real.
