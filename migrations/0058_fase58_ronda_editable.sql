-- Fase 58: la configuración de la ronda se edita de verdad (Gerencia de Operaciones, 07/11/2026).
--
-- 1. «Esta sede no hace ronda» deja de ser una copia apagada del modelo: es una marca
--    de la sede, y la sede sigue usando el modelo o su recorrido propio.
-- 2. Un cambio entra en la ronda del turno que todavía no empezó. Para que el tablero y
--    la revisión semanal no se reescriban hacia atrás, cada cambio de turnos o de la
--    marca guarda lo que regía hasta ese momento: un turno se juzga con lo que regía
--    cuando empezó.

-- 1. La marca de la sede.
ALTER TABLE sucursales ADD COLUMN hace_ronda integer NOT NULL DEFAULT 1;

-- Hasta hoy, «no hace ronda» se marcaba copiando el modelo a la sede y apagando la copia.
-- La marca pasa a la sede y la copia queda como su recorrido propio, igual que antes.
UPDATE sucursales SET hace_ronda = 0
 WHERE id IN (SELECT sucursal_id FROM rondas WHERE sucursal_id IS NOT NULL AND activa = 0);
UPDATE rondas SET activa = 1 WHERE sucursal_id IS NOT NULL AND activa = 0;

-- 2. Lo que regía antes de cada cambio. Solo se agrega: no se edita ni se borra.
CREATE TABLE ronda_vigencias (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  ronda_id integer REFERENCES rondas(id),          -- cambiaron los turnos de este recorrido
  sucursal_id integer REFERENCES sucursales(id),   -- cambió si esta sede hace ronda
  turnos_antes text,                               -- JSON: los turnos que regían hasta «hasta»
  hace_ronda_antes integer,                        -- 1 o 0: si la sede hacía ronda hasta «hasta»
  hasta text NOT NULL,                             -- ISO: el momento del cambio
  usuario_id integer REFERENCES usuarios(id),
  CHECK (
    (ronda_id IS NOT NULL AND turnos_antes IS NOT NULL AND sucursal_id IS NULL AND hace_ronda_antes IS NULL)
    OR (sucursal_id IS NOT NULL AND hace_ronda_antes IN (0, 1) AND ronda_id IS NULL AND turnos_antes IS NULL)
  )
);
CREATE INDEX idx_ronda_vigencias_ronda ON ronda_vigencias(ronda_id, hasta);
CREATE INDEX idx_ronda_vigencias_sede ON ronda_vigencias(sucursal_id, hasta);
CREATE TRIGGER ronda_vigencias_sin_editar BEFORE UPDATE ON ronda_vigencias BEGIN SELECT RAISE(ABORT, 'La vigencia de la ronda no se edita'); END;
CREATE TRIGGER ronda_vigencias_sin_borrar BEFORE DELETE ON ronda_vigencias BEGIN SELECT RAISE(ABORT, 'La vigencia de la ronda no se borra'); END;
