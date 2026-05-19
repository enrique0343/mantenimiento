-- Destinatarios fijos de solicitudes de compra (configurados por admin)
CREATE TABLE IF NOT EXISTS compras_destinatarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  telefono TEXT,
  cargo TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cabecera de la solicitud de compra
CREATE TABLE IF NOT EXISTS solicitudes_compra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador', -- borrador | enviada | comprada | rechazada | cancelada
  orden_id INTEGER REFERENCES ordenes(id) ON DELETE SET NULL,
  creado_por INTEGER NOT NULL REFERENCES usuarios(id),
  autorizado_por INTEGER REFERENCES usuarios(id),
  autorizado_en TEXT,
  completado_por INTEGER REFERENCES usuarios(id),
  completado_en TEXT,
  notas_autorizacion TEXT,
  notas_resultado TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Líneas (ítems) de la solicitud
CREATE TABLE IF NOT EXISTS solicitud_compra_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL REFERENCES solicitudes_compra(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  cantidad REAL NOT NULL DEFAULT 1,
  unidad TEXT,
  notas TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Adjuntos de la solicitud (fotos de referencia, copiadas de la OT o subidas directamente)
CREATE TABLE IF NOT EXISTS solicitud_compra_adjuntos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL REFERENCES solicitudes_compra(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  content_type TEXT NOT NULL,
  tamano INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Envíos: un registro por destinatario por envío masivo (token único)
CREATE TABLE IF NOT EXISTS solicitud_compra_envios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL REFERENCES solicitudes_compra(id) ON DELETE CASCADE,
  destinatario_id INTEGER REFERENCES compras_destinatarios(id),
  destinatario_email TEXT NOT NULL,
  destinatario_nombre TEXT,
  token TEXT NOT NULL UNIQUE,
  enviado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Registro de descargas del PDF (IP + user-agent + timestamp)
CREATE TABLE IF NOT EXISTS solicitud_compra_descargas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envio_id INTEGER NOT NULL REFERENCES solicitud_compra_envios(id) ON DELETE CASCADE,
  ip TEXT,
  user_agent TEXT,
  descargado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
