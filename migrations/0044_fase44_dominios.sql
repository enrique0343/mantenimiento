-- Fase 44: Taxonomía institucional de 4 dominios (Sistema de Planificación de
-- Mantenimiento General GO-PRY-0XX-2026):
--   infraestructura / aires / equipo_general / biomedico
-- Sustituye los 7 rubros provisionales de la fase 43 y agrega la
-- subcategoría biomédica (soporte_vida, diagnostico, tratamiento,
-- esterilizacion, cadena_frio, imagenologia, apoyo).

-- 1) Remapeo en equipos
UPDATE activos SET rubro = 'infraestructura' WHERE rubro IN ('locativo', 'redes', 'mobiliario');
UPDATE activos SET rubro = 'equipo_general' WHERE rubro IN ('industrial', 'ti', 'flota');

-- Heurística para aires acondicionados (ajustable luego en /activos/clasificar)
UPDATE activos SET rubro = 'aires'
WHERE rubro != 'biomedico' AND (
  lower(nombre) LIKE '%aire acond%' OR lower(nombre) LIKE '%a/c%' OR
  lower(nombre) LIKE '%minisplit%' OR lower(nombre) LIKE '%mini split%' OR
  lower(nombre) LIKE '%split%' OR lower(nombre) LIKE '%chiller%' OR
  lower(nombre) LIKE '%manejadora%' OR lower(nombre) LIKE '%uma%' OR
  lower(coalesce(categoria, '')) LIKE '%aire%' OR
  lower(coalesce(categoria, '')) LIKE '%clima%' OR
  lower(coalesce(categoria, '')) LIKE '%hvac%'
);

-- 2) Subcategoría biomédica
ALTER TABLE activos ADD COLUMN subcategoria TEXT;

-- 3) Remapeo en categorías de actividades
UPDATE actividad_categorias SET rubro = 'infraestructura' WHERE rubro IN ('locativo', 'redes', 'mobiliario');
UPDATE actividad_categorias SET rubro = 'equipo_general' WHERE rubro IN ('industrial', 'ti', 'flota');

-- 4) Remapeo en presupuesto (fusiona rubros antiguos sumando montos, por si
--    ya existieran registros; respeta UNIQUE(anio, rubro))
CREATE TABLE _tmp_presu AS
SELECT anio,
       CASE
         WHEN rubro IN ('locativo', 'redes', 'mobiliario') THEN 'infraestructura'
         WHEN rubro IN ('industrial', 'ti', 'flota') THEN 'equipo_general'
         ELSE rubro
       END AS rubro,
       SUM(monto) AS monto
FROM presupuesto_mantenimiento
GROUP BY 1, 2;
DELETE FROM presupuesto_mantenimiento;
INSERT INTO presupuesto_mantenimiento (anio, rubro, monto)
SELECT anio, rubro, monto FROM _tmp_presu;
DROP TABLE _tmp_presu;

-- 5) Remapeo en gastos
UPDATE gastos_mantenimiento SET rubro = 'infraestructura' WHERE rubro IN ('locativo', 'redes', 'mobiliario');
UPDATE gastos_mantenimiento SET rubro = 'equipo_general' WHERE rubro IN ('industrial', 'ti', 'flota');
