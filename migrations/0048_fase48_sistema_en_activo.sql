-- Fase 48: el equipo declara a que sistema critico pertenece.
-- Es la llave que permite al sistema responder, cuando algo falla, "esto se
-- rige por EOP-ELE-01" sin que nadie busque el documento.
-- procedimientos.sistema ya usa este vocabulario; activos.rubro usa otro
-- (dominio del plan maestro), por eso hace falta la columna propia.

ALTER TABLE activos ADD COLUMN sistema text;   -- electrico | hvac | gases | agua | incendios | ascensores | otro
CREATE INDEX idx_activos_sistema ON activos(sistema);

-- Backfill por palabras clave del nombre y la categoria. Lo que no se pueda
-- inferir queda NULL y el resolver lo deduce por jerarquia o por rubro.
UPDATE activos SET sistema = 'electrico' WHERE sistema IS NULL AND (
  lower(nombre) LIKE '%planta electr%' OR lower(nombre) LIKE '%generador%' OR
  lower(nombre) LIKE '%tablero%'      OR lower(nombre) LIKE '%transferencia%' OR
  lower(nombre) LIKE '%ats%'          OR lower(nombre) LIKE '%ups%' OR
  lower(nombre) LIKE '%subestacion%'  OR lower(nombre) LIKE '%subestación%' OR
  lower(nombre) LIKE '%transformador%'
);
UPDATE activos SET sistema = 'hvac' WHERE sistema IS NULL AND (
  lower(nombre) LIKE '%aire acond%' OR lower(nombre) LIKE '%minisplit%' OR
  lower(nombre) LIKE '%mini split%' OR lower(nombre) LIKE '%split%' OR
  lower(nombre) LIKE '%chiller%'    OR lower(nombre) LIKE '%manejadora%' OR
  lower(nombre) LIKE '%uma%'        OR lower(nombre) LIKE '%fan coil%' OR
  lower(nombre) LIKE '%extractor%'  OR lower(coalesce(categoria,'')) LIKE '%clima%'
);
UPDATE activos SET sistema = 'gases' WHERE sistema IS NULL AND (
  lower(nombre) LIKE '%oxigeno%'  OR lower(nombre) LIKE '%oxígeno%' OR
  lower(nombre) LIKE '%manifold%' OR lower(nombre) LIKE '%vacio%' OR
  lower(nombre) LIKE '%vacío%'    OR lower(nombre) LIKE '%aire medicinal%' OR
  lower(nombre) LIKE '%criogenic%' OR lower(nombre) LIKE '%compresor medic%'
);
UPDATE activos SET sistema = 'agua' WHERE sistema IS NULL AND (
  lower(nombre) LIKE '%cisterna%' OR lower(nombre) LIKE '%tanque de agua%' OR
  lower(nombre) LIKE '%hidroneum%' OR lower(nombre) LIKE '%bomba de agua%' OR
  lower(nombre) LIKE '%ablandador%' OR lower(nombre) LIKE '%osmosis%'
);
UPDATE activos SET sistema = 'incendios' WHERE sistema IS NULL AND (
  lower(nombre) LIKE '%extintor%' OR lower(nombre) LIKE '%rociador%' OR
  lower(nombre) LIKE '%sprinkler%' OR lower(nombre) LIKE '%alarma de incend%' OR
  lower(nombre) LIKE '%bomba contra incend%' OR lower(nombre) LIKE '%detector de humo%'
);
UPDATE activos SET sistema = 'ascensores' WHERE sistema IS NULL AND (
  lower(nombre) LIKE '%ascensor%' OR lower(nombre) LIKE '%elevador%' OR
  lower(nombre) LIKE '%montacarga%'
);
