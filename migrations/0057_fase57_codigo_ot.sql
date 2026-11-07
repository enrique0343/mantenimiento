-- Fase 57: el código de cada orden. OT-MG0001 para Mantenimiento General y
-- OT-MB0001 para Biomédico, por decisión de la Gerencia de Operaciones (07/11/2026).
-- El id sigue siendo la llave interna y la dirección de la página: el código es
-- lo que leen las personas. Un número no se reutiliza aunque la orden se borre.

-- El índice de búsqueda se actualiza solo cuando cambia un texto indexado. Sin esto,
-- el UPDATE con que ordenes_codigo_asignar pone el código le pide a FTS borrar una
-- fila que todavía no indexó, y crear la orden falla con «database disk image is
-- malformed». También evita que numerar las órdenes viejas reescriba todo el índice.
DROP TRIGGER ordenes_au;
CREATE TRIGGER ordenes_au AFTER UPDATE OF titulo, descripcion, trabajos_realizados, causa_raiz, solucion_aplicada ON ordenes BEGIN
  INSERT INTO ordenes_fts(ordenes_fts, rowid, titulo, descripcion, trabajos_realizados, causa_raiz, solucion_aplicada)
  VALUES ('delete', old.id, COALESCE(old.titulo,''), COALESCE(old.descripcion,''), COALESCE(old.trabajos_realizados,''),
          COALESCE(old.causa_raiz,''), COALESCE(old.solucion_aplicada,''));
  INSERT INTO ordenes_fts(rowid, titulo, descripcion, trabajos_realizados, causa_raiz, solucion_aplicada)
  VALUES (new.id, COALESCE(new.titulo,''), COALESCE(new.descripcion,''), COALESCE(new.trabajos_realizados,''),
          COALESCE(new.causa_raiz,''), COALESCE(new.solucion_aplicada,''));
END;

ALTER TABLE ordenes ADD COLUMN codigo text;

CREATE TABLE orden_series (
  serie text PRIMARY KEY NOT NULL CHECK (serie IN ('MG', 'MB')),
  ultimo integer NOT NULL DEFAULT 0
);
INSERT INTO orden_series (serie, ultimo) VALUES ('MG', 0), ('MB', 0);

-- Las órdenes que ya existen se numeran en el orden en que se crearon.
UPDATE ordenes SET codigo = n.codigo
FROM (
  SELECT id, 'OT-' || serie || printf('%04d', ROW_NUMBER() OVER (PARTITION BY serie ORDER BY id)) AS codigo
  FROM (
    SELECT o.id, CASE WHEN o.rubro = 'biomedico' OR (o.rubro IS NULL AND a.tipo = 'biomedico') THEN 'MB' ELSE 'MG' END AS serie
    FROM ordenes o LEFT JOIN activos a ON a.id = o.activo_id
  )
) n
WHERE ordenes.id = n.id;

UPDATE orden_series SET ultimo = (SELECT count(*) FROM ordenes WHERE substr(ordenes.codigo, 4, 2) = orden_series.serie);

CREATE UNIQUE INDEX uq_ordenes_codigo ON ordenes (codigo);

-- Cualquier camino que cree una orden recibe su código aquí, en la misma transacción.
-- La serie sale del rubro; una orden sin rubro toma la del equipo.
CREATE TRIGGER ordenes_codigo_asignar AFTER INSERT ON ordenes WHEN NEW.codigo IS NULL
BEGIN
  UPDATE orden_series SET ultimo = ultimo + 1
   WHERE serie = CASE WHEN NEW.rubro = 'biomedico' OR (NEW.rubro IS NULL AND (SELECT tipo FROM activos WHERE id = NEW.activo_id) = 'biomedico') THEN 'MB' ELSE 'MG' END;
  UPDATE ordenes SET codigo = (
    SELECT 'OT-' || serie || printf('%04d', ultimo) FROM orden_series
     WHERE serie = CASE WHEN NEW.rubro = 'biomedico' OR (NEW.rubro IS NULL AND (SELECT tipo FROM activos WHERE id = NEW.activo_id) = 'biomedico') THEN 'MB' ELSE 'MG' END
  ) WHERE id = NEW.id;
END;

-- El código de una orden no cambia: es la referencia en reportes, correos y auditorías.
CREATE TRIGGER ordenes_codigo_fijo BEFORE UPDATE OF codigo ON ordenes
WHEN OLD.codigo IS NOT NULL AND NEW.codigo IS NOT OLD.codigo
BEGIN SELECT RAISE(ABORT, 'ORDEN_CODIGO_INMUTABLE'); END;
