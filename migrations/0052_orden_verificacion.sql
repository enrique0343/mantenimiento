-- Opt-in on the next authenticated mutation. No historical state is rewritten.
CREATE TABLE orden_verificacion (
 orden_id INTEGER PRIMARY KEY REFERENCES ordenes(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
 ciclo INTEGER NOT NULL DEFAULT 1 CHECK(ciclo > 0),
 ejecutado_por INTEGER REFERENCES usuarios(id),
 executores_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(executores_json)),
 revisor_id INTEGER REFERENCES usuarios(id),
 revisor_suplente_id INTEGER REFERENCES usuarios(id),
 reprogramar_preventivos INTEGER NOT NULL DEFAULT 1 CHECK(reprogramar_preventivos IN (0,1)),
 pm_avanzado_en TEXT,
 ultimo_motivo TEXT,
 ultima_accion TEXT,
 ultimo_actor_id INTEGER REFERENCES usuarios(id),
 actualizado_en TEXT,
 operacion_id TEXT
);
CREATE TABLE orden_verificacion_eventos (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 orden_id INTEGER NOT NULL REFERENCES ordenes(id) ON DELETE RESTRICT,
 ciclo INTEGER NOT NULL,
 accion TEXT NOT NULL,
 estado_antes TEXT NOT NULL,
 estado_despues TEXT NOT NULL,
 actor_id INTEGER REFERENCES usuarios(id),
 actor_nombre TEXT NOT NULL,
 ocurrido_en TEXT NOT NULL,
 motivo TEXT,
 evidencia_json TEXT NOT NULL CHECK(json_valid(evidencia_json)),
 operacion_id TEXT NOT NULL UNIQUE
);
CREATE INDEX orden_verificacion_eventos_orden ON orden_verificacion_eventos(orden_id,id);
CREATE TRIGGER orden_verificacion_eventos_no_update BEFORE UPDATE ON orden_verificacion_eventos
BEGIN SELECT RAISE(ABORT,'El historial de verificación es inmutable'); END;
CREATE TRIGGER orden_verificacion_eventos_no_delete BEFORE DELETE ON orden_verificacion_eventos
BEGIN SELECT RAISE(ABORT,'El historial de verificación es inmutable'); END;
-- Evidence captured in any workflow snapshot remains available after return.
CREATE TRIGGER adjuntos_conservar_verificacion BEFORE DELETE ON adjuntos
WHEN EXISTS (
 SELECT 1 FROM orden_verificacion_eventos e, json_each(e.evidencia_json,'$.adjuntos') a
 WHERE e.orden_id=OLD.orden_id AND json_extract(a.value,'$.id')=OLD.id
)
BEGIN SELECT RAISE(ABORT,'El adjunto pertenece a evidencia inmutable de verificación'); END;
