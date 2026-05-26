-- Fase 38: Matriz de responsabilidades RACI (gobernanza JCI).
-- Documenta quién Ejecuta (R), Aprueba/rinde cuentas (A), es Consultado (C)
-- e Informado (I) en cada proceso de mantenimiento.

CREATE TABLE raci_procesos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE raci_asignaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proceso_id INTEGER NOT NULL REFERENCES raci_procesos(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  responsabilidad TEXT NOT NULL,   -- R | A | C | I
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_raci_asignaciones_proceso ON raci_asignaciones(proceso_id);

-- Procesos base
INSERT INTO raci_procesos (id, nombre, descripcion, orden) VALUES
 (1,'Mantenimiento preventivo general','Equipos e instalaciones generales',0),
 (2,'Mantenimiento preventivo biomédico','Equipos biomédicos',1),
 (3,'Mantenimiento correctivo','Reparación ante falla',2),
 (4,'Calibración de equipo biomédico','Calibración trazable a patrón',3),
 (5,'Gestión de contratos de mantenimiento','Contratos con proveedores externos',4),
 (6,'Plan de contingencia / continuidad','Respaldo y escalación de equipos críticos',5);

-- Asignaciones RACI base (editable desde /raci)
INSERT INTO raci_asignaciones (proceso_id, actor, responsabilidad) VALUES
 (1,'Técnico de mantenimiento','R'),(1,'Jefe de Mantenimiento General','A'),(1,'Operador del área','C'),(1,'Dirección','I'),
 (2,'Técnico biomédico','R'),(2,'Jefe de Mantenimiento Biomédico','A'),(2,'Proveedor especializado','C'),(2,'Dirección','I'),
 (3,'Técnico asignado','R'),(3,'Jefe de Mantenimiento','A'),(3,'Solicitante','I'),
 (4,'Laboratorio acreditado','R'),(4,'Jefe de Mantenimiento Biomédico','A'),(4,'Técnico biomédico','C'),(4,'Dirección','I'),
 (5,'Jefe de Mantenimiento','R'),(5,'Dirección','A'),(5,'Proveedor','C'),(5,'Administración','I'),
 (6,'Jefe de Mantenimiento','R'),(6,'Dirección','A'),(6,'Técnicos','I');
