-- Fase 54: Modo técnico. Lo que el celular captura y el reporte de mantenimiento lee.
--
-- orden_paso_marcas: una fila por cada vez que el técnico marca un paso, con la
-- hora real en el celular (ocurrido_en) y la hora en que llegó al servidor
-- (recibido_en). Si difieren, se capturó sin señal y se envió después. Es
-- solo-agregar: corregir un paso deja la marca anterior a la vista.
--
-- campo_operaciones: cada operación enviada desde el celular lleva un
-- identificador propio. Si la red corta la respuesta y el celular reintenta, el
-- servidor reconoce la operación y no la aplica dos veces. Si una regla la
-- rechaza, payload conserva lo que el técnico capturó: no se pierde su trabajo.

CREATE TABLE orden_paso_marcas (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  orden_id integer NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  paso_idx integer NOT NULL,
  paso_texto text NOT NULL,
  estado text NOT NULL,
  valor text,
  nota text,
  ocurrido_en text NOT NULL,
  recibido_en text NOT NULL,
  sin_senal integer NOT NULL DEFAULT 0,
  usuario_id integer REFERENCES usuarios(id),
  op_id text
);
CREATE INDEX idx_paso_marcas_orden ON orden_paso_marcas(orden_id, ocurrido_en);

CREATE TABLE campo_operaciones (
  op_id text PRIMARY KEY NOT NULL,
  usuario_id integer NOT NULL REFERENCES usuarios(id),
  tipo text NOT NULL,
  orden_id integer,
  capturado_en text NOT NULL,
  recibido_en text NOT NULL,
  resultado text NOT NULL,
  detalle text,
  payload text
);
CREATE INDEX idx_campo_ops_usuario ON campo_operaciones(usuario_id, recibido_en);

-- Sistema Visual Avante: sin emojis. Las categorías de actividades guardaban uno.
UPDATE actividad_categorias SET icono = NULL WHERE icono IS NOT NULL;
