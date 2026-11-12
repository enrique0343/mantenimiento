-- Fase 59: equipos biomédicos y evaluación JCI (Gerencia de Operaciones, 12/11/2026).
--
-- Cubre con el sistema lo que toca de los 19 requisitos de calidad para equipos
-- biomédicos: inventario, metrología, expediente, licencias, capacitaciones, alertas,
-- plan anual, seguridad eléctrica e incidentes. Una sola migración para todos los
-- paquetes de la fase.
--
-- Solo agrega: tablas nuevas y columnas nulas o con valor por defecto. No borra, no
-- renombra y no cambia tipos. Producción tiene 0 equipos, 0 calibraciones y 0
-- documentos: no hay datos que mover.
--
--  1. Inventario: catálogo de centros de costo, registro sanitario completo y baja con acta.
--  2. Metrología: equipo patrón, «no requiere calibración» y acreditación del laboratorio.
--  3. Documentos: vencimiento y nota; requisitos del expediente que no aplican.
--  4. Licencias y permisos.
--  5. Capacitaciones al personal.
--  6. Alertas y retiros: aplicabilidad, cierre firme, reapertura y archivos.
--  7. Plan anual: proveedor de la rutina y aprobación con el plan firmado.
--  8. Seguridad eléctrica IEC 62353: registro de pruebas y plantilla con lecturas.
--  9. Incidentes en las órdenes y PDF aprobado de los procedimientos.
--
-- Fechas sin hora en texto 'AAAA-MM-DD'; marcas de tiempo en UTC (CURRENT_TIMESTAMP o ISO con Z).

-- ─── 1. Inventario ───────────────────────────────────────────────────────────

-- Centros de costo: catálogo cerrado que administran admin y jefe. El código se
-- guarda en mayúsculas para que UNIQUE no distinga mayúsculas. Sede opcional.
CREATE TABLE centros_costo (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL,
  sucursal_id integer REFERENCES sucursales(id) ON DELETE SET NULL,
  activo integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text
);
CREATE INDEX idx_centros_costo_sucursal ON centros_costo(sucursal_id);

-- Centro de costo del equipo y registro sanitario completo (antes era solo un número).
ALTER TABLE activos ADD COLUMN centro_costo_id integer REFERENCES centros_costo(id);
ALTER TABLE activos ADD COLUMN registro_sanitario_entidad text;      -- CSSP, SRS, DNM u otra escrita
ALTER TABLE activos ADD COLUMN registro_sanitario_emision text;      -- 'AAAA-MM-DD'
ALTER TABLE activos ADD COLUMN registro_sanitario_vencimiento text;  -- 'AAAA-MM-DD'
ALTER TABLE activos ADD COLUMN registro_sanitario_no_requiere integer NOT NULL DEFAULT 0;
CREATE INDEX idx_activos_centro_costo ON activos(centro_costo_id);
CREATE INDEX idx_activos_estado ON activos(estado);

-- Baja del equipo: motivo, evaluación, quién autoriza y destino final. Una fila por
-- baja; la reversión queda en la misma fila. Sin cascada: con una baja, el equipo
-- no se puede eliminar. Solo una baja vigente por equipo.
CREATE TABLE activo_bajas (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  activo_id integer NOT NULL REFERENCES activos(id),
  estado text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'revertida')),
  fecha_baja text NOT NULL,                       -- 'AAAA-MM-DD'
  motivo text NOT NULL,                           -- clave de MOTIVOS_BAJA
  motivo_detalle text NOT NULL,
  evaluacion_tecnica text NOT NULL,
  evaluado_por text NOT NULL,                     -- nombre y cargo; puede ser de un proveedor
  autoriza_nombre text NOT NULL,                  -- puede ser alguien sin usuario (Dirección)
  autoriza_cargo text NOT NULL,
  destino_final text NOT NULL,                    -- clave de DESTINOS_BAJA
  destino_detalle text,
  empresa_retira text,
  fecha_retiro text,                              -- 'AAAA-MM-DD'
  residuos_baterias text NOT NULL,
  estado_anterior text NOT NULL,                  -- al revertir, el equipo vuelve a este estado
  planes_desactivados text,                       -- JSON con los ids de los planes apagados
  registrado_por integer NOT NULL REFERENCES usuarios(id),
  registrado_por_nombre text NOT NULL,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revertida_en text,                              -- ISO con Z
  revertida_por integer REFERENCES usuarios(id),
  revertida_por_nombre text,
  reversion_motivo text
);
CREATE INDEX idx_activo_bajas_activo ON activo_bajas(activo_id);
CREATE UNIQUE INDEX uq_activo_bajas_vigente ON activo_bajas(activo_id) WHERE estado = 'vigente';

-- ─── 2. Metrología ───────────────────────────────────────────────────────────

-- Equipo patrón (analizadores, simuladores, multímetros) y «no requiere calibración»
-- con su motivo. Solo los escribe la pantalla de Calibraciones.
ALTER TABLE activos ADD COLUMN es_patron integer NOT NULL DEFAULT 0;
ALTER TABLE activos ADD COLUMN calibracion_no_aplica integer NOT NULL DEFAULT 0;
ALTER TABLE activos ADD COLUMN calibracion_no_aplica_motivo text;

-- Cada calibración: patrón elegido de la lista, copia de la acreditación del
-- laboratorio en su fecha (no cambia si el laboratorio renueva o vence) y marca
-- de corrección.
ALTER TABLE calibraciones ADD COLUMN patron_activo_id integer REFERENCES activos(id) ON DELETE SET NULL;
ALTER TABLE calibraciones ADD COLUMN lab_acreditado integer;           -- 1 sí, 0 no, NULL no consta (laboratorio escrito a mano)
ALTER TABLE calibraciones ADD COLUMN lab_acreditacion_ref text;       -- «OSA · N.º LC-012 · vigente hasta 31/01/2027»
ALTER TABLE calibraciones ADD COLUMN corregida_en text;               -- ISO con Z
ALTER TABLE calibraciones ADD COLUMN corregida_por integer REFERENCES usuarios(id);
CREATE INDEX idx_calibraciones_patron_activo ON calibraciones(patron_activo_id);

-- Acreditación completa del laboratorio y su certificado en R2.
ALTER TABLE proveedores ADD COLUMN acreditacion_numero text;
ALTER TABLE proveedores ADD COLUMN acreditacion_alcance text;
ALTER TABLE proveedores ADD COLUMN acreditacion_r2_key text;
ALTER TABLE proveedores ADD COLUMN acreditacion_archivo_nombre text;
ALTER TABLE proveedores ADD COLUMN acreditacion_content_type text;

-- ─── 3. Documentos del equipo y expediente técnico ───────────────────────────

-- Vencimiento opcional (registro sanitario, garantía, licencia) y una nota corta.
-- La versión y la fecha del documento ya existen (0047).
ALTER TABLE activo_documentos ADD COLUMN fecha_vencimiento text;      -- 'AAAA-MM-DD'
ALTER TABLE activo_documentos ADD COLUMN nota text;

-- Requisito del expediente que no aplica a un equipo, con su motivo.
CREATE TABLE activo_expediente_na (
  activo_id integer NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  requisito text NOT NULL,                        -- clave de REQUISITOS_EXPEDIENTE
  motivo text NOT NULL,
  usuario_id integer NOT NULL REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (activo_id, requisito)
);

-- ─── 4. Licencias y permisos ─────────────────────────────────────────────────

-- Del establecimiento, de un servicio, de un equipo o de una persona. Renovar crea
-- otra fila que apunta a la anterior: la historia no se sobrescribe. La sede se
-- pone en NULL si se borra, porque las sedes se borran de verdad.
CREATE TABLE licencias (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  entidad text NOT NULL,                          -- srs | cssp | minsal | otra
  entidad_otra text,
  tipo text NOT NULL,                             -- funcionamiento | radiacion_equipo | radiacion_personal | inscripcion | otro
  nombre text NOT NULL,
  numero text,
  ambito text NOT NULL,                           -- establecimiento | servicio | equipo | persona
  sucursal_id integer REFERENCES sucursales(id) ON DELETE SET NULL,
  servicio text,
  activo_id integer REFERENCES activos(id) ON DELETE SET NULL,
  titular text,
  fecha_emision text,                             -- 'AAAA-MM-DD'
  fecha_vencimiento text,                         -- 'AAAA-MM-DD'; NULL = no vence
  responsable_id integer REFERENCES usuarios(id),
  estado text NOT NULL DEFAULT 'activa',          -- activa | en_tramite | reemplazada | anulada
  reemplaza_a_id integer REFERENCES licencias(id) ON DELETE SET NULL,
  notas text,
  creado_por integer NOT NULL REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text
);
CREATE INDEX idx_licencias_estado_vence ON licencias(estado, fecha_vencimiento);
CREATE INDEX idx_licencias_activo ON licencias(activo_id);
CREATE INDEX idx_licencias_reemplaza ON licencias(reemplaza_a_id);

-- PDF o foto de la licencia, constancia de trámite u otro archivo (R2).
CREATE TABLE licencia_archivos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  licencia_id integer NOT NULL REFERENCES licencias(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  content_type text NOT NULL,                     -- tipo detectado en el servidor
  tamano integer NOT NULL,
  r2_key text NOT NULL,
  categoria text NOT NULL DEFAULT 'licencia',     -- licencia | constancia_tramite | otro
  usuario_id integer NOT NULL REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_licencia_archivos_licencia ON licencia_archivos(licencia_id);

-- ─── 5. Capacitaciones al personal ───────────────────────────────────────────

-- Sesión: fecha, tema, instructor interno o externo, duración, sede, lugar y servicio.
CREATE TABLE capacitaciones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  fecha text NOT NULL,                            -- 'AAAA-MM-DD'
  tema text NOT NULL,
  tipo text NOT NULL DEFAULT 'uso_seguro',        -- induccion | uso_seguro | actualizacion | limpieza_desinfeccion | otro
  instructor_tipo text NOT NULL DEFAULT 'interno',  -- interno | externo
  instructor_nombre text NOT NULL,
  proveedor_id integer REFERENCES proveedores(id),
  instructor_entidad text,
  modelo_cubierto text,
  duracion_minutos integer,
  sucursal_id integer REFERENCES sucursales(id) ON DELETE SET NULL,
  lugar text,
  servicio text,
  notas text,
  usuario_id integer NOT NULL REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text
);
CREATE INDEX idx_capacitaciones_fecha ON capacitaciones(fecha);

-- Equipos que cubre cada capacitación, para que cada ficha muestre las suyas.
CREATE TABLE capacitacion_equipos (
  capacitacion_id integer NOT NULL REFERENCES capacitaciones(id) ON DELETE CASCADE,
  activo_id integer NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  PRIMARY KEY (capacitacion_id, activo_id)
);
CREATE INDEX idx_capacitacion_equipos_activo ON capacitacion_equipos(activo_id);

-- Asistentes escritos a mano: el personal médico y de enfermería no tiene usuario.
CREATE TABLE capacitacion_asistentes (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  capacitacion_id integer NOT NULL REFERENCES capacitaciones(id) ON DELETE CASCADE,
  orden integer NOT NULL DEFAULT 0,
  nombre text NOT NULL,
  cargo text,
  servicio text
);
CREATE INDEX idx_capacitacion_asistentes_cap ON capacitacion_asistentes(capacitacion_id);

-- Lista firmada (puede ser varias fotos), constancias y material (R2).
CREATE TABLE capacitacion_archivos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  capacitacion_id integer NOT NULL REFERENCES capacitaciones(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  content_type text NOT NULL,                     -- tipo detectado en el servidor
  tamano integer NOT NULL,
  r2_key text NOT NULL,
  categoria text NOT NULL DEFAULT 'lista_firmada',  -- lista_firmada | constancia | material | otro
  usuario_id integer NOT NULL REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_capacitacion_archivos_cap ON capacitacion_archivos(capacitacion_id);

-- ─── 6. Alertas y retiros ────────────────────────────────────────────────────

-- Análisis de aplicabilidad (quién, cuándo, qué), fecha de cierre declarada en vez
-- de reescrita en cada guardado, y constancia de la reapertura.
ALTER TABLE alertas_equipo ADD COLUMN aplicabilidad text NOT NULL DEFAULT 'pendiente';  -- pendiente | aplica | no_aplica
ALTER TABLE alertas_equipo ADD COLUMN aplicabilidad_analisis text;
ALTER TABLE alertas_equipo ADD COLUMN aplicabilidad_fecha text;                         -- 'AAAA-MM-DD'
ALTER TABLE alertas_equipo ADD COLUMN aplicabilidad_por integer REFERENCES usuarios(id);
ALTER TABLE alertas_equipo ADD COLUMN fecha_cierre text;                                -- 'AAAA-MM-DD' declarada al cerrar
ALTER TABLE alertas_equipo ADD COLUMN reabierta_en text;                                -- ISO de la última reapertura
ALTER TABLE alertas_equipo ADD COLUMN reabierta_por integer REFERENCES usuarios(id);
ALTER TABLE alertas_equipo ADD COLUMN motivo_reapertura text;
ALTER TABLE alertas_equipo ADD COLUMN veces_reabierta integer NOT NULL DEFAULT 0;
ALTER TABLE alertas_equipo ADD COLUMN updated_at text;

-- Boletín del fabricante, evaluación y evidencia de la acción, aunque la alerta no
-- afecte a ningún equipo.
CREATE TABLE alerta_adjuntos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  alerta_id integer NOT NULL REFERENCES alertas_equipo(id) ON DELETE CASCADE,
  categoria text NOT NULL DEFAULT 'boletin',      -- boletin | evaluacion | evidencia | otro
  nombre text NOT NULL,
  content_type text NOT NULL,                     -- tipo detectado en el servidor
  tamano integer NOT NULL,
  r2_key text NOT NULL,
  usuario_id integer NOT NULL REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_alerta_adjuntos_alerta ON alerta_adjuntos(alerta_id);

-- La ficha, la hoja de vida y el historial buscan las alertas por equipo; el UNIQUE
-- existente (0045) empieza por alerta_id y no sirve para eso.
CREATE INDEX idx_alertas_equipo_activos_activo ON alertas_equipo_activos(activo_id);

-- ─── 7. Plan anual ───────────────────────────────────────────────────────────

-- El plan impreso nombra al proveedor de cada servicio externo aunque no haya contrato.
ALTER TABLE planes_mantenimiento ADD COLUMN proveedor_id integer REFERENCES proveedores(id);

-- Aprobación del plan por año y área con el PDF firmado. No se edita ni se borra:
-- se anula con motivo. Vigente = la última no anulada del año y área.
CREATE TABLE plan_aprobaciones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  anio integer NOT NULL,
  area text NOT NULL,                             -- general | aires | infraestructura | equipo_general | biomedico
  version text NOT NULL,
  aprobado_por text NOT NULL,                     -- nombre y cargo de quien firmó
  fecha_aprobacion text NOT NULL,                 -- 'AAAA-MM-DD'
  notas text,
  nombre_archivo text NOT NULL,
  content_type text NOT NULL,                     -- tipo detectado en el servidor
  tamano integer NOT NULL,
  r2_key text NOT NULL,
  registrado_por integer NOT NULL REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anulada_en text,                                -- ISO con Z
  anulada_por integer REFERENCES usuarios(id),
  motivo_anulacion text
);
CREATE INDEX idx_plan_aprobaciones_anio_area ON plan_aprobaciones(anio, area);

-- ─── 8. Seguridad eléctrica (IEC 62353) ──────────────────────────────────────

-- Cada prueba guarda lo medido junto al límite con que se juzgó (lo calcula el
-- servidor), el resultado calculado y el confirmado, el analizador con su serie y
-- vencimiento, y el informe. No se edita: una prueba mal registrada se anula y se
-- registra otra. Sin cascada al equipo, para no perder evidencia; la orden y el
-- analizador quedan en NULL si se borran.
CREATE TABLE pruebas_seguridad_electrica (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  activo_id integer NOT NULL REFERENCES activos(id),
  fecha text NOT NULL,                                     -- 'AAAA-MM-DD'
  tipo text NOT NULL CHECK (tipo IN ('aceptacion', 'periodica', 'post_reparacion')),
  orden_id integer REFERENCES ordenes(id) ON DELETE SET NULL,
  clase_proteccion text NOT NULL CHECK (clase_proteccion IN ('I', 'II', 'interna')),
  parte_aplicada text NOT NULL DEFAULT 'ninguna' CHECK (parte_aplicada IN ('ninguna', 'B', 'BF', 'CF')),
  metodo_fuga text NOT NULL DEFAULT 'directo' CHECK (metodo_fuga IN ('directo', 'alternativo')),
  inspeccion_visual text NOT NULL CHECK (inspeccion_visual IN ('conforme', 'no_conforme')),
  prueba_funcional text NOT NULL CHECK (prueba_funcional IN ('conforme', 'no_conforme')),
  tierra_ohm real,
  limite_tierra_ohm real,                                  -- máximo; NULL = no aplica
  aislamiento_mohm real,
  limite_aislamiento_mohm real,                            -- mínimo
  fuga_equipo_ua real,
  limite_fuga_equipo_ua real,
  fuga_parte_ua real,
  limite_fuga_parte_ua real,
  resultado_calculado text NOT NULL CHECK (resultado_calculado IN ('pasa', 'no_pasa')),
  resultado text NOT NULL CHECK (resultado IN ('pasa', 'no_pasa')),
  motivo_resultado text,
  analizador_activo_id integer REFERENCES activos(id) ON DELETE SET NULL,
  analizador_descripcion text NOT NULL,
  analizador_serie text NOT NULL,
  analizador_cal_vence text NOT NULL,                      -- 'AAAA-MM-DD'
  realizado_por text NOT NULL,
  realizado_por_id integer REFERENCES usuarios(id),
  empresa_externa text,
  proxima_fecha text NOT NULL,                             -- 'AAAA-MM-DD'
  informe_r2_key text,
  informe_nombre text,
  informe_tipo text,
  informe_tamano integer,
  notas text,
  estado text NOT NULL DEFAULT 'valida' CHECK (estado IN ('valida', 'anulada')),
  anulada_por integer REFERENCES usuarios(id),
  anulada_en text,                                         -- ISO con Z
  motivo_anulacion text,
  registrado_por integer NOT NULL REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_pruebas_seg_elec_activo ON pruebas_seguridad_electrica(activo_id, estado, fecha);
CREATE INDEX idx_pruebas_seg_elec_orden ON pruebas_seguridad_electrica(orden_id);

-- La plantilla «Seguridad eléctrica IEC 62353» de la 0046 se creó en producción y
-- después se borró. Se vuelve a sembrar sin duplicar: la plantilla por nombre y los
-- pasos por (plantilla, orden), con los mismos textos de la 0046. Los pasos 3 a 6
-- piden lectura (Ω, MΩ, µA, µA); solo la tierra lleva rango, porque los demás
-- límites dependen de la clase. Solo los pasos 1 y 7 son críticos: en el celular un
-- paso crítico no ofrece «No aplica». Las marcas de inicio y fin las usa la prueba
-- de idempotencia: no se cambian.
-- WP-F siembra: inicio
INSERT INTO checklist_plantillas (nombre, descripcion, activa, tipo_documento)
SELECT 'Seguridad eléctrica IEC 62353',
  'Prueba de seguridad eléctrica del equipo biomédico (referencia IEC 62353): al recibirlo, cada año y después de una reparación. Las lecturas se anotan en la orden; el resultado, con los límites de su clase, se registra en «Seguridad eléctrica» del equipo.',
  1, 'sop'
WHERE NOT EXISTS (SELECT 1 FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353');

WITH t AS (SELECT MIN(id) AS id FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353'),
v(orden, texto, criterio, bloqueante, minutos, requiere, unidad, vmax) AS (VALUES
  (1, 'Inspección visual: carcasa, cable de alimentación, conectores y accesorios sin daños', 'Sin fisuras, cables pelados ni conectores flojos', 1, 5, 0, NULL, NULL),
  (2, 'Verificar fusibles y protecciones según placa del fabricante', 'Valores según placa', 0, 5, 0, NULL, NULL),
  (3, 'Medir resistencia de tierra de protección', '≤ 0.3 Ω medido con el cable de alimentación (Clase I). Clase II o batería: No aplica.', 0, 10, 1, 'Ω', 0.3),
  (4, 'Medir resistencia de aislamiento', 'Clase I ≥ 2 MΩ · Clase II ≥ 7 MΩ. Si no se midió: No aplica.', 0, 10, 1, 'MΩ', NULL),
  (5, 'Medir corriente de fuga del equipo', 'Directo o diferencial: Clase I ≤ 500 µA · Clase II ≤ 100 µA (alternativo: 1000 / 500 µA). Batería: No aplica.', 0, 10, 1, 'µA', NULL),
  (6, 'Medir corriente de fuga de partes aplicadas (si aplica)', 'BF ≤ 5000 µA · CF ≤ 50 µA. Tipo B o sin parte aplicada: No aplica.', 0, 10, 1, 'µA', NULL),
  (7, 'Prueba funcional del equipo posterior a las mediciones', 'Funciones principales operativas', 1, 10, 0, NULL, NULL),
  (8, 'Registrar valores medidos y etiquetar el equipo con fecha de prueba y próxima', 'Prueba registrada en «Seguridad eléctrica» del equipo, con su informe, y etiqueta colocada', 0, 5, 0, NULL, NULL))
INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, requiere_valor, unidad, valor_esperado_max, orden)
SELECT t.id, v.texto, v.criterio, v.bloqueante, v.minutos, v.requiere, v.unidad, v.vmax, v.orden
FROM t, v
WHERE t.id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM checklist_plantilla_items x WHERE x.plantilla_id = t.id AND x.orden = v.orden);

-- Bases que conservan la plantilla de la 0046 (pruebas locales): completar sin duplicar.
UPDATE checklist_plantilla_items SET requiere_valor = 1, unidad = 'Ω', valor_esperado_max = 0.3, bloqueante = 0,
  criterio_aceptacion = '≤ 0.3 Ω medido con el cable de alimentación (Clase I). Clase II o batería: No aplica.'
WHERE plantilla_id = (SELECT MIN(id) FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353')
  AND orden = 3 AND texto = 'Medir resistencia de tierra de protección' AND requiere_valor = 0;
UPDATE checklist_plantilla_items SET requiere_valor = 1, unidad = 'MΩ',
  criterio_aceptacion = 'Clase I ≥ 2 MΩ · Clase II ≥ 7 MΩ. Si no se midió: No aplica.'
WHERE plantilla_id = (SELECT MIN(id) FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353')
  AND orden = 4 AND texto = 'Medir resistencia de aislamiento' AND requiere_valor = 0;
UPDATE checklist_plantilla_items SET requiere_valor = 1, unidad = 'µA', bloqueante = 0,
  criterio_aceptacion = 'Directo o diferencial: Clase I ≤ 500 µA · Clase II ≤ 100 µA (alternativo: 1000 / 500 µA). Batería: No aplica.'
WHERE plantilla_id = (SELECT MIN(id) FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353')
  AND orden = 5 AND texto = 'Medir corriente de fuga del equipo' AND requiere_valor = 0;
UPDATE checklist_plantilla_items SET requiere_valor = 1, unidad = 'µA',
  criterio_aceptacion = 'BF ≤ 5000 µA · CF ≤ 50 µA. Tipo B o sin parte aplicada: No aplica.'
WHERE plantilla_id = (SELECT MIN(id) FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353')
  AND orden = 6 AND texto = 'Medir corriente de fuga de partes aplicadas (si aplica)' AND requiere_valor = 0;

-- Periodicidad de la prueba (meses); la cambian admin y jefe.
INSERT INTO app_config (clave, valor, updated_at)
SELECT 'bio.seguridad_electrica.meses', '12', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM app_config WHERE clave = 'bio.seguridad_electrica.meses');
-- WP-F siembra: fin

-- ─── 9. Incidentes y procedimientos ──────────────────────────────────────────

-- Orden relacionada con un incidente o evento adverso avisado a Calidad. Tabla
-- aparte para no agregar columnas a ordenes (la ficha ya roza el límite de 100
-- columnas de D1). Una marca por orden; sin cascada: una orden marcada no se borra.
CREATE TABLE orden_incidentes (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  orden_id integer NOT NULL UNIQUE REFERENCES ordenes(id),
  numero_reporte text,                            -- número del reporte de Calidad; puede llegar después
  fecha_notificacion text NOT NULL,               -- 'AAAA-MM-DD': día en que se avisó a Calidad
  nota text,
  marcado_por integer NOT NULL REFERENCES usuarios(id),
  marcado_en text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_orden_incidentes_fecha ON orden_incidentes(fecha_notificacion);

-- PDF aprobado de cada documento de la biblioteca (r2_key existe desde la 0047).
-- El tipo 'protocolo' no requiere SQL: procedimientos.tipo es texto sin CHECK.
ALTER TABLE procedimientos ADD COLUMN pdf_nombre text;
ALTER TABLE procedimientos ADD COLUMN pdf_tamano integer;
ALTER TABLE procedimientos ADD COLUMN pdf_version text;
ALTER TABLE procedimientos ADD COLUMN pdf_subido_por integer REFERENCES usuarios(id);
ALTER TABLE procedimientos ADD COLUMN pdf_subido_en text;                  -- ISO con Z
