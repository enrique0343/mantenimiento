import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const ROLES = ["admin", "jefe", "tecnico", "proveedor", "solicitante", "visualizador", "motorista"] as const;
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
  vehiculoId: integer("vehiculo_id").references((): any => vehiculos.id),
  actividadId: integer("actividad_id").references((): any => actividades.id),
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
  // Firmas digitales (Fase 10)
  firmaTecnicoR2: text("firma_tecnico_r2"),
  firmaTecnicoNombre: text("firma_tecnico_nombre"),
  firmaTecnicoFecha: text("firma_tecnico_fecha"),
  firmaJefeR2: text("firma_jefe_r2"),
  firmaJefeNombre: text("firma_jefe_nombre"),
  firmaJefeFecha: text("firma_jefe_fecha"),
  firmaSolicitanteR2: text("firma_solicitante_r2"),
  firmaSolicitanteNombre: text("firma_solicitante_nombre"),
  firmaSolicitanteFecha: text("firma_solicitante_fecha"),
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

// ─── Helpdesk ────────────────────────────────────────────────────────────────
export const tickets = sqliteTable("tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trackingToken: text("tracking_token").notNull().unique(),
  solicitanteNombre: text("solicitante_nombre").notNull(),
  solicitanteEmail: text("solicitante_email").notNull(),
  solicitanteTelefono: text("solicitante_telefono"),
  solicitanteUsuarioId: integer("solicitante_usuario_id").references(() => usuarios.id),
  asunto: text("asunto").notNull(),
  descripcion: text("descripcion").notNull(),
  prioridad: text("prioridad", { enum: ["baja", "media", "alta", "urgente"] }).notNull().default("media"),
  sucursalId: integer("sucursal_id").references(() => sucursales.id),
  ubicacionId: integer("ubicacion_id").references(() => ubicaciones.id),
  ubicacion: text("ubicacion"),
  activoId: integer("activo_id").references(() => activos.id),
  estado: text("estado", { enum: ["nuevo", "asignado", "en_proceso", "resuelto", "cerrado", "descartado"] })
    .notNull().default("nuevo"),
  slaHoras: integer("sla_horas"),
  vencimientoSla: text("vencimiento_sla"),
  asignadoA: integer("asignado_a").references(() => usuarios.id),
  otId: integer("ot_id").references(() => ordenes.id),
  resueltoEn: text("resuelto_en"),
  resolucionNotas: text("resolucion_notas"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── Predictivo ──────────────────────────────────────────────────────────────
export const variablesPredictivas = sqliteTable("variables_predictivas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  activoId: integer("activo_id").notNull().references(() => activos.id, { onDelete: "cascade" }),
  nombre: text("nombre").notNull(),
  unidad: text("unidad"),
  minCritico: real("min_critico"),
  minWarning: real("min_warning"),
  maxWarning: real("max_warning"),
  maxCritico: real("max_critico"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  notas: text("notas"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const emailLog = sqliteTable("email_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  destinatario: text("destinatario").notNull(),
  asunto: text("asunto").notNull(),
  tipo: text("tipo"),
  referencia: text("referencia"),
  estado: text("estado", { enum: ["enviado", "error"] }).notNull().default("enviado"),
  error: text("error"),
  enviadoPor: integer("enviado_por").references(() => usuarios.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mediciones = sqliteTable("mediciones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  variableId: integer("variable_id").notNull().references(() => variablesPredictivas.id, { onDelete: "cascade" }),
  valor: real("valor").notNull(),
  fecha: text("fecha").notNull().default(sql`CURRENT_TIMESTAMP`),
  estadoAlerta: text("estado_alerta"),
  usuarioId: integer("usuario_id").references(() => usuarios.id),
  notas: text("notas"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ticketComentarios = sqliteTable("ticket_comentarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: integer("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  usuarioId: integer("usuario_id").references(() => usuarios.id),
  autorExterno: text("autor_externo"),
  texto: text("texto").notNull(),
  publico: integer("publico", { mode: "boolean" }).notNull().default(true),
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
export type Ticket = typeof tickets.$inferSelect;
export type TicketComentario = typeof ticketComentarios.$inferSelect;
export type VariablePredictiva = typeof variablesPredictivas.$inferSelect;
export type Medicion = typeof mediciones.$inferSelect;

// ─── Flota ───────────────────────────────────────────────────────────────────
export const vehiculos = sqliteTable("vehiculos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codigo: text("codigo").notNull().unique(),
  placa: text("placa").notNull().unique(),
  marca: text("marca").notNull(),
  modelo: text("modelo").notNull(),
  anio: integer("anio"),
  color: text("color"),
  vin: text("vin"),
  tipo: text("tipo", { enum: ["carro", "pickup", "moto", "camion", "microbus", "otro"] }).notNull().default("carro"),
  combustible: text("combustible", { enum: ["gasolina", "diesel", "electrico", "hibrido"] }).notNull().default("gasolina"),
  capacidadTanque: real("capacidad_tanque"),
  kilometrajeActual: real("kilometraje_actual").notNull().default(0),
  fotoR2: text("foto_r2"),
  qrToken: text("qr_token").notNull().unique(),
  estado: text("estado", { enum: ["disponible", "en_viaje", "mantenimiento", "baja"] }).notNull().default("disponible"),
  notas: text("notas"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const vehiculoDocumentos = sqliteTable("vehiculo_documentos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vehiculoId: integer("vehiculo_id").notNull().references(() => vehiculos.id, { onDelete: "cascade" }),
  tipo: text("tipo", { enum: ["tarjeta_circulacion", "seguro", "revision_tecnica", "otro"] }).notNull(),
  numero: text("numero"),
  vencimiento: text("vencimiento"),
  r2Key: text("r2_key"),
  notas: text("notas"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const viajePropositos = sqliteTable("viaje_propositos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nombre: text("nombre").notNull().unique(),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  orden: integer("orden").notNull().default(0),
});

export const viajes = sqliteTable("viajes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vehiculoId: integer("vehiculo_id").notNull().references(() => vehiculos.id),
  motoristaId: integer("motorista_id").notNull().references(() => usuarios.id),
  propositoId: integer("proposito_id").references(() => viajePropositos.id),
  destino: text("destino"),
  notas: text("notas"),
  kmInicial: real("km_inicial").notNull(),
  kmFinal: real("km_final"),
  kmRecorrido: real("km_recorrido"),
  inicio: text("inicio").notNull().default(sql`CURRENT_TIMESTAMP`),
  fin: text("fin"),
  duracionMin: integer("duracion_min"),
  inicioLat: real("inicio_lat"),
  inicioLng: real("inicio_lng"),
  finLat: real("fin_lat"),
  finLng: real("fin_lng"),
  distanciaGpsKm: real("distancia_gps_km"),
  fotoOdometroInicioR2: text("foto_odometro_inicio_r2"),
  fotoOdometroFinR2: text("foto_odometro_fin_r2"),
  estado: text("estado", { enum: ["en_curso", "finalizado", "cancelado"] }).notNull().default("en_curso"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const cargasCombustible = sqliteTable("cargas_combustible", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vehiculoId: integer("vehiculo_id").notNull().references(() => vehiculos.id),
  motoristaId: integer("motorista_id").references(() => usuarios.id),
  fecha: text("fecha").notNull().default(sql`CURRENT_TIMESTAMP`),
  litros: real("litros").notNull(),
  monto: real("monto").notNull(),
  precioLitro: real("precio_litro"),
  kmAlCargar: real("km_al_cargar"),
  estacion: text("estacion"),
  reciboR2: text("recibo_r2"),
  notas: text("notas"),
});

export const planesVehiculo = sqliteTable("planes_vehiculo", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vehiculoId: integer("vehiculo_id").notNull().references(() => vehiculos.id, { onDelete: "cascade" }),
  titulo: text("titulo").notNull(),
  descripcion: text("descripcion"),
  kmIntervalo: real("km_intervalo"),
  kmProximo: real("km_proximo"),
  frecuenciaMeses: integer("frecuencia_meses"),
  proximaFecha: text("proxima_fecha"),
  prioridad: text("prioridad", { enum: ["baja", "media", "alta", "urgente"] }).notNull().default("media"),
  asignadoA: integer("asignado_a").references(() => usuarios.id),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  ultimaGeneracion: text("ultima_generacion"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type Vehiculo = typeof vehiculos.$inferSelect;
export type VehiculoDocumento = typeof vehiculoDocumentos.$inferSelect;
export type ViajePropozito = typeof viajePropositos.$inferSelect;
export type Viaje = typeof viajes.$inferSelect;
export type CargaCombustible = typeof cargasCombustible.$inferSelect;
export type PlanVehiculo = typeof planesVehiculo.$inferSelect;

// ─── Seguridad: Extintores ────────────────────────────────────────────────────
export const extintores = sqliteTable("extintores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codigo: text("codigo").notNull().unique(),
  numeroSerie: text("numero_serie"),
  marca: text("marca"),
  modelo: text("modelo"),
  fotoR2: text("foto_r2"),
  tipoAgente: text("tipo_agente", { enum: ["pqs", "co2", "agua", "espuma", "k", "d"] }).notNull(),
  capacidad: real("capacidad"),
  capacidadUnidad: text("capacidad_unidad", { enum: ["kg", "lb"] }).default("kg"),
  sucursalId: integer("sucursal_id").notNull().references(() => sucursales.id),
  ubicacionId: integer("ubicacion_id").references(() => ubicaciones.id),
  ubicacionDetalle: text("ubicacion_detalle"),
  zona: text("zona"),
  fechaFabricacion: text("fecha_fabricacion"),
  fechaCompra: text("fecha_compra"),
  ultimaRecarga: text("ultima_recarga"),
  proximaRecarga: text("proxima_recarga"),
  ultimaPruebaHidrostatica: text("ultima_prueba_hidrostatica"),
  proximaPruebaHidrostatica: text("proxima_prueba_hidrostatica"),
  ultimaInspeccion: text("ultima_inspeccion"),
  proximaInspeccion: text("proxima_inspeccion"),
  diasInspeccion: integer("dias_inspeccion").notNull().default(30),
  mesesRecarga: integer("meses_recarga").notNull().default(12),
  aniosPrueba: integer("anios_prueba").notNull().default(5),
  estado: text("estado", { enum: ["activo", "mantenimiento", "baja"] }).notNull().default("activo"),
  qrToken: text("qr_token").notNull().unique(),
  notas: text("notas"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const extintorEventos = sqliteTable("extintor_eventos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  extintorId: integer("extintor_id").notNull().references(() => extintores.id, { onDelete: "cascade" }),
  tipo: text("tipo", { enum: ["inspeccion", "recarga", "prueba_hidrostatica", "reemplazo", "baja", "otro"] }).notNull(),
  fecha: text("fecha").notNull(),
  proximaFecha: text("proxima_fecha"),
  responsableId: integer("responsable_id").references(() => usuarios.id),
  proveedorId: integer("proveedor_id").references(() => proveedores.id),
  costo: real("costo"),
  notas: text("notas"),
  evidenciaR2: text("evidencia_r2"),
  otId: integer("ot_id").references(() => ordenes.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type Extintor = typeof extintores.$inferSelect;
export type ExtintorEvento = typeof extintorEventos.$inferSelect;

// ─── Actividades recurrentes ─────────────────────────────────────────────────
export const actividadCategorias = sqliteTable("actividad_categorias", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nombre: text("nombre").notNull().unique(),
  icono: text("icono"),
  orden: integer("orden").notNull().default(0),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
});

export const actividades = sqliteTable("actividades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codigo: text("codigo").notNull().unique(),
  titulo: text("titulo").notNull(),
  descripcion: text("descripcion"),
  categoriaId: integer("categoria_id").references(() => actividadCategorias.id),
  sucursalId: integer("sucursal_id").references(() => sucursales.id),
  ubicacionId: integer("ubicacion_id").references(() => ubicaciones.id),
  ubicacionDetalle: text("ubicacion_detalle"),
  frecuencia: text("frecuencia", {
    enum: ["diaria", "semanal", "quincenal", "mensual", "bimestral", "trimestral", "semestral", "anual"],
  }).notNull(),
  proximaFecha: text("proxima_fecha").notNull(),
  alertaDiasAntes: integer("alerta_dias_antes").notNull().default(7),
  prioridad: text("prioridad", { enum: ["baja", "media", "alta", "urgente"] }).notNull().default("media"),
  horasEstimadas: real("horas_estimadas"),
  checklist: text("checklist"),
  asignadoA: integer("asignado_a").references(() => usuarios.id),
  proveedorExternoId: integer("proveedor_externo_id").references(() => proveedores.id),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  ultimaGeneracion: text("ultima_generacion"),
  ultimaEjecucion: text("ultima_ejecucion"),
  notas: text("notas"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type ActividadCategoria = typeof actividadCategorias.$inferSelect;
export type Actividad = typeof actividades.$inferSelect;

// ─── Encuestas de satisfacción ───────────────────────────────────────────────
export const encuestasSatisfaccion = sqliteTable("encuestas_satisfaccion", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ordenId: integer("orden_id").references(() => ordenes.id, { onDelete: "cascade" }),
  ticketId: integer("ticket_id").references(() => tickets.id, { onDelete: "set null" }),
  token: text("token").notNull().unique(),
  destinatarioEmail: text("destinatario_email").notNull(),
  destinatarioNombre: text("destinatario_nombre"),
  calificacion: integer("calificacion"),
  comentario: text("comentario"),
  respondidaEn: text("respondida_en"),
  enviadaEn: text("enviada_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  recordatorioEnviadoEn: text("recordatorio_enviado_en"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export type EncuestaSatisfaccion = typeof encuestasSatisfaccion.$inferSelect;

// ─── Audit log ───────────────────────────────────────────────────────────────
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entidad: text("entidad").notNull(),
  entidadId: integer("entidad_id").notNull(),
  accion: text("accion").notNull(),
  usuarioId: integer("usuario_id").references(() => usuarios.id),
  cambios: text("cambios"),
  resumen: text("resumen"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export type AuditLog = typeof auditLog.$inferSelect;
