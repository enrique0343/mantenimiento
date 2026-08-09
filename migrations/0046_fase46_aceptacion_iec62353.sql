-- Fase 46: Inspección de aceptación (entrada en servicio, JCI FMS.07) y
-- plantilla de checklist para prueba de seguridad eléctrica IEC 62353.

-- 1) Registro de aceptación en el activo
ALTER TABLE activos ADD COLUMN aceptacion_fecha TEXT;
ALTER TABLE activos ADD COLUMN aceptacion_resultado TEXT;  -- aprobado | condicionado | rechazado
ALTER TABLE activos ADD COLUMN aceptacion_notas TEXT;
ALTER TABLE activos ADD COLUMN aceptacion_por integer REFERENCES usuarios(id);

-- 2) Plantilla de checklist: Seguridad eléctrica IEC 62353 (anual)
INSERT INTO checklist_plantillas (nombre, descripcion) VALUES
  ('Seguridad eléctrica IEC 62353',
   'Prueba anual de seguridad eléctrica para equipo biomédico (referencia IEC 62353). Registrar los valores medidos en la OT.');

INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT id, 'Inspección visual: carcasa, cable de alimentación, conectores y accesorios sin daños', 'Sin fisuras, cables pelados ni conectores flojos', 1, 5, 1
FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353';

INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT id, 'Verificar fusibles y protecciones según placa del fabricante', 'Valores según placa', 0, 5, 2
FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353';

INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT id, 'Medir resistencia de tierra de protección', '≤ 0.3 Ω (equipo clase I)', 1, 10, 3
FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353';

INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT id, 'Medir resistencia de aislamiento', '≥ 2 MΩ (clase I) / ≥ 7 MΩ (clase II)', 0, 10, 4
FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353';

INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT id, 'Medir corriente de fuga del equipo', 'Dentro de límites IEC 62353 (≤ 500 µA método directo)', 1, 10, 5
FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353';

INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT id, 'Medir corriente de fuga de partes aplicadas (si aplica)', 'Según tipo de parte aplicada B / BF / CF', 0, 10, 6
FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353';

INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT id, 'Prueba funcional del equipo posterior a las mediciones', 'Funciones principales operativas', 1, 10, 7
FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353';

INSERT INTO checklist_plantilla_items (plantilla_id, texto, criterio_aceptacion, bloqueante, minutos_estimados, orden)
SELECT id, 'Registrar valores medidos y etiquetar el equipo con fecha de prueba y próxima', 'Etiqueta legible colocada en el equipo', 0, 5, 8
FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353';
