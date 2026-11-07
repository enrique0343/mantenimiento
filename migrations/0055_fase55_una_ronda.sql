-- Fase 55: una sola ronda. Lo que le faltaba al motor del celular para ser auditable.
-- Solo agrega y corrige el recorrido sembrado. Las tablas rondas_* se retiran en una
-- migración posterior, ya con el código nuevo en línea.

-- 1. Una ejecución sin lecturas no es registro de nada; además estorba al índice único.
DELETE FROM ronda_ejecuciones WHERE id NOT IN (SELECT ejecucion_id FROM ronda_lecturas);

-- 2. La ejecución: foto del recorrido, firma, llegada del cierre y una ronda por sede y turno.
ALTER TABLE ronda_ejecuciones ADD COLUMN recorrido_json text;
ALTER TABLE ronda_ejecuciones ADD COLUMN firma_nombre text;
ALTER TABLE ronda_ejecuciones ADD COLUMN recibida_en text;
CREATE UNIQUE INDEX uq_ronda_ejec_sede_turno ON ronda_ejecuciones(sucursal_id, fecha, turno);
-- El contador deja de mezclar lo declarado con lo que quedó en blanco.
UPDATE ronda_ejecuciones SET puntos_no_verificados =
  (SELECT count(*) FROM ronda_lecturas l WHERE l.ejecucion_id = ronda_ejecuciones.id AND l.resultado = 'no_verificado');

-- 3. La línea del SOP y el reloj propio de cada parada.
ALTER TABLE ronda_puntos ADD COLUMN linea_sop integer;
ALTER TABLE ronda_puntos ADD COLUMN minutos_actuar integer;
ALTER TABLE ronda_puntos ADD COLUMN minutos_escalar integer;

-- 4. Desde cuándo se exige la ronda: antes de esta fecha no hay «no se hizo».
ALTER TABLE rondas ADD COLUMN vigente_desde text;
UPDATE rondas SET vigente_desde = date('now', '-6 hours');

-- 5. De la lectura a la orden y del episodio a su parada.
ALTER TABLE ronda_lecturas ADD COLUMN orden_id integer REFERENCES ordenes(id) ON DELETE SET NULL;
CREATE INDEX idx_ronda_lecturas_orden ON ronda_lecturas(orden_id) WHERE orden_id IS NOT NULL;
ALTER TABLE aop_eventos ADD COLUMN ronda_punto_id integer REFERENCES ronda_puntos(id);
CREATE INDEX idx_aop_eventos_punto ON aop_eventos(ronda_punto_id, sucursal_id);

-- 6. El libro de la ronda: cada toque con hora real y hora de llegada. No se edita ni se borra.
CREATE TABLE ronda_marcas (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  ejecucion_id integer NOT NULL REFERENCES ronda_ejecuciones(id),
  punto_id integer NOT NULL REFERENCES ronda_puntos(id),
  resultado text NOT NULL CHECK (resultado IN ('ok','fuera','no_verificado')),
  valor real,
  nota text,
  aop_evento_id integer REFERENCES aop_eventos(id),
  ocurrido_en text NOT NULL,
  recibido_en text NOT NULL,
  sin_senal integer NOT NULL DEFAULT 0,
  ajustado integer NOT NULL DEFAULT 0,
  usuario_id integer REFERENCES usuarios(id),
  op_id text UNIQUE
);
CREATE INDEX idx_ronda_marcas ON ronda_marcas(ejecucion_id, punto_id, id);
CREATE INDEX idx_ronda_marcas_usuario ON ronda_marcas(usuario_id, ocurrido_en);
CREATE TRIGGER ronda_marcas_sin_editar BEFORE UPDATE ON ronda_marcas BEGIN SELECT RAISE(ABORT, 'La marca de ronda no se edita'); END;
CREATE TRIGGER ronda_marcas_sin_borrar BEFORE DELETE ON ronda_marcas BEGIN SELECT RAISE(ABORT, 'La marca de ronda no se borra'); END;

-- 7. La ronda firmada no se toca. La orden que nació de una parada sí se puede ligar después.
CREATE TRIGGER ronda_ejec_firmada BEFORE UPDATE OF estado, iniciada_en, iniciada_por, completada_en, completada_por, minutos_ronda, puntos_total, puntos_ok, puntos_fuera, puntos_no_verificados, notas, recorrido_json, firma_nombre, recibida_en ON ronda_ejecuciones
WHEN OLD.estado = 'completada' BEGIN SELECT RAISE(ABORT, 'La ronda firmada no se edita'); END;
CREATE TRIGGER ronda_lectura_firmada_insert BEFORE INSERT ON ronda_lecturas
WHEN (SELECT estado FROM ronda_ejecuciones WHERE id = NEW.ejecucion_id) = 'completada' BEGIN SELECT RAISE(ABORT, 'La ronda firmada no se edita'); END;
CREATE TRIGGER ronda_lectura_firmada_update BEFORE UPDATE OF resultado, valor, valor_texto, nota, registrado_por, registrado_en ON ronda_lecturas
WHEN (SELECT estado FROM ronda_ejecuciones WHERE id = OLD.ejecucion_id) = 'completada' BEGIN SELECT RAISE(ABORT, 'La ronda firmada no se edita'); END;
CREATE TRIGGER ronda_lecturas_sin_borrar BEFORE DELETE ON ronda_lecturas BEGIN SELECT RAISE(ABORT, 'La lectura de ronda no se borra'); END;

-- 8. La revisión semanal de la jefatura (SOP-MG-01, Registro). Congela los números de la semana.
CREATE TABLE ronda_revisiones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  sucursal_id integer NOT NULL REFERENCES sucursales(id),
  semana text NOT NULL,
  esperadas integer NOT NULL,
  completas integer NOT NULL,
  con_novedad integer NOT NULL,
  incompletas integer NOT NULL,
  no_hechas integer NOT NULL,
  observaciones text,
  revisada_por integer NOT NULL REFERENCES usuarios(id),
  revisada_nombre text NOT NULL,
  revisada_en text NOT NULL,
  UNIQUE(sucursal_id, semana)
);
CREATE TRIGGER ronda_revisiones_sin_editar BEFORE UPDATE ON ronda_revisiones BEGIN SELECT RAISE(ABORT, 'La revisión firmada no se edita'); END;
CREATE TRIGGER ronda_revisiones_sin_borrar BEFORE DELETE ON ronda_revisiones BEGIN SELECT RAISE(ABORT, 'La revisión firmada no se borra'); END;

-- 9. Lo que el servidor no aceptó tiene que poder verse.
CREATE INDEX idx_campo_ops_rechazos ON campo_operaciones(resultado, recibido_en);

-- 10. El recorrido en el orden y con las líneas del SOP-MG-01. Una sola sentencia: CASE lee los valores viejos.
UPDATE ronda_puntos SET
  linea_sop = CASE orden WHEN 3 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 3 WHEN 12 THEN 4 WHEN 11 THEN 4 WHEN 13 THEN 4 WHEN 10 THEN 4 WHEN 14 THEN 4 WHEN 5 THEN 5 WHEN 6 THEN 5 WHEN 7 THEN 5 WHEN 9 THEN 5 WHEN 8 THEN 6 WHEN 15 THEN 7 WHEN 17 THEN 8 WHEN 18 THEN 8 WHEN 19 THEN 9 ELSE NULL END,
  activo = CASE WHEN orden IN (4, 16) THEN 0 ELSE activo END,
  orden = CASE orden WHEN 3 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 12 THEN 5 WHEN 11 THEN 6 WHEN 13 THEN 7 WHEN 10 THEN 8 WHEN 14 THEN 9 WHEN 5 THEN 11 WHEN 6 THEN 12 WHEN 7 THEN 13 WHEN 9 THEN 14 WHEN 8 THEN 15 WHEN 15 THEN 16 WHEN 17 THEN 18 WHEN 18 THEN 19 WHEN 19 THEN 20 WHEN 4 THEN 90 WHEN 16 THEN 91 ELSE orden END
WHERE ronda_id = (SELECT id FROM rondas WHERE codigo = 'RONDA-TURNO');

-- Las cuatro paradas que el SOP pide y faltaban.
INSERT INTO ronda_puntos (ronda_id, orden, linea_sop, sistema, etiqueta, instruccion, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 1, 1, 'otro', 'Bitácora · alarmas abiertas del turno anterior', 'Lee la entrega del turno anterior y las desviaciones abiertas. Si una alarma no tiene orden ni responsable, abre la orden antes de salir.', 'Cada alarma abierta tiene orden y responsable', 'SOP-MG-01 línea 1', NULL, 1 FROM rondas r WHERE r.codigo = 'RONDA-TURNO';
INSERT INTO ronda_puntos (ronda_id, orden, linea_sop, sistema, etiqueta, instruccion, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 10, 5, 'hvac', 'Manejadoras de quirófano y esterilización · en marcha y sin alarmas', 'Revisa el panel local de cada manejadora.', 'Panel en verde, sin alarma de filtro ni de ventilador', 'SOP-MG-01 línea 5', (SELECT id FROM procedimientos WHERE codigo_corto = 'AOP-HVAC-01'), 1 FROM rondas r WHERE r.codigo = 'RONDA-TURNO';
INSERT INTO ronda_puntos (ronda_id, orden, linea_sop, sistema, etiqueta, instruccion, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 17, 7, 'agua', 'Bombas de agua · automático, presión y cloro', 'Confirma las bombas en automático y la presión de red. El cloro residual se revisa según el programa de calidad del agua.', 'Bombas en automático, presión normal, cloro según programa', 'SOP-MG-01 línea 7', (SELECT id FROM procedimientos WHERE codigo_corto = 'AOP-AGU-01'), 1 FROM rondas r WHERE r.codigo = 'RONDA-TURNO';
INSERT INTO ronda_puntos (ronda_id, orden, linea_sop, sistema, etiqueta, instruccion, valor_esperado_texto, fuente, aop_procedimiento_id, critico)
SELECT r.id, 21, 10, 'otro', 'Cuartos técnicos · acceso, orden, temperatura y luz de emergencia', 'Retira de inmediato lo que obstruya. Para lo demás, abre una orden.', 'Acceso libre, sin almacenamiento ajeno, temperatura normal, luz de emergencia funcional', 'SOP-MG-01 línea 10', NULL, 0 FROM rondas r WHERE r.codigo = 'RONDA-TURNO';

-- Lo que el SOP pide y cada parada no decía, y los valores que se contradecían con él.
UPDATE ronda_puntos SET etiqueta = 'Tablero general y transferencias · posición normal y sin alarma', instruccion = 'Confirma tensión normal en el tablero general y cada transferencia en posición normal, con el selector en automático.', valor_esperado_texto = 'Tensión normal, posición normal, sin alarma'
 WHERE etiqueta = 'Transferencia automática · posición normal y sin alarma';
UPDATE ronda_puntos SET instruccion = 'Confirma el selector en AUTO, el cargador en flotación, el calentador de camisa activo, el anunciador sin alarmas y que no hay fugas de combustible, aceite ni refrigerante.', valor_esperado_texto = 'Selector en AUTO, sin alarmas ni fugas'
 WHERE etiqueta = 'Planta de emergencia · selector en AUTO y anunciador sin alarmas';
UPDATE ronda_puntos SET min_esperado = 20, max_esperado = 22, fuente = 'Banda de operación · SCP-HVAC-01 · validar con Control de Infecciones', instruccion = 'Lee la temperatura de cada quirófano. Si una sale de rango, escribe cuál.'
 WHERE etiqueta = 'Quirófanos · temperatura';
UPDATE ronda_puntos SET min_esperado = 50, max_esperado = 60, fuente = 'Banda de operación · SCP-HVAC-01 · validar con Control de Infecciones', instruccion = 'Lee la humedad relativa de cada quirófano. Si una sale de rango, escribe cuál.'
 WHERE etiqueta = 'Quirófanos · humedad relativa';
UPDATE ronda_puntos SET requiere_valor = 0, unidad = NULL, min_esperado = NULL, max_esperado = NULL, instruccion = 'Con manómetro diferencial y puertas cerradas; sin manómetro, tubo de humo en la rendija de la puerta.', valor_esperado_texto = 'Positiva: al menos +2.5 Pa, o el humo sale de la sala'
 WHERE etiqueta = 'Quirófano · presión positiva respecto al pasillo';
UPDATE ronda_puntos SET instruccion = 'Confirma temperatura de 18 a 25 °C y humedad de 35 a 70 %.', valor_esperado_texto = 'De 18 a 25 °C y de 35 a 70 %', minutos_actuar = 480
 WHERE etiqueta = 'Almacén de material estéril · temperatura y humedad';
UPDATE ronda_puntos SET etiqueta = 'Cuartos de aislamiento ocupados · presión negativa y puerta cerrada', instruccion = 'Comprueba que el aire entra al cuarto desde el pasillo y que la puerta está cerrada. Si no hay ninguno ocupado, marca Conforme.', valor_esperado_texto = 'Aire entrando y puerta cerrada, o ninguno ocupado'
 WHERE etiqueta = 'Cuarto de aislamiento · dirección del flujo de aire';
UPDATE ronda_puntos SET requiere_valor = 0, unidad = NULL, instruccion = 'Confirma todos los cilindros llenos y el selector en la posición normal. Tras una falla eléctrica, revisa que el contenido coincida con la alarma.', valor_esperado_texto = 'Todos los cilindros llenos, selector en posición normal'
 WHERE etiqueta = 'Cilindros de reserva en el punto de emergencia';
UPDATE ronda_puntos SET instruccion = 'Mira el panel: ninguna zona en falla, en supervisión ni silenciada.'
 WHERE etiqueta = 'Panel de alarma de incendio · sin falla ni zona en supervisión';
UPDATE ronda_puntos SET instruccion = 'Recorre los paneles de alarma de área y maestro. Si hay una señal, escribe cuál y en qué zona.'
 WHERE etiqueta = 'Panel de alarma de gases · sin señal activa';
UPDATE ronda_puntos SET instruccion = 'Confirma la bomba en automático con presión de churn normal y las válvulas de control abiertas y rotuladas.'
 WHERE etiqueta = 'Bomba contra incendios y válvulas de control';
UPDATE ronda_puntos SET etiqueta = 'Ascensores · cabinas en servicio y teléfono', instruccion = 'Confirma todas las cabinas en servicio y prueba el teléfono o botón de emergencia.', valor_esperado_texto = 'Todas las cabinas en servicio; teléfono o botón funciona'
 WHERE etiqueta = 'Ascensores · recorrido, puertas y teléfono de cabina';
-- Combustible: reposición en [24] horas, no las 4 h del AOP. Campo en azul.
UPDATE ronda_puntos SET minutos_actuar = 1440, minutos_escalar = 1440, fuente = 'Provisional: fijar nivel de reorden en SCP-ELE-01'
 WHERE etiqueta = 'Planta de emergencia · nivel de combustible';
UPDATE ronda_puntos SET fuente = 'Provisional: fijar nivel de reorden en SCP-GAS-01'
 WHERE etiqueta = 'Oxígeno · contenido del tanque y de la reserva';
UPDATE ronda_puntos SET fuente = 'Provisional: fijar nivel de alarma en SCP-AGU-01'
 WHERE etiqueta = 'Cisterna · nivel';
