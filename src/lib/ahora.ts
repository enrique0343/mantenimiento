// ─── «Ahora mismo» · la cadena de los cinco documentos, en estado presente ───
//
// El volumen GO-GUI-011-2026 define cinco documentos que se encadenan. Esta
// función los convierte en cinco preguntas con respuesta numérica, para que el
// técnico, el jefe y el administrador abran el sistema y en cinco segundos
// sepan qué está pasando y qué hay que hacer:
//
//   SOP · ¿se hizo la ronda de este turno?
//   AOP · ¿hay alguna lectura fuera de rango con el reloj corriendo?
//   EOP · ¿hay algo ya fallado ahora mismo?
//   MOP · ¿hay una intervención que no puede arrancar porque falta un permiso?
//   SCP · ¿qué equipos todavía no están gobernados por ningún documento?
//
// El mismo cálculo alimenta el panel del técnico y el tablero de la jefatura;
// lo único que cambia es el alcance (su sede y sus órdenes, o todas).
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { ESTADOS_AOP_ABIERTOS, cronometro, fmtCuentaRegresiva } from "./aop";
import { inferirSistema, SISTEMA_LABEL, type Sistema } from "./resolver";
import {
  parsearTurnos,
  resumenTablero,
  tableroRondas,
  turnoActual,
  etiquetaTurno,
  type FilaTablero,
} from "./rondas";
import {
  activos,
  aopEventos,
  eopFicha,
  ordenPrerrequisitos,
  ordenes,
  procedimientos,
  rondas,
  sucursales,
  ubicaciones,
} from "./schema";

type Db = ReturnType<typeof getDb>;

export type Tono = "ok" | "atencion" | "urgente" | "vacio";

export const TONO: Record<Tono, { borde: string; punto: string; badge: string; numero: string }> = {
  ok:       { borde: "border-emerald-500", punto: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700", numero: "text-emerald-600" },
  atencion: { borde: "border-amber-400",   punto: "bg-amber-500",   badge: "bg-amber-100 text-amber-700",     numero: "text-amber-600" },
  urgente:  { borde: "border-red-500",     punto: "bg-red-500",     badge: "bg-red-100 text-red-700",         numero: "text-red-600" },
  vacio:    { borde: "border-slate-200",   punto: "bg-slate-300",   badge: "bg-slate-100 text-slate-500",     numero: "text-slate-400" },
};

export interface ItemAhora {
  texto: string;
  meta: string;
  href: string;
  tono: Tono;
}

export interface BloqueAhora {
  doc: "SOP" | "AOP" | "EOP" | "MOP" | "SCP";
  icono: string;
  titulo: string;
  pregunta: string;
  tono: Tono;
  numero: number | null;
  /** Qué se muestra en grande cuando no hay número que valga la pena. */
  etiquetaNumero: string;
  detalle: string;
  accion: string | null;
  href: string;
  items: ItemAhora[];
}

export interface OpcionesAhora {
  usuarioId: number;
  rol: string;
  /** Sede del usuario; limita la ronda y las desviaciones que se muestran. */
  sucursalId?: number | null;
  /** true para el panel del técnico: solo lo asignado a él. */
  soloMias?: boolean;
  /** true para incluir el bloque SCP (brecha de cobertura), que es de jefatura. */
  incluirCobertura?: boolean;
}

/** La cadena completa, lista para pintar. */
export async function estadoAhora(db: Db, opts: OpcionesAhora): Promise<BloqueAhora[]> {
  const bloques: BloqueAhora[] = [];
  bloques.push(await bloqueRonda(db, opts));
  bloques.push(await bloqueDesviaciones(db, opts));
  bloques.push(await bloqueEmergencias(db, opts));
  bloques.push(await bloqueIntervenciones(db, opts));
  if (opts.incluirCobertura) bloques.push(await bloqueCobertura(db));
  return bloques;
}

/** El bloque más urgente primero, para decidir dónde poner el ojo. */
export const PESO_TONO: Record<Tono, number> = { urgente: 0, atencion: 1, ok: 2, vacio: 3 };
export const ordenarPorTono = (b: BloqueAhora[]): BloqueAhora[] =>
  [...b].sort((x, y) => PESO_TONO[x.tono] - PESO_TONO[y.tono]);

/** Resumen de una línea: lo que se pone arriba del panel. */
export function tituloAhora(bloques: BloqueAhora[]): { texto: string; tono: Tono } {
  const urgentes = bloques.filter((b) => b.tono === "urgente");
  if (urgentes.length) {
    return {
      texto: urgentes.length === 1 ? urgentes[0].detalle : `${urgentes.length} cosas necesitan atención ahora`,
      tono: "urgente",
    };
  }
  const atencion = bloques.filter((b) => b.tono === "atencion");
  if (atencion.length) {
    return {
      texto: atencion.length === 1 ? atencion[0].detalle : `${atencion.length} cosas en curso`,
      tono: "atencion",
    };
  }
  return { texto: "Todo en orden: ronda hecha, sin desviaciones ni emergencias abiertas.", tono: "ok" };
}

// ── SOP · la ronda del turno ────────────────────────────────────────────────
export interface InfoRonda {
  fecha: string;
  turno: string;
  etiqueta: string;
  filas: FilaTablero[];
  miFila: FilaTablero | null;
}

export async function infoRonda(db: Db, sucursalId?: number | null): Promise<InfoRonda> {
  const [base] = await db.select().from(rondas).where(eq(rondas.activa, true)).limit(1);
  const t = turnoActual(parsearTurnos(base?.turnos));
  const filas = await tableroRondas(db, t.fecha, t.turno);
  return {
    fecha: t.fecha,
    turno: t.turno,
    etiqueta: t.etiqueta,
    filas,
    miFila: sucursalId ? (filas.find((f) => f.sucursalId === sucursalId) ?? null) : null,
  };
}

async function bloqueRonda(db: Db, opts: OpcionesAhora): Promise<BloqueAhora> {
  const info = await infoRonda(db, opts.sucursalId);
  const base = {
    doc: "SOP" as const,
    icono: "🧭",
    titulo: "Ronda de turno",
    pregunta: "¿Se hizo la ronda de este turno?",
    href: "/ronda",
  };

  // Para el técnico, su sede. Para la jefatura, todas.
  if (opts.sucursalId && info.miFila) {
    const f = info.miFila;
    if (f.estado === "sin_ronda") {
      return { ...base, tono: "vacio", numero: null, etiquetaNumero: "—",
        detalle: "Tu sede todavía no tiene una ronda configurada.", accion: "Ver rondas", items: [] };
    }
    const pendientes = f.ejecucion ? f.ejecucion.puntosNoVerificados : f.puntosTotal;
    if (f.estado === "completada") {
      return { ...base, tono: f.fuera > 0 ? "atencion" : "ok", numero: f.puntosTotal, etiquetaNumero: `${f.puntosTotal} paradas`,
        detalle: f.fuera > 0
          ? `Ronda del ${info.turno} hecha, con ${f.fuera} punto(s) fuera de rango.`
          : `Ronda del ${info.turno} hecha y sin desviaciones.`,
        accion: "Ver la ronda", href: f.ejecucion ? `/ronda/${f.ejecucion.id}` : "/ronda", items: [] };
    }
    if (f.estado === "en_curso") {
      return { ...base, tono: "atencion", numero: pendientes, etiquetaNumero: `${pendientes} sin anotar`,
        detalle: `Ronda del ${info.turno} en curso: ${pendientes} de ${f.puntosTotal} paradas sin anotar.`,
        accion: "Continuar la ronda", href: f.ejecucion ? `/ronda/${f.ejecucion.id}` : "/ronda", items: [] };
    }
    return { ...base, tono: "urgente", numero: f.puntosTotal, etiquetaNumero: `${f.puntosTotal} paradas`,
      detalle: `La ronda del ${info.turno} no se ha iniciado. Es el primer paso del turno.`,
      accion: "Iniciar mi ronda", items: [] };
  }

  const r = resumenTablero(info.filas);
  if (r.sedes === 0) {
    return { ...base, tono: "vacio", numero: null, etiquetaNumero: "—",
      detalle: "Ninguna sede tiene ronda configurada todavía.", accion: "Configurar", items: [] };
  }
  const items: ItemAhora[] = info.filas
    .filter((f) => f.estado === "sin_iniciar" || f.estado === "en_curso" || f.fuera > 0)
    .slice(0, 5)
    .map((f) => ({
      texto: f.sucursal,
      meta: f.estado === "sin_iniciar"
        ? "sin iniciar"
        : f.fuera > 0
          ? `${f.fuera} fuera de rango`
          : `${f.puntosTotal - (f.ejecucion?.puntosNoVerificados ?? 0)} de ${f.puntosTotal} paradas`,
      href: f.ejecucion ? `/ronda/${f.ejecucion.id}` : "/ronda",
      tono: f.estado === "sin_iniciar" ? "urgente" : "atencion",
    }));

  if (r.sinIniciar > 0) {
    return { ...base, tono: "urgente", numero: r.sinIniciar, etiquetaNumero: `${r.sinIniciar} sin iniciar`,
      detalle: `${r.sinIniciar} de ${r.sedes} sedes no han iniciado la ronda del ${info.turno}.`,
      accion: "Ver el tablero", items };
  }
  if (r.enCurso > 0 || r.fuera > 0) {
    return { ...base, tono: "atencion", numero: r.fuera > 0 ? r.fuera : r.enCurso,
      etiquetaNumero: r.fuera > 0 ? `${r.fuera} fuera de rango` : `${r.enCurso} en curso`,
      detalle: r.fuera > 0
        ? `La ronda del ${info.turno} destapó ${r.fuera} punto(s) fuera de rango.`
        : `${r.enCurso} sede(s) con la ronda del ${info.turno} en curso.`,
      accion: "Ver el tablero", items };
  }
  return { ...base, tono: "ok", numero: r.sedes, etiquetaNumero: `${r.sedes} de ${r.sedes}`,
    detalle: `Las ${r.sedes} sedes hicieron la ronda del ${info.turno}, sin desviaciones.`,
    accion: "Ver el tablero", items: [] };
}

// ── AOP · desviaciones con el reloj corriendo ───────────────────────────────
async function bloqueDesviaciones(db: Db, opts: OpcionesAhora): Promise<BloqueAhora> {
  const cond = [inArray(aopEventos.estado, ESTADOS_AOP_ABIERTOS)];
  if (opts.sucursalId) {
    cond.push(or(eq(aopEventos.sucursalId, opts.sucursalId), isNull(aopEventos.sucursalId))!);
  }
  const filas = await db
    .select({
      e: aopEventos,
      codigo: procedimientos.codigoCorto,
      titulo: procedimientos.titulo,
      sala: ubicaciones.nombre,
      sede: sucursales.nombre,
    })
    .from(aopEventos)
    .leftJoin(procedimientos, eq(procedimientos.id, aopEventos.procedimientoId))
    .leftJoin(ubicaciones, eq(ubicaciones.id, aopEventos.ubicacionId))
    .leftJoin(sucursales, eq(sucursales.id, aopEventos.sucursalId))
    .where(and(...cond))
    .orderBy(desc(aopEventos.detectadoEn))
    .limit(30);

  const conReloj = filas
    .map((f) => ({ ...f, cron: cronometro(f.e) }))
    .sort((a, b) => a.cron.urgencia - b.cron.urgencia);
  const vencidas = conReloj.filter((f) => f.cron.reloj === "vencido_actuar" || f.cron.reloj === "vencido_escalar").length;

  const base = {
    doc: "AOP" as const,
    icono: "⏱",
    titulo: "Desviaciones",
    pregunta: "¿Hay algo fuera de rango con el reloj corriendo?",
    href: "/aop",
  };
  const items: ItemAhora[] = conReloj.slice(0, 5).map((f) => ({
    texto: `${f.codigo ? `${f.codigo} · ` : ""}${f.titulo ?? "Desviación"}`,
    meta: `${f.sala ?? f.sede ?? "sin sala"} · actuar ${fmtCuentaRegresiva(f.cron.minutosParaActuar)}`,
    href: `/aop/${f.e.id}`,
    tono:
      f.cron.reloj === "vencido_escalar" || f.cron.reloj === "vencido_actuar" ? "urgente" : "atencion",
  }));

  if (conReloj.length === 0) {
    return { ...base, tono: "ok", numero: 0, etiquetaNumero: "0",
      detalle: "Ninguna desviación abierta.", accion: null, items: [] };
  }
  if (vencidas > 0) {
    return { ...base, tono: "urgente", numero: vencidas, etiquetaNumero: String(vencidas),
      detalle: `${vencidas} desviación(es) con el plazo vencido, de ${conReloj.length} abiertas.`,
      accion: "Atender ahora", items };
  }
  return { ...base, tono: "atencion", numero: conReloj.length, etiquetaNumero: String(conReloj.length),
    detalle: `${conReloj.length} desviación(es) abiertas, todas dentro de plazo.`,
    accion: "Ver desviaciones", items };
}

// ── EOP · lo que ya falló ───────────────────────────────────────────────────
async function bloqueEmergencias(db: Db, opts: OpcionesAhora): Promise<BloqueAhora> {
  const cond = [eq(ordenes.tipo, "emergencia"), inArray(ordenes.estado, ["abierta", "en_proceso", "en_espera"])];
  if (opts.soloMias) cond.push(eq(ordenes.asignadoA, opts.usuarioId));
  const filas = await db
    .select({
      o: ordenes,
      activo: activos.nombre,
      codigoEop: procedimientos.codigoCorto,
      accion1: eopFicha.accion1,
    })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .leftJoin(procedimientos, eq(procedimientos.id, ordenes.procedimientoId))
    .leftJoin(eopFicha, eq(eopFicha.procedimientoId, ordenes.procedimientoId))
    .where(and(...cond))
    .orderBy(desc(ordenes.id))
    .limit(10);

  const base = {
    doc: "EOP" as const,
    icono: "🚨",
    titulo: "Emergencias",
    pregunta: "¿Hay algo ya fallado ahora mismo?",
    href: "/ordenes?tipo=emergencia",
  };
  if (filas.length === 0) {
    return { ...base, tono: "ok", numero: 0, etiquetaNumero: "0",
      detalle: "Ninguna emergencia abierta.", accion: null, items: [] };
  }
  const items: ItemAhora[] = filas.slice(0, 5).map((f) => ({
    texto: `#${f.o.id} · ${f.o.titulo}`,
    meta: [f.codigoEop, f.activo, f.o.horaMitigacion ? "mitigada" : "sin mitigar"].filter(Boolean).join(" · "),
    href: `/ordenes/${f.o.id}`,
    tono: f.o.horaMitigacion ? "atencion" : "urgente",
  }));
  const sinMitigar = filas.filter((f) => !f.o.horaMitigacion).length;
  return {
    ...base,
    tono: sinMitigar > 0 ? "urgente" : "atencion",
    numero: filas.length,
    etiquetaNumero: String(filas.length),
    detalle: sinMitigar > 0
      ? `${sinMitigar} emergencia(s) sin mitigar. El EOP manda: estabilizar primero, registrar después.`
      : `${filas.length} emergencia(s) mitigadas, pendientes de restablecer y de causa raíz.`,
    accion: "Abrir",
    items,
  };
}

// ── MOP · intervenciones que no pueden arrancar ─────────────────────────────
async function bloqueIntervenciones(db: Db, opts: OpcionesAhora): Promise<BloqueAhora> {
  const cond = [eq(ordenes.tipo, "intervencion"), inArray(ordenes.estado, ["abierta", "en_proceso"])];
  if (opts.soloMias) cond.push(eq(ordenes.asignadoA, opts.usuarioId));
  const filas = await db
    .select({ o: ordenes, activo: activos.nombre, codigoMop: procedimientos.codigoCorto })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .leftJoin(procedimientos, eq(procedimientos.id, ordenes.procedimientoId))
    .where(and(...cond))
    .orderBy(desc(ordenes.id))
    .limit(20);

  const base = {
    doc: "MOP" as const,
    icono: "🛠",
    titulo: "Intervenciones",
    pregunta: "¿Alguna no puede arrancar porque falta un permiso?",
    href: "/ordenes?tipo=intervencion",
  };
  if (filas.length === 0) {
    return { ...base, tono: "vacio", numero: 0, etiquetaNumero: "0",
      detalle: "Ninguna intervención programada abierta.", accion: null, items: [] };
  }

  // Prerrequisitos obligatorios pendientes por orden: lo que la bloquea.
  const ids = filas.map((f) => f.o.id);
  const prerreqs = await db
    .select({ ordenId: ordenPrerrequisitos.ordenId, n: sql<number>`count(*)` })
    .from(ordenPrerrequisitos)
    .where(
      and(
        inArray(ordenPrerrequisitos.ordenId, ids),
        eq(ordenPrerrequisitos.obligatorio, true),
        eq(ordenPrerrequisitos.cumplido, false),
      ),
    )
    .groupBy(ordenPrerrequisitos.ordenId);
  const pendientesPorOrden = new Map(prerreqs.map((p) => [p.ordenId, Number(p.n)]));
  const bloqueadas = filas.filter((f) => f.o.estado === "abierta" && (pendientesPorOrden.get(f.o.id) ?? 0) > 0);

  const items: ItemAhora[] = filas
    .slice(0, 5)
    .map((f) => {
      const n = pendientesPorOrden.get(f.o.id) ?? 0;
      return {
        texto: `#${f.o.id} · ${f.o.titulo}`,
        meta: [f.codigoMop, f.activo, n > 0 ? `${n} prerrequisito(s) pendiente(s)` : "lista para iniciar"]
          .filter(Boolean)
          .join(" · "),
        href: `/ordenes/${f.o.id}`,
        tono: n > 0 ? "atencion" : "ok",
      } as ItemAhora;
    })
    .sort((a, b) => PESO_TONO[a.tono] - PESO_TONO[b.tono]);

  if (bloqueadas.length > 0) {
    return { ...base, tono: "atencion", numero: bloqueadas.length, etiquetaNumero: String(bloqueadas.length),
      detalle: `${bloqueadas.length} intervención(es) no pueden iniciar: falta el permiso, el bloqueo o el aviso.`,
      accion: "Resolver prerrequisitos", items };
  }
  return { ...base, tono: "ok", numero: filas.length, etiquetaNumero: String(filas.length),
    detalle: `${filas.length} intervención(es) abiertas, con sus prerrequisitos cumplidos.`,
    accion: "Ver intervenciones", items };
}

// ── SCP · equipos que ningún documento gobierna ────────────────────────────
async function bloqueCobertura(db: Db): Promise<BloqueAhora> {
  const filas = await db
    .select({
      nombre: activos.nombre,
      categoria: activos.categoria,
      rubro: activos.rubro,
      sistema: activos.sistema,
      criticidad: activos.criticidadOperacional,
      estado: activos.estado,
    })
    .from(activos);
  const vivos = filas.filter((a) => a.estado !== "baja");
  const sinDeclarar = vivos.filter((a) => !a.sistema);
  const criticosSinDeclarar = sinDeclarar.filter((a) => a.criticidad === "alta").length;

  // Cuáles caerían en "otro" incluso inferiendo por el nombre: esos son los que
  // de verdad ningún documento alcanza.
  const huerfanos = sinDeclarar.filter(
    (a) => inferirSistema(a.nombre, a.categoria, a.rubro) === ("otro" as Sistema),
  ).length;

  const base = {
    doc: "SCP" as const,
    icono: "🗺",
    titulo: "Equipos gobernados",
    pregunta: "¿Qué equipos no están todavía bajo ningún documento?",
    href: "/activos/clasificar",
  };
  if (vivos.length === 0) {
    return { ...base, tono: "vacio", numero: 0, etiquetaNumero: "—",
      detalle: "Todavía no hay equipos cargados en el sistema.", accion: "Cargar equipos", href: "/activos/nuevo", items: [] };
  }
  if (sinDeclarar.length === 0) {
    return { ...base, tono: "ok", numero: vivos.length, etiquetaNumero: `${vivos.length}`,
      detalle: `Los ${vivos.length} equipos tienen familia declarada: el sistema sabe qué documento los rige.`,
      accion: "Ver cobertura", href: "/cobertura", items: [] };
  }
  const pct = Math.round((sinDeclarar.length / vivos.length) * 100);
  return {
    ...base,
    tono: criticosSinDeclarar > 0 ? "urgente" : "atencion",
    numero: sinDeclarar.length,
    etiquetaNumero: String(sinDeclarar.length),
    detalle: criticosSinDeclarar > 0
      ? `${criticosSinDeclarar} equipo(s) crítico(s) sin familia declarada: si fallan, el sistema no sabe qué EOP aplica.`
      : `${sinDeclarar.length} equipos (${pct} %) sin familia declarada${huerfanos > 0 ? `; ${huerfanos} no se pueden inferir por el nombre` : ""}.`,
    accion: "Clasificar equipos",
    items: [],
  };
}

/** Familias con equipos, para la línea de contexto de los paneles. */
export async function familiasConEquipos(db: Db): Promise<Array<{ sistema: Sistema; label: string; n: number }>> {
  const filas = await db
    .select({ sistema: activos.sistema, nombre: activos.nombre, categoria: activos.categoria, rubro: activos.rubro, estado: activos.estado })
    .from(activos);
  const acc = new Map<Sistema, number>();
  for (const a of filas) {
    if (a.estado === "baja") continue;
    const s = (a.sistema as Sistema) || inferirSistema(a.nombre, a.categoria, a.rubro);
    acc.set(s, (acc.get(s) ?? 0) + 1);
  }
  return [...acc.entries()]
    .map(([sistema, n]) => ({ sistema, label: SISTEMA_LABEL[sistema] ?? sistema, n }))
    .sort((a, b) => b.n - a.n);
}
