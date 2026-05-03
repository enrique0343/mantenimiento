import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const ROLES = ["admin", "jefe", "tecnico", "proveedor", "solicitante", "visualizador"] as const;
export type Rol = (typeof ROLES)[number];

// ─── Empresa (singleton id=1) ─────────────────────────────────────────────────
export const empresa = sqliteTable("empresa", {
  id: integer("id").primaryKey().default(1),
  nombre: text("nombre").notNull().default("Mi Empresa"),
  nit: text("nit"),
  logoR2Key: text("logo_r2_key"),
  pais: text("pais").default("SV"),
  moneda: text("moneda").default("USD"),
  telefono: text("telefono"),
  direccion: text("direccion"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Sucursales ───────────────────────────────────────────────────────────────
export const sucursales = sqliteTable("sucursales", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nombre: text("nombre").notNull(),
  codigo: text("codigo"),
  direccion: text("direccion"),
  telefono: text("telefono"),
  activa: integer("activa", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Ubicaciones (árbol: sucursal > edificio > piso > área) ──────────────────
export const ubicaciones = sqliteTable("ubicaciones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sucursalId: integer("sucursal_id")
    .notNull()
    .references(() => sucursales.id, { onDelete: "cascade" }),
  nombre: text("nombre").notNull(),
  tipo: text("tipo", { enum: ["edificio", "piso", "area", "sala"] }).notNull().default("area"),
  padreId: integer("padre_id"),
  activa: integer("activa", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Proveedores ──────────────────────────────────────────────────────────────
export const proveedores = sqliteTable("proveedores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nombre: text("nombre").notNull(),
  nit: text("nit"),
  contacto: text("contacto"),
  telefono: text("telefono"),
  email: text("email"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  notas: text("notas"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Usuarios ─────────────────────────────────────────────────────────────────
export const usuarios = sqliteTable("usuarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  nombre: text("nombre").notNull(),
  passwordHash: text("password_hash").notNull(),
  rol: text("rol", { enum: ROLES }).notNull().default("solicitante"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  sucursalId: integer("sucursal_id").references(() => sucursales.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Activos / Equipos ────────────────────────────────────────────────────────
export const activos = sqliteTable("activos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  descripcion: text("descripcion"),
  ubicacion: text("ubicacion"),
  ubicacionId: integer("ubicacion_id").references(() => ubicaciones.id),
  proveedorId: integer("proveedor_id").references(() => proveedores.id),
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
  // Campos biomedicos
  registroSanitario: text("registro_sanitario"),
  claseRiesgo: text("clase_riesgo", { enum: ["I", "IIa", "IIb", "III"] }),
  ultimaCalibracion: text("ultima_calibracion"),
  proximaCalibracion: text("proxima_calibracion"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Órdenes de trabajo ───────────────────────────────────────────────────────
export const ordenes = sqliteTable("ordenes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  titulo: text("titulo").notNull(),
  descripcion: text("descripcion"),
  tipo: text("tipo", { enum: ["preventivo", "correctivo", "predictivo"] }).notNull().default("correctivo"),
  prioridad: text("prioridad", { enum: ["baja", "media", "alta", "urgente"] })
    .notNull()
    .default("media"),
  estado: text("estado", {
    enum: ["abierta", "en_proceso", "completada", "verificada", "cerrada", "cancelada"],
  })
    .notNull()
    .default("abierta"),
  activoId: integer("activo_id").references(() => activos.id),
  asignadoA: integer("asignado_a").references(() => usuarios.id),
  creadoPor: integer("creado_por").references(() => usuarios.id),
  planId: integer("plan_id").references((): any => planesMantenimiento.id),
  vencimiento: text("vencimiento"),
  completadaEn: text("completada_en"),
  // Ejecucion
  trabajosRealizados: text("trabajos_realizados"),
  causaRaiz: text("causa_raiz"),
  solucionAplicada: text("solucion_aplicada"),
  horasTrabajadas: real("horas_trabajadas"),
  checklistEjecucion: text("checklist_ejecucion"), // JSON: [{texto,hecho,notas}]
  // Verificacion + cierre
  verificadoPor: integer("verificado_por").references(() => usuarios.id),
  verificadoEn: text("verificado_en"),
  verificacionNotas: text("verificacion_notas"),
  cerradoPor: integer("cerrado_por").references(() => usuarios.id),
  cerradoEn: text("cerrado_en"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Comentarios ──────────────────────────────────────────────────────────────
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

// ─── Adjuntos ─────────────────────────────────────────────────────────────────
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
  categoria: text("categoria", { enum: ["antes", "despues", "documento", "general"] })
    .notNull()
    .default("general"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Inventario ──────────────────────────────────────────────────────────────
export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  descripcion: text("descripcion"),
  categoria: text("categoria"),
  unidad: text("unidad").notNull().default("unidad"),
  stockMinimo: real("stock_minimo").notNull().default(0),
  proveedorPrincipalId: integer("proveedor_principal_id").references(() => proveedores.id),
  precioReferencia: real("precio_referencia"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const stock = sqliteTable("stock", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  sucursalId: integer("sucursal_id").notNull().references(() => sucursales.id, { onDelete: "cascade" }),
  cantidad: real("cantidad").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const movimientosInventario = sqliteTable("movimientos_inventario", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").notNull().references(() => items.id),
  sucursalId: integer("sucursal_id").notNull().references(() => sucursales.id),
  tipo: text("tipo", { enum: ["entrada", "salida", "ajuste"] }).notNull(),
  cantidad: real("cantidad").notNull(),
  motivo: text("motivo"),
  referencia: text("referencia"),
  ordenId: integer("orden_id").references(() => ordenes.id),
  recepcionId: integer("recepcion_id"),
  usuarioId: integer("usuario_id").references(() => usuarios.id),
  notas: text("notas"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const recepciones = sqliteTable("recepciones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  proveedorId: integer("proveedor_id").references(() => proveedores.id),
  sucursalId: integer("sucursal_id").notNull().references(() => sucursales.id),
  numeroFactura: text("numero_factura"),
  fecha: text("fecha").notNull(),
  total: real("total"),
  notas: text("notas"),
  recibidoPor: integer("recibido_por").references(() => usuarios.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const recepcionItems = sqliteTable("recepcion_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recepcionId: integer("recepcion_id").notNull().references(() => recepciones.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull().references(() => items.id),
  cantidad: real("cantidad").notNull(),
  precioUnitario: real("precio_unitario"),
});

export const ordenRepuestos = sqliteTable("orden_repuestos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ordenId: integer("orden_id").notNull().references(() => ordenes.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull().references(() => items.id),
  sucursalId: integer("sucursal_id").notNull().references(() => sucursales.id),
  cantidad: real("cantidad").notNull(),
  precioUnitario: real("precio_unitario"),
  notas: text("notas"),
  registradoPor: integer("registrado_por").references(() => usuarios.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Planes de mantenimiento preventivo ──────────────────────────────────────
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
  checklist: text("checklist"),
  asignadoA: integer("asignado_a").references(() => usuarios.id),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  ultimaGeneracion: text("ultima_generacion"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Types ────────────────────────────────────────────────────────────────────
export type Empresa = typeof empresa.$inferSelect;
export type Sucursal = typeof sucursales.$inferSelect;
export type Ubicacion = typeof ubicaciones.$inferSelect;
export type Proveedor = typeof proveedores.$inferSelect;
export type Usuario = typeof usuarios.$inferSelect;
export type Activo = typeof activos.$inferSelect;
export type Orden = typeof ordenes.$inferSelect;
export type Comentario = typeof comentarios.$inferSelect;
export type Adjunto = typeof adjuntos.$inferSelect;
export type PlanMantenimiento = typeof planesMantenimiento.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Stock = typeof stock.$inferSelect;
export type MovimientoInventario = typeof movimientosInventario.$inferSelect;
export type Recepcion = typeof recepciones.$inferSelect;
export type RecepcionItem = typeof recepcionItems.$inferSelect;
export type OrdenRepuesto = typeof ordenRepuestos.$inferSelect;
