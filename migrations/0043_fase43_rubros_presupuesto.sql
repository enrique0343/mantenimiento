-- Fase 43: Rubros de mantenimiento, modalidad de ejecución, presupuesto anual
-- y configuración del documento "Plan Anual de Mantenimiento".

-- 1) Rubro en equipos (taxonomía tipo plan hospitalario:
--    locativo / redes / biomedico / industrial / ti / mobiliario / flota)
ALTER TABLE activos ADD COLUMN rubro TEXT;
UPDATE activos SET rubro = CASE WHEN tipo = 'biomedico' THEN 'biomedico' ELSE 'industrial' END
  WHERE rubro IS NULL;

-- 2) Rubro en categorías de actividades recurrentes
ALTER TABLE actividad_categorias ADD COLUMN rubro TEXT;
UPDATE actividad_categorias SET rubro = CASE nombre
  WHEN 'Limpieza' THEN 'locativo'
  WHEN 'Fumigación / control de plagas' THEN 'locativo'
  WHEN 'Tanques de agua' THEN 'redes'
  WHEN 'Trampas de grasa' THEN 'redes'
  WHEN 'Áreas comunes' THEN 'locativo'
  WHEN 'Jardinería' THEN 'locativo'
  WHEN 'Sistemas eléctricos generales' THEN 'industrial'
  WHEN 'Puertas y accesos' THEN 'locativo'
  ELSE 'locativo'
END WHERE rubro IS NULL;

-- 3) Modalidad de ejecución en planes de equipos (interno / contratado / mixto)
--    y vínculo opcional al contrato de mantenimiento que lo respalda.
ALTER TABLE planes_mantenimiento ADD COLUMN modalidad TEXT NOT NULL DEFAULT 'interno';
ALTER TABLE planes_mantenimiento ADD COLUMN contrato_id integer REFERENCES contratos_mantenimiento(id);

-- 4) Presupuesto anual de mantenimiento por rubro
CREATE TABLE presupuesto_mantenimiento (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  anio integer NOT NULL,
  rubro text NOT NULL,
  monto real NOT NULL DEFAULT 0,
  notas text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(anio, rubro)
);

-- 5) Registro de gastos/ejecución del presupuesto
CREATE TABLE gastos_mantenimiento (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  fecha text NOT NULL,
  rubro text NOT NULL,
  sucursal_id integer REFERENCES sucursales(id),
  descripcion text NOT NULL,
  monto real NOT NULL,
  referencia text,
  creado_por integer REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_gastos_fecha ON gastos_mantenimiento(fecha);
CREATE INDEX idx_gastos_rubro ON gastos_mantenimiento(rubro);

-- 6) Configuración clave-valor (textos del documento del plan anual, etc.)
CREATE TABLE app_config (
  clave text PRIMARY KEY NOT NULL,
  valor text NOT NULL,
  updated_at text
);
