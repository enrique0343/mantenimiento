CREATE TABLE `usuarios` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `email` text NOT NULL UNIQUE,
  `nombre` text NOT NULL,
  `password_hash` text NOT NULL,
  `rol` text DEFAULT 'solicitante' NOT NULL,
  `activo` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `activos` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `codigo` text NOT NULL UNIQUE,
  `nombre` text NOT NULL,
  `descripcion` text,
  `ubicacion` text,
  `estado` text DEFAULT 'operativo' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `ordenes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `titulo` text NOT NULL,
  `descripcion` text,
  `tipo` text DEFAULT 'correctivo' NOT NULL,
  `prioridad` text DEFAULT 'media' NOT NULL,
  `estado` text DEFAULT 'abierta' NOT NULL,
  `activo_id` integer REFERENCES activos(id),
  `asignado_a` integer REFERENCES usuarios(id),
  `creado_por` integer NOT NULL REFERENCES usuarios(id),
  `vencimiento` text,
  `completada_en` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `comentarios` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `orden_id` integer NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  `usuario_id` integer NOT NULL REFERENCES usuarios(id),
  `texto` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `adjuntos` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `orden_id` integer NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  `usuario_id` integer NOT NULL REFERENCES usuarios(id),
  `nombre` text NOT NULL,
  `content_type` text NOT NULL,
  `tamano` integer NOT NULL,
  `r2_key` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX `idx_ordenes_estado` ON `ordenes` (`estado`);
CREATE INDEX `idx_ordenes_asignado` ON `ordenes` (`asignado_a`);
CREATE INDEX `idx_ordenes_activo` ON `ordenes` (`activo_id`);
CREATE INDEX `idx_comentarios_orden` ON `comentarios` (`orden_id`);
CREATE INDEX `idx_adjuntos_orden` ON `adjuntos` (`orden_id`);
