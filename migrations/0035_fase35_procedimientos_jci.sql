-- Fase 35: Procedimientos estándar JCI.
-- Enriquece los items de plantilla de checklist con criterios de aceptación,
-- puntos bloqueantes (críticos), tiempo estimado por paso y recursos requeridos.

ALTER TABLE checklist_plantilla_items ADD COLUMN criterio_aceptacion TEXT;
ALTER TABLE checklist_plantilla_items ADD COLUMN bloqueante INTEGER NOT NULL DEFAULT 0;
ALTER TABLE checklist_plantilla_items ADD COLUMN minutos_estimados INTEGER;
ALTER TABLE checklist_plantilla_items ADD COLUMN materiales TEXT;

-- Enriquecer algunos items semilla con ejemplos de criterio/bloqueante/tiempo.
UPDATE checklist_plantilla_items SET criterio_aceptacion = 'Presión dentro del rango del fabricante (R410a baja ≈ 110-140 psi)', minutos_estimados = 10
  WHERE plantilla_id = 1 AND texto = 'Verificación de presión de gas refrigerante';
UPDATE checklist_plantilla_items SET criterio_aceptacion = 'ΔT entre aire de retorno y descarga ≥ 8 °C', minutos_estimados = 10
  WHERE plantilla_id = 1 AND texto = 'Verificación de termostato y temperatura de descarga';
UPDATE checklist_plantilla_items SET materiales = 'Filtros de repuesto, agua a presión, cepillo', minutos_estimados = 15
  WHERE plantilla_id = 1 AND texto = 'Limpieza de filtros de aire (lavado/reemplazo)';

UPDATE checklist_plantilla_items SET bloqueante = 1, criterio_aceptacion = 'Continuidad a tierra física < 1 Ω', minutos_estimados = 15
  WHERE plantilla_id = 2 AND texto = 'Verificación de continuidad de tierra física';
UPDATE checklist_plantilla_items SET bloqueante = 1, criterio_aceptacion = 'Sin puntos calientes > 10 °C sobre la referencia', minutos_estimados = 20
  WHERE plantilla_id = 2 AND texto = 'Termografía o inspección de puntos calientes';

UPDATE checklist_plantilla_items SET bloqueante = 1, criterio_aceptacion = 'Certificado de calibración vigente y trazable a patrón'
  WHERE plantilla_id = 3 AND texto = 'Calibración con patrón trazable (si aplica)';
UPDATE checklist_plantilla_items SET bloqueante = 1, criterio_aceptacion = 'Todas las alarmas activan en menos de 3 s', minutos_estimados = 10
  WHERE plantilla_id = 3 AND texto = 'Prueba de alarmas audibles y visuales';
