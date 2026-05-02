import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const usuarios = sqliteTable("usuarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  nombre: text("nombre").notNull(),
  passwordHash: text("password_hash").notNull(),
  rol: text("rol", { enum: ["admin", "tecnico", "solicitante"] }).notNull().default("solicitante"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const activos = sqliteTable("activos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  descripcion: text("descripcion"),
  ubicacion: text("ubicacion"),
  estado: text("estado", { enum: ["operativo", "averiado", "mantenimiento", "baja"] })
    .notNull()
    .default("operativo"),
  // Identificacion fisica
  marca: text("marca"),
  modelo: text("modelo"),
  serial: text("serial"),
  anio: integer("anio"),
  categoria: text("categoria"),
  numeroActivo: text("numero_activo"),
  qrCode: text("qr_code").unique(),
  // Tipo de equipo
  tipo: text("tipo", { enum: ["general", "biomedico"] }).notNull().default("general"),
  // Campos biomedicos (solo aplican si tipo = 'biomedico')
  registroSanitario: text("registro_sanitario"),
  claseRiesgo: text("clase_riesgo", { enum: ["I", "IIa", "IIb", "III"] }),
  ultimaCalibracion: text("ultima_calibracion"),
  proximaCalibracion: text("proxima_calibracion"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ordenes = sqliteTable("ordenes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  titulo: text("titulo").notNull(),
  descripcion: text("descripcion"),
  tipo: text("tipo", { enum: ["preventivo", "correctivo"] }).notNull().default("correctivo"),
  prioridad: text("prioridad", { enum: ["baja", "media", "alta", "urgente"] })
    .notNull()
    .default("media"),
  estado: text("estado", { enum: ["abierta", "en_proceso", "completada", "cancelada"] })
    .notNull()
    .default("abierta"),
  activoId: integer("activo_id").references(() => activos.id),
  asignadoA: integer("asignado_a").references(() => usuarios.id),
  creadoPor: integer("creado_por").references(() => usuarios.id),
  planId: integer("plan_id").references((): any => planesMantenimiento.id),
  vencimiento: text("vencimiento"),
  completadaEn: text("completada_en"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const comentarios = sqliteTable("comentarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ordenId: integer("orden_id")
    .notNull()
    .references(() => ordenes.id, { onDelete: "cascade" }),
  usuarioId: integer("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  texto: text("texto").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const adjuntos = sqliteTable("adjuntos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ordenId: integer("orden_id")
    .notNull()
    .references(() => ordenes.id, { onDelete: "cascade" }),
  usuarioId: integer("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  nombre: text("nombre").notNull(),
  contentType: text("content_type").notNull(),
  tamano: integer("tamano").notNull(),
  r2Key: text("r2_key").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Planes de mantenimiento preventivo ──────────────────────────────────────
// Frecuencia define cada cuanto se debe ejecutar el mantenimiento.
// Cada dia el cron revisa planes con proximaFecha <= hoy y crea una orden.
export const planesMantenimiento = sqliteTable("planes_mantenimiento", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  activoId: integer("activo_id")
    .notNull()
    .references(() => activos.id, { onDelete: "cascade" }),
  titulo: text("titulo").notNull(),
  descripcion: text("descripcion"),
  frecuencia: text("frecuencia", {
    enum: ["diaria", "semanal", "quincenal", "mensual", "bimestral", "trimestral", "semestral", "anual"],
  }).notNull(),
  proximaFecha: text("proxima_fecha").notNull(),
  alertaDiasAntes: integer("alerta_dias_antes").notNull().default(7),
  prioridad: text("prioridad", { enum: ["baja", "media", "alta", "urgente"] })
    .notNull()
    .default("media"),
  horasEstimadas: real("horas_estimadas"),
  checklist: text("checklist"), // JSON: [{ texto, hecho }]
  asignadoA: integer("asignado_a").references(() => usuarios.id),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  ultimaGeneracion: text("ultima_generacion"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type Usuario = typeof usuarios.$inferSelect;
export type Activo = typeof activos.$inferSelect;
export type Orden = typeof ordenes.$inferSelect;
export type Comentario = typeof comentarios.$inferSelect;
export type Adjunto = typeof adjuntos.$inferSelect;
export type PlanMantenimiento = typeof planesMantenimiento.$inferSelect;
