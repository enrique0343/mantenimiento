-- Plantillas de checklist gestionables desde /configuracion.
-- Cada plantilla agrupa puntos críticos para un tipo de equipo
-- (AC, eléctrico, biomédico, etc.). Al crear un plan preventivo,
-- el admin selecciona una plantilla y se autocompleta el checklist.

CREATE TABLE IF NOT EXISTS checklist_plantillas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  activa INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS checklist_plantilla_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plantilla_id INTEGER NOT NULL REFERENCES checklist_plantillas(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Seed inicial: 3 plantillas con sus items ───────────────────────────────

INSERT INTO checklist_plantillas (id, nombre, descripcion) VALUES
  (1, 'Aires acondicionados / Climatización', 'Mantenimiento preventivo para unidades AC split, paquete y central'),
  (2, 'Eléctrico / Tableros', 'Inspección y mantenimiento de tableros eléctricos'),
  (3, 'Biomédico general', 'Mantenimiento preventivo de equipos biomédicos generales');

-- Aires acondicionados (10 items)
INSERT INTO checklist_plantilla_items (plantilla_id, texto, orden) VALUES
  (1, 'Limpieza de filtros de aire (lavado/reemplazo)', 0),
  (1, 'Verificación de presión de gas refrigerante', 1),
  (1, 'Limpieza de serpentín evaporador (interior)', 2),
  (1, 'Limpieza de serpentín condensador (exterior)', 3),
  (1, 'Inspección y desobstrucción de drenajes', 4),
  (1, 'Verificación de termostato y temperatura de descarga', 5),
  (1, 'Apriete de conexiones eléctricas', 6),
  (1, 'Inspección de soportes y vibraciones anormales', 7),
  (1, 'Lubricación de motor ventilador (si aplica)', 8),
  (1, 'Prueba de funcionamiento en modo frío y modo calor', 9);

-- Eléctrico / Tableros (8 items)
INSERT INTO checklist_plantilla_items (plantilla_id, texto, orden) VALUES
  (2, 'Apriete de terminales y conexiones (par de torque)', 0),
  (2, 'Termografía o inspección de puntos calientes', 1),
  (2, 'Verificación de balance de cargas entre fases', 2),
  (2, 'Inspección de protecciones (breakers, fusibles)', 3),
  (2, 'Verificación de continuidad de tierra física', 4),
  (2, 'Limpieza interna de polvo y partículas', 5),
  (2, 'Verificación de rotulación e identificación de circuitos', 6),
  (2, 'Estado de gabinete: hermeticidad, cierre, accesibilidad', 7);

-- Biomédico general (8 items)
INSERT INTO checklist_plantilla_items (plantilla_id, texto, orden) VALUES
  (3, 'Calibración con patrón trazable (si aplica)', 0),
  (3, 'Verificación de baterías y respaldo eléctrico', 1),
  (3, 'Prueba de alarmas audibles y visuales', 2),
  (3, 'Limpieza y desinfección con producto apropiado', 3),
  (3, 'Verificación de etiquetas, sellos y registro sanitario vigente', 4),
  (3, 'Inspección de accesorios y consumibles', 5),
  (3, 'Verificación de software/firmware actualizado (si aplica)', 6),
  (3, 'Prueba funcional completa con simulador o paciente patrón', 7);
