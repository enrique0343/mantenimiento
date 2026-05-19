-- Fase 24: Full-Text Search (FTS5) sobre OTs, comentarios, tickets, equipos e items.
-- Tokenizer: unicode61 con remove_diacritics=2 (ignora acentos: "compresor" = "cómpresor")

-- ─── ordenes_fts ────────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS ordenes_fts USING fts5(
  titulo, descripcion, trabajos_realizados, causa_raiz, solucion_aplicada,
  content='ordenes', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO ordenes_fts(rowid, titulo, descripcion, trabajos_realizados, causa_raiz, solucion_aplicada)
  SELECT id, COALESCE(titulo,''), COALESCE(descripcion,''), COALESCE(trabajos_realizados,''),
         COALESCE(causa_raiz,''), COALESCE(solucion_aplicada,'')
  FROM ordenes;

CREATE TRIGGER IF NOT EXISTS ordenes_ai AFTER INSERT ON ordenes BEGIN
  INSERT INTO ordenes_fts(rowid, titulo, descripcion, trabajos_realizados, causa_raiz, solucion_aplicada)
  VALUES (new.id, COALESCE(new.titulo,''), COALESCE(new.descripcion,''), COALESCE(new.trabajos_realizados,''),
          COALESCE(new.causa_raiz,''), COALESCE(new.solucion_aplicada,''));
END;
CREATE TRIGGER IF NOT EXISTS ordenes_ad AFTER DELETE ON ordenes BEGIN
  INSERT INTO ordenes_fts(ordenes_fts, rowid, titulo, descripcion, trabajos_realizados, causa_raiz, solucion_aplicada)
  VALUES ('delete', old.id, COALESCE(old.titulo,''), COALESCE(old.descripcion,''), COALESCE(old.trabajos_realizados,''),
          COALESCE(old.causa_raiz,''), COALESCE(old.solucion_aplicada,''));
END;
CREATE TRIGGER IF NOT EXISTS ordenes_au AFTER UPDATE ON ordenes BEGIN
  INSERT INTO ordenes_fts(ordenes_fts, rowid, titulo, descripcion, trabajos_realizados, causa_raiz, solucion_aplicada)
  VALUES ('delete', old.id, COALESCE(old.titulo,''), COALESCE(old.descripcion,''), COALESCE(old.trabajos_realizados,''),
          COALESCE(old.causa_raiz,''), COALESCE(old.solucion_aplicada,''));
  INSERT INTO ordenes_fts(rowid, titulo, descripcion, trabajos_realizados, causa_raiz, solucion_aplicada)
  VALUES (new.id, COALESCE(new.titulo,''), COALESCE(new.descripcion,''), COALESCE(new.trabajos_realizados,''),
          COALESCE(new.causa_raiz,''), COALESCE(new.solucion_aplicada,''));
END;

-- ─── comentarios_fts ────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS comentarios_fts USING fts5(
  texto,
  content='comentarios', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO comentarios_fts(rowid, texto)
  SELECT id, COALESCE(texto,'') FROM comentarios;

CREATE TRIGGER IF NOT EXISTS comentarios_ai AFTER INSERT ON comentarios BEGIN
  INSERT INTO comentarios_fts(rowid, texto) VALUES (new.id, COALESCE(new.texto,''));
END;
CREATE TRIGGER IF NOT EXISTS comentarios_ad AFTER DELETE ON comentarios BEGIN
  INSERT INTO comentarios_fts(comentarios_fts, rowid, texto) VALUES ('delete', old.id, COALESCE(old.texto,''));
END;
CREATE TRIGGER IF NOT EXISTS comentarios_au AFTER UPDATE ON comentarios BEGIN
  INSERT INTO comentarios_fts(comentarios_fts, rowid, texto) VALUES ('delete', old.id, COALESCE(old.texto,''));
  INSERT INTO comentarios_fts(rowid, texto) VALUES (new.id, COALESCE(new.texto,''));
END;

-- ─── tickets_fts ────────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS tickets_fts USING fts5(
  asunto, descripcion, resolucion_notas, solicitante_nombre,
  content='tickets', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO tickets_fts(rowid, asunto, descripcion, resolucion_notas, solicitante_nombre)
  SELECT id, COALESCE(asunto,''), COALESCE(descripcion,''), COALESCE(resolucion_notas,''),
         COALESCE(solicitante_nombre,'')
  FROM tickets;

CREATE TRIGGER IF NOT EXISTS tickets_ai AFTER INSERT ON tickets BEGIN
  INSERT INTO tickets_fts(rowid, asunto, descripcion, resolucion_notas, solicitante_nombre)
  VALUES (new.id, COALESCE(new.asunto,''), COALESCE(new.descripcion,''), COALESCE(new.resolucion_notas,''),
          COALESCE(new.solicitante_nombre,''));
END;
CREATE TRIGGER IF NOT EXISTS tickets_ad AFTER DELETE ON tickets BEGIN
  INSERT INTO tickets_fts(tickets_fts, rowid, asunto, descripcion, resolucion_notas, solicitante_nombre)
  VALUES ('delete', old.id, COALESCE(old.asunto,''), COALESCE(old.descripcion,''), COALESCE(old.resolucion_notas,''),
          COALESCE(old.solicitante_nombre,''));
END;
CREATE TRIGGER IF NOT EXISTS tickets_au AFTER UPDATE ON tickets BEGIN
  INSERT INTO tickets_fts(tickets_fts, rowid, asunto, descripcion, resolucion_notas, solicitante_nombre)
  VALUES ('delete', old.id, COALESCE(old.asunto,''), COALESCE(old.descripcion,''), COALESCE(old.resolucion_notas,''),
          COALESCE(old.solicitante_nombre,''));
  INSERT INTO tickets_fts(rowid, asunto, descripcion, resolucion_notas, solicitante_nombre)
  VALUES (new.id, COALESCE(new.asunto,''), COALESCE(new.descripcion,''), COALESCE(new.resolucion_notas,''),
          COALESCE(new.solicitante_nombre,''));
END;

-- ─── activos_fts ────────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS activos_fts USING fts5(
  codigo, nombre, descripcion, marca, modelo, serial, categoria,
  content='activos', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO activos_fts(rowid, codigo, nombre, descripcion, marca, modelo, serial, categoria)
  SELECT id, COALESCE(codigo,''), COALESCE(nombre,''), COALESCE(descripcion,''),
         COALESCE(marca,''), COALESCE(modelo,''), COALESCE(serial,''), COALESCE(categoria,'')
  FROM activos;

CREATE TRIGGER IF NOT EXISTS activos_ai AFTER INSERT ON activos BEGIN
  INSERT INTO activos_fts(rowid, codigo, nombre, descripcion, marca, modelo, serial, categoria)
  VALUES (new.id, COALESCE(new.codigo,''), COALESCE(new.nombre,''), COALESCE(new.descripcion,''),
          COALESCE(new.marca,''), COALESCE(new.modelo,''), COALESCE(new.serial,''), COALESCE(new.categoria,''));
END;
CREATE TRIGGER IF NOT EXISTS activos_ad AFTER DELETE ON activos BEGIN
  INSERT INTO activos_fts(activos_fts, rowid, codigo, nombre, descripcion, marca, modelo, serial, categoria)
  VALUES ('delete', old.id, COALESCE(old.codigo,''), COALESCE(old.nombre,''), COALESCE(old.descripcion,''),
          COALESCE(old.marca,''), COALESCE(old.modelo,''), COALESCE(old.serial,''), COALESCE(old.categoria,''));
END;
CREATE TRIGGER IF NOT EXISTS activos_au AFTER UPDATE ON activos BEGIN
  INSERT INTO activos_fts(activos_fts, rowid, codigo, nombre, descripcion, marca, modelo, serial, categoria)
  VALUES ('delete', old.id, COALESCE(old.codigo,''), COALESCE(old.nombre,''), COALESCE(old.descripcion,''),
          COALESCE(old.marca,''), COALESCE(old.modelo,''), COALESCE(old.serial,''), COALESCE(old.categoria,''));
  INSERT INTO activos_fts(rowid, codigo, nombre, descripcion, marca, modelo, serial, categoria)
  VALUES (new.id, COALESCE(new.codigo,''), COALESCE(new.nombre,''), COALESCE(new.descripcion,''),
          COALESCE(new.marca,''), COALESCE(new.modelo,''), COALESCE(new.serial,''), COALESCE(new.categoria,''));
END;

-- ─── items_fts ──────────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  codigo, nombre, descripcion, categoria,
  content='items', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO items_fts(rowid, codigo, nombre, descripcion, categoria)
  SELECT id, COALESCE(codigo,''), COALESCE(nombre,''), COALESCE(descripcion,''), COALESCE(categoria,'')
  FROM items;

CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, codigo, nombre, descripcion, categoria)
  VALUES (new.id, COALESCE(new.codigo,''), COALESCE(new.nombre,''), COALESCE(new.descripcion,''), COALESCE(new.categoria,''));
END;
CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, codigo, nombre, descripcion, categoria)
  VALUES ('delete', old.id, COALESCE(old.codigo,''), COALESCE(old.nombre,''), COALESCE(old.descripcion,''), COALESCE(old.categoria,''));
END;
CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, codigo, nombre, descripcion, categoria)
  VALUES ('delete', old.id, COALESCE(old.codigo,''), COALESCE(old.nombre,''), COALESCE(old.descripcion,''), COALESCE(old.categoria,''));
  INSERT INTO items_fts(rowid, codigo, nombre, descripcion, categoria)
  VALUES (new.id, COALESCE(new.codigo,''), COALESCE(new.nombre,''), COALESCE(new.descripcion,''), COALESCE(new.categoria,''));
END;
