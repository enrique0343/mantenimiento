-- Fase 52: la ronda de turno, primer paso de la cadena.
--
-- El SOP-MG-01 («Ronda de sistemas críticos por turno») ya existía como
-- documento. Esto lo pone a operar: un recorrido con puntos, una ejecución por
-- turno y una lectura por punto. Cada punto sabe de qué familia es y qué AOP
-- lo rige, así que una lectura fuera de rango abre el episodio con su reloj sin
-- que nadie tenga que buscar el documento.
--
--   ronda            la plantilla del recorrido (modelo o por sede)
--   ronda_puntos     cada parada, con su valor esperado y su AOP
--   ronda_ejecuciones la ronda de ESTE turno
--   ronda_lecturas   lo que se anotó en cada punto

CREATE TABLE rondas (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL,
  descripcion text,
  procedimiento_id integer REFERENCES procedimientos(id),   -- el SOP que la gobierna
  sucursal_id integer REFERENCES sucursales(id),            -- NULL = modelo para todas las sedes
  turnos text NOT NULL DEFAULT '["06:00","14:00","22:00"]', -- JSON de horas de inicio
  minutos_estimados integer,
  activa integer NOT NULL DEFAULT 1,
  creado_por integer REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ronda_puntos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  ronda_id integer NOT NULL REFERENCES rondas(id) ON DELETE CASCADE,
  orden integer NOT NULL DEFAULT 0,
  sistema text NOT NULL,                      -- familia: electrico | hvac | gases | agua | incendios | ascensores
  etiqueta text NOT NULL,                     -- "Planta de emergencia · nivel de combustible"
  instruccion text,                           -- qué hacer exactamente en la parada
  activo_id integer REFERENCES activos(id) ON DELETE SET NULL,
  ubicacion_id integer REFERENCES ubicaciones(id) ON DELETE SET NULL,
  variable_id integer REFERENCES variables_predictivas(id) ON DELETE SET NULL,
  requiere_valor integer NOT NULL DEFAULT 0,  -- 1 = hay que teclear un número
  unidad text,
  min_esperado real,
  max_esperado real,
  valor_esperado_texto text,                  -- cuando la verificación no es numérica
  fuente text,                                -- de dónde sale el valor normal
  aop_procedimiento_id integer REFERENCES procedimientos(id),  -- qué AOP rige si se sale
  critico integer NOT NULL DEFAULT 0,         -- 1 = no se puede cerrar la ronda sin verificarlo
  activo integer NOT NULL DEFAULT 1
);
CREATE INDEX idx_ronda_puntos ON ronda_puntos(ronda_id, orden);

CREATE TABLE ronda_ejecuciones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  ronda_id integer NOT NULL REFERENCES rondas(id) ON DELETE CASCADE,
  sucursal_id integer NOT NULL REFERENCES sucursales(id),
  fecha text NOT NULL,                        -- AAAA-MM-DD, hora de El Salvador
  turno text NOT NULL,                        -- "06:00"
  estado text NOT NULL DEFAULT 'en_curso',    -- en_curso | completada
  iniciada_en text,
  iniciada_por integer REFERENCES usuarios(id),
  completada_en text,
  completada_por integer REFERENCES usuarios(id),
  minutos_ronda integer,
  puntos_total integer NOT NULL DEFAULT 0,
  puntos_ok integer NOT NULL DEFAULT 0,
  puntos_fuera integer NOT NULL DEFAULT 0,
  puntos_no_verificados integer NOT NULL DEFAULT 0,
  notas text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ronda_id, sucursal_id, fecha, turno)
);
CREATE INDEX idx_ronda_ejec_fecha ON ronda_ejecuciones(fecha, turno);
CREATE INDEX idx_ronda_ejec_estado ON ronda_ejecuciones(estado);

CREATE TABLE ronda_lecturas (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  ejecucion_id integer NOT NULL REFERENCES ronda_ejecuciones(id) ON DELETE CASCADE,
  punto_id integer NOT NULL REFERENCES ronda_puntos(id) ON DELETE CASCADE,
  resultado text NOT NULL,                    -- ok | fuera | no_verificado
  valor real,
  valor_texto text,
  nota text,
  medicion_id integer REFERENCES mediciones(id),
  aop_evento_id integer REFERENCES aop_eventos(id),  -- el episodio que abrió esta lectura
  registrado_por integer REFERENCES usuarios(id),
  registrado_en text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ejecucion_id, punto_id)
);
CREATE INDEX idx_ronda_lecturas ON ronda_lecturas(ejecucion_id);

-- La desviación sabe de qué ronda salió (para el indicador 8 y la trazabilidad)
ALTER TABLE aop_eventos ADD COLUMN ronda_lectura_id integer REFERENCES ronda_lecturas(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- La ronda modelo del SOP-MG-01: 19 paradas, las seis familias.
-- Los valores normales vienen de la norma que cita el volumen; los que son de
-- cada sede quedan en NULL para que los fije su SCP.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO rondas (codigo, nombre, descripcion, procedimiento_id, sucursal_id, turnos, minutos_estimados, activa, creado_por)
SELECT 'RONDA-TURNO', 'Ronda de sistemas críticos por turno',
 'Primer paso de la cadena: lo que se verifica en cada turno antes que nada. Una lectura fuera de rango abre sola la desviación con el AOP que la rige y su reloj.',
 (SELECT id FROM procedimientos WHERE codigo_corto='SOP-MG-01'),
 NULL, '["06:00","14:00","22:00"]', 45, 1,
 (SELECT id FROM usuarios WHERE activo=1 ORDER BY (rol<>'admin'), id LIMIT 1);

-- Las 19 paradas de la ronda modelo
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 1, 'electrico', 'Planta de emergencia · nivel de combustible', 'Leer el nivel del tanque diario y del tanque principal. Si está bajo el nivel de reorden del SCP-ELE-01, pedir el reabastecimiento en el mismo turno.', 1, '%', 50, NULL, NULL, 'SCP-ELE-01 · NFPA 110', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-ELE-01'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=1);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 2, 'electrico', 'Planta de emergencia · selector en AUTO y anunciador sin alarmas', 'Confirmar el selector en AUTO, la batería cargada, el calentador de block encendido y el anunciador remoto sin luces de alarma.', 0, NULL, NULL, NULL, 'Selector en AUTO, sin alarmas', 'SCP-ELE-01 · NFPA 110 cap. 8', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-ELE-01'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=2);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 3, 'electrico', 'Transferencia automática · posición normal y sin alarma', 'Verificar cada transferencia en posición normal, alimentada por la red, sin alarma y con el selector en automático.', 0, NULL, NULL, NULL, 'En posición normal, sin alarma', 'SCP-ELE-01 · NFPA 110', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-ELE-01'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=3);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 4, 'electrico', 'UPS · en línea, sin alarma y batería cargada', 'Confirmar que el UPS está en línea, sin alarma audible ni visual, y con la autonomía que declara el SCP-ELE-01.', 0, NULL, NULL, NULL, 'En línea, sin alarma', 'SCP-ELE-01', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-ELE-01'), 0
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=4);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 5, 'hvac', 'Quirófanos · temperatura', 'Leer la temperatura de cada quirófano en el instrumento del SCP-HVAC-01. Anotar la sala con la lectura más alta.', 1, '°C', 20, 24, NULL, 'ASHRAE 170 · SCP-HVAC-01', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-HVAC-01'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=5);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 6, 'hvac', 'Quirófanos · humedad relativa', 'Leer la humedad relativa de cada quirófano. Si pasa de 60 % o baja de 20 %, abrir la desviación con la sala indicada.', 1, '%', 20, 60, NULL, 'ASHRAE 170 · SCP-HVAC-01', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-HVAC-01'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=6);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 7, 'hvac', 'Quirófano · presión positiva respecto al pasillo', 'Verificar que el quirófano empuja aire hacia el pasillo, con el método que fija el SCP-HVAC-01.', 1, 'Pa', 2.5, NULL, NULL, 'ASHRAE 170 · SCP-HVAC-01', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-HVAC-02'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=7);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 8, 'hvac', 'Cuarto de aislamiento · dirección del flujo de aire', 'Comprobar que el aire entra al cuarto desde el pasillo, no al contrario. Si la dirección está invertida, es desviación.', 0, NULL, NULL, NULL, 'Aire entrando al cuarto', 'ASHRAE 170 · SCP-HVAC-01', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-HVAC-02'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=8);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 9, 'hvac', 'Almacén de material estéril · temperatura y humedad', 'Leer y anotar temperatura y humedad del almacén estéril, dentro del rango del SCP-HVAC-01.', 0, NULL, NULL, NULL, 'Dentro del rango del SCP-HVAC-01', 'SCP-HVAC-01', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-HVAC-01'), 0
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=9);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 10, 'gases', 'Oxígeno · contenido del tanque y de la reserva', 'Leer el contenido del tanque criogénico y confirmar que la reserva está completa y en servicio.', 1, '%', 40, NULL, NULL, 'SCP-GAS-01 · NFPA 99 cap. 5', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-GAS-01'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=10);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 11, 'gases', 'Oxígeno · presión en la red', 'Leer la presión de la red de oxígeno en el manómetro de la central.', 1, 'kPa', 345, 380, NULL, 'NFPA 99 · SCP-GAS-01', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-GAS-01'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=11);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 12, 'gases', 'Panel de alarma de gases · sin señal activa', 'Recorrer los paneles de alarma de área y maestro. Ninguna señal activa; si hay una, anotar cuál y en qué zona.', 0, NULL, NULL, NULL, 'Sin señal activa', 'SCP-GAS-01 · NFPA 99', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-GAS-01'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=12);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 13, 'gases', 'Centrales de aire medicinal y vacío · duty/standby y sin alarma', 'Confirmar la selección duty/standby que fija el SCP-GAS-01, presión en rango y ninguna alarma de la central.', 0, NULL, NULL, NULL, 'Duty/standby según el SCP-GAS-01', 'SCP-GAS-01', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-GAS-01'), 0
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=13);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 14, 'gases', 'Cilindros de reserva en el punto de emergencia', 'Contar los cilindros llenos en el punto de emergencia y compararlos con el nivel de reorden del SCP-GAS-01.', 1, 'cilindros', NULL, NULL, NULL, 'SCP-GAS-01', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-GAS-01'), 0
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=14);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 15, 'agua', 'Cisterna · nivel', 'Leer el nivel de la cisterna y confirmar que la entrada de agua está activa.', 1, '%', 50, NULL, NULL, 'SCP-AGU-01', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-AGU-01'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=15);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 16, 'agua', 'Agua caliente · salida del calentador', 'Medir la temperatura a la salida del calentador. Bajo 60 °C es desviación.', 1, '°C', 60, NULL, NULL, 'HSG274 parte 2 · SCP-AGU-01', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-AGU-01'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=16);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 17, 'incendios', 'Panel de alarma de incendio · sin falla ni zona en supervisión', 'Mirar el panel: ninguna zona en falla, en supervisión ni silenciada. Anotar cualquier luz que no sea la de servicio normal.', 0, NULL, NULL, NULL, 'Solo la luz de servicio normal', 'SCP-INC-01 · NFPA 72', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-INC-01'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=17);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 18, 'incendios', 'Bomba contra incendios y válvulas de control', 'Confirmar la bomba en AUTO sin alarma, la presión del sistema en el valor del SCP-INC-01 y las válvulas de control abiertas y rotuladas.', 0, NULL, NULL, NULL, 'Bomba en AUTO, válvulas abiertas y rotuladas', 'SCP-INC-01 · NFPA 25', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-INC-01'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=18);
INSERT INTO ronda_puntos (ronda_id, orden, sistema, etiqueta, instruccion, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 19, 'ascensores', 'Ascensores · recorrido, puertas y teléfono de cabina', 'Subir y bajar cada ascensor, verificar que nivela y que las puertas abren y cierran, y probar el teléfono de cabina. El teléfono sin funcionar es ascensor fuera de servicio.', 0, NULL, NULL, NULL, 'Recorrido, puertas y teléfono correctos', 'SCP-ASC-01', (SELECT id FROM procedimientos WHERE codigo_corto='AOP-ASC-01'), 1
FROM rondas r WHERE r.codigo='RONDA-TURNO' AND NOT EXISTS (SELECT 1 FROM ronda_puntos x WHERE x.ronda_id=r.id AND x.orden=19);
