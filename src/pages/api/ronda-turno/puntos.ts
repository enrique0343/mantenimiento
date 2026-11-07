// Ronda de turno · configurar el recorrido.
// Los valores normales salen de la norma, pero varios son de cada sede y el
// volumen los deja "en azul": esto es donde la jefatura los fija, junto con el
// orden de las paradas, los turnos de cada recorrido y si una sede hace ronda.
// Un cambio entra en la ronda del turno que todavía no empezó; la ronda que ya
// empezó conserva lo que decía al abrir. Todo cambio queda en la auditoría con
// lo que había antes y lo que quedó. Un error se contesta en una frase, para
// que la pantalla lo muestre tal cual.
import type { APIContext, APIRoute } from "astro";
import { z } from "zod";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { logAudit, type DiffEntry } from "@/lib/audit";
import { FAMILIAS_RONDA, nombreRecorrido, parsearTurnos, puedeConfigurarRondas, siguienteTurno } from "@/lib/ronda-turno";
import { procedimientos, rondaPuntos, rondaVigencias, rondas, sucursales } from "@/lib/schema";

export const prerender = false;

type Db = ReturnType<typeof getDb>;
type Punto = typeof rondaPuntos.$inferSelect;
type Usuario = { id: number; rol: string };

// ── Respuestas ──────────────────────────────────────────────────────────────
const fallo = (status: number, error: string) => Response.json({ error }, { status });

/** La primera razón del rechazo, en una frase que se puede mostrar tal cual. */
function primerError(e: z.ZodError): string {
  const i = e.issues[0];
  if (!i) return "No se entendió lo que se envió.";
  if (i.code === "unrecognized_keys") return `Campo desconocido: ${i.keys.join(", ")}.`;
  if (i.code === "invalid_union_discriminator") return "Acción desconocida: usa «turnos», «crear_propio» o «hace_ronda».";
  if (i.path.length === 0) return "No se entendió lo que se envió.";
  return i.message;
}

async function leerCuerpo(ctx: APIContext): Promise<unknown> {
  try {
    return await ctx.request.json();
  } catch {
    return undefined;
  }
}

/** Solo la jefatura configura la ronda. */
async function jefatura(ctx: APIContext): Promise<{ user: Usuario; response: null } | { user: null; response: Response }> {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return { user: null, response };
  if (!puedeConfigurarRondas(user.rol)) return { user: null, response: new Response("Sin permisos", { status: 403 }) };
  return { user, response: null };
}

const fechaCorta = (f: string) => f.split("-").reverse().join("/");

async function nombreDe(db: Db, ronda: { sucursalId: number | null }): Promise<string> {
  if (ronda.sucursalId == null) return nombreRecorrido(ronda);
  const [s] = await db.select({ nombre: sucursales.nombre }).from(sucursales).where(eq(sucursales.id, ronda.sucursalId)).limit(1);
  return nombreRecorrido(ronda, s?.nombre);
}

// ── Los campos de una parada ────────────────────────────────────────────────
const texto = (max: number, nombre: string) =>
  z
    .string({ invalid_type_error: `${nombre}: escribe un texto.` })
    .trim()
    .max(max, `${nombre}: máximo ${max} caracteres.`)
    .nullable()
    .transform((v) => (v ? v : null));
const numero = (nombre: string) =>
  z.number({ invalid_type_error: `${nombre} tiene que ser un número.` }).finite(`${nombre} tiene que ser un número.`).nullable();
const minutos = (nombre: string) =>
  z
    .number({ invalid_type_error: `${nombre}: escribe los minutos con un número entero.` })
    .int(`${nombre}: escribe los minutos con un número entero.`)
    .positive(`${nombre}: tienen que ser más de cero.`)
    .max(10080, `${nombre}: como máximo 10080 (una semana).`)
    .nullable();
const siNo = (nombre: string) => z.boolean({ invalid_type_error: `${nombre}: tiene que ser sí o no.` });
const LINEA = "La línea del SOP va de 1 a 11.";

const CAMPOS = {
  etiqueta: z
    .string({ required_error: "Escribe qué se verifica.", invalid_type_error: "Escribe qué se verifica." })
    .trim()
    .min(3, "Escribe qué se verifica: al menos 3 caracteres.")
    .max(200, "Qué se verifica: máximo 200 caracteres."),
  instruccion: texto(1000, "La instrucción"),
  sistema: z.enum(FAMILIAS_RONDA, { errorMap: () => ({ message: "Elige la familia de la parada." }) }),
  requiereValor: siNo("Si pide un número"),
  unidad: texto(20, "La unidad"),
  minEsperado: numero("El mínimo"),
  maxEsperado: numero("El máximo"),
  valorEsperadoTexto: texto(300, "Qué se considera conforme"),
  aopProcedimientoId: z
    .number({ invalid_type_error: "Elige el AOP de la lista." })
    .int("Elige el AOP de la lista.")
    .positive("Elige el AOP de la lista.")
    .nullable(),
  critico: siNo("Crítica"),
  activo: siNo("Activa"),
  fuente: texto(300, "La fuente"),
  lineaSop: z.number({ invalid_type_error: LINEA }).int(LINEA).min(1, LINEA).max(11, LINEA).nullable(),
  minutosActuar: minutos("Minutos para actuar"),
  minutosEscalar: minutos("Minutos para escalar"),
};
type Campo = keyof typeof CAMPOS;
const NOMBRES_CAMPOS = Object.keys(CAMPOS) as Campo[];

const id = (falta: string, malo: string) =>
  z.number({ required_error: falta, invalid_type_error: malo }).int(malo).positive(malo);
const idParada = id("Falta la parada.", "Parada inválida.");

const editarSchema = z.object(CAMPOS).partial().extend({ id: idParada }).strict();
const moverSchema = z
  .object({ id: idParada, mover: z.enum(["subir", "bajar"], { errorMap: () => ({ message: "Mover: «subir» o «bajar»." }) }) })
  .strict();
const crearSchema = z
  .object(CAMPOS)
  .partial()
  .required({ etiqueta: true, sistema: true })
  .extend({ rondaId: id("Falta el recorrido.", "Recorrido inválido.") })
  .strict();

type Valores = Pick<Punto, Campo>;

/** El tipo manda: una parada de conforme no guarda rango ni unidad; una numérica no guarda texto esperado. */
function ajustarTipo(p: Valores) {
  if (p.requiereValor) p.valorEsperadoTexto = null;
  else {
    p.minEsperado = null;
    p.maxEsperado = null;
    p.unidad = null;
  }
}

/** Las reglas se miran con los valores que van a quedar, no con los que había. */
function reglas(p: Valores): string | null {
  if (p.requiereValor && p.minEsperado != null && p.maxEsperado != null && p.minEsperado > p.maxEsperado) {
    return "El mínimo no puede ser mayor que el máximo.";
  }
  if (p.minutosActuar != null && p.minutosEscalar != null && p.minutosEscalar < p.minutosActuar) {
    return "Los minutos para escalar no pueden ser menos que los minutos para actuar.";
  }
  return null;
}

async function revisarAop(db: Db, aopId: number): Promise<string | null> {
  const [p] = await db.select({ tipo: procedimientos.tipo }).from(procedimientos).where(eq(procedimientos.id, aopId)).limit(1);
  if (!p) return "Ese AOP no existe.";
  if (p.tipo !== "aop") return "Ese documento no es un AOP: elige uno de la lista.";
  return null;
}

/** Lo que cambió, campo por campo, con lo de antes y lo de después. */
function diferencias(antes: Valores, despues: Valores): Record<string, DiffEntry> {
  const out: Record<string, DiffEntry> = {};
  for (const k of NOMBRES_CAMPOS) {
    const a = antes[k] ?? null;
    const b = despues[k] ?? null;
    if (a !== b) out[k] = { antes: a, despues: b };
  }
  return out;
}

// ── PATCH: editar una parada o moverla ──────────────────────────────────────
/** Edita cualquier campo de una parada, o la sube o la baja un puesto. Solo cambia lo que se manda. */
export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await jefatura(ctx);
  if (!user) return response;
  const body = await leerCuerpo(ctx);
  const db = getDb(ctx);
  if (body && typeof body === "object" && "mover" in body) return moverParada(ctx, db, body);

  const parsed = editarSchema.safeParse(body);
  if (!parsed.success) return fallo(400, primerError(parsed.error));
  const { id: puntoId, ...pedido } = parsed.data;

  const [antes] = await db.select().from(rondaPuntos).where(eq(rondaPuntos.id, puntoId)).limit(1);
  if (!antes) return fallo(404, "La parada no existe.");

  const propuesto: Valores = { ...antes, ...pedido };
  // Al cambiar de tipo, lo del tipo anterior no se queda escondido en la parada.
  if (pedido.requiereValor !== undefined && pedido.requiereValor !== antes.requiereValor) ajustarTipo(propuesto);
  const regla = reglas(propuesto);
  if (regla) return fallo(400, regla);
  if (propuesto.aopProcedimientoId != null && propuesto.aopProcedimientoId !== antes.aopProcedimientoId) {
    const malo = await revisarAop(db, propuesto.aopProcedimientoId);
    if (malo) return fallo(400, malo);
  }

  const cambios = diferencias(antes, propuesto);
  if (Object.keys(cambios).length === 0) return Response.json({ ok: true, punto: antes, cambios });
  const set = Object.fromEntries(Object.keys(cambios).map((k) => [k, propuesto[k as Campo]]));
  const [row] = await db.update(rondaPuntos).set(set).where(eq(rondaPuntos.id, puntoId)).returning();
  const [ronda] = await db.select({ sucursalId: rondas.sucursalId }).from(rondas).where(eq(rondas.id, row.rondaId)).limit(1);
  await logAudit(ctx, {
    entidad: "ronda_punto", entidadId: puntoId, accion: "update",
    resumen: `Parada «${row.etiqueta}» ajustada · ${ronda ? await nombreDe(db, ronda) : "recorrido"}`,
    cambios,
  });
  return Response.json({ ok: true, punto: row, cambios });
};

/** Sube o baja una parada un puesto. El recorrido queda numerado de corrido. */
async function moverParada(ctx: APIContext, db: Db, body: object): Promise<Response> {
  const parsed = moverSchema.safeParse(body);
  if (!parsed.success) return fallo(400, primerError(parsed.error));
  const { id: puntoId, mover } = parsed.data;
  const [p] = await db.select({ rondaId: rondaPuntos.rondaId }).from(rondaPuntos).where(eq(rondaPuntos.id, puntoId)).limit(1);
  if (!p) return fallo(404, "La parada no existe.");
  const lista = await db
    .select({ id: rondaPuntos.id, orden: rondaPuntos.orden, etiqueta: rondaPuntos.etiqueta })
    .from(rondaPuntos)
    .where(eq(rondaPuntos.rondaId, p.rondaId))
    .orderBy(asc(rondaPuntos.orden), asc(rondaPuntos.id));
  const i = lista.findIndex((x) => x.id === puntoId);
  const j = mover === "subir" ? i - 1 : i + 1;
  if (j < 0) return fallo(409, "Ya es la primera parada del recorrido.");
  if (j >= lista.length) return fallo(409, "Ya es la última parada del recorrido.");
  const nueva = [...lista];
  [nueva[i], nueva[j]] = [nueva[j], nueva[i]];
  const updates = nueva
    .map((x, k) => ({ id: x.id, orden: k + 1, antes: x.orden }))
    .filter((x) => x.orden !== x.antes)
    .map((x) => db.update(rondaPuntos).set({ orden: x.orden }).where(eq(rondaPuntos.id, x.id)));
  // Un batch: el recorrido nunca queda con dos paradas en el mismo puesto.
  if (updates.length) await db.batch(updates as [(typeof updates)[number], ...(typeof updates)[number][]]);

  const [ronda] = await db.select({ sucursalId: rondas.sucursalId }).from(rondas).where(eq(rondas.id, p.rondaId)).limit(1);
  const nombre = ronda ? await nombreDe(db, ronda) : "recorrido";
  const movida = lista[i], otra = lista[j];
  await logAudit(ctx, {
    entidad: "ronda_punto", entidadId: movida.id, accion: "update",
    resumen: `Parada «${movida.etiqueta}» ${mover === "subir" ? "subió" : "bajó"} al puesto ${j + 1} · ${nombre}`,
    cambios: { puesto: { antes: i + 1, despues: j + 1 } },
  });
  await logAudit(ctx, {
    entidad: "ronda_punto", entidadId: otra.id, accion: "update",
    resumen: `Parada «${otra.etiqueta}» pasó al puesto ${i + 1} · ${nombre}`,
    cambios: { puesto: { antes: j + 1, despues: i + 1 } },
  });
  return Response.json({ ok: true, puesto: j + 1 });
}

// ── POST: agregar una parada ────────────────────────────────────────────────
/** Agrega una parada al final del recorrido. */
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await jefatura(ctx);
  if (!user) return response;
  const parsed = crearSchema.safeParse(await leerCuerpo(ctx));
  if (!parsed.success) return fallo(400, primerError(parsed.error));
  const { rondaId, ...d } = parsed.data;

  const db = getDb(ctx);
  const [ronda] = await db.select({ id: rondas.id, sucursalId: rondas.sucursalId }).from(rondas).where(eq(rondas.id, rondaId)).limit(1);
  if (!ronda) return fallo(404, "El recorrido no existe.");
  const nuevo: Valores = {
    etiqueta: d.etiqueta,
    sistema: d.sistema,
    instruccion: d.instruccion ?? null,
    requiereValor: d.requiereValor ?? false,
    unidad: d.unidad ?? null,
    minEsperado: d.minEsperado ?? null,
    maxEsperado: d.maxEsperado ?? null,
    valorEsperadoTexto: d.valorEsperadoTexto ?? null,
    aopProcedimientoId: d.aopProcedimientoId ?? null,
    critico: d.critico ?? false,
    activo: d.activo ?? true,
    fuente: d.fuente ?? null,
    lineaSop: d.lineaSop ?? null,
    minutosActuar: d.minutosActuar ?? null,
    minutosEscalar: d.minutosEscalar ?? null,
  };
  ajustarTipo(nuevo);
  const regla = reglas(nuevo);
  if (regla) return fallo(400, regla);
  if (nuevo.aopProcedimientoId != null) {
    const malo = await revisarAop(db, nuevo.aopProcedimientoId);
    if (malo) return fallo(400, malo);
  }

  // El puesto se calcula en el mismo INSERT: dos que agregan a la vez no se pisan el lugar.
  const [row] = await db
    .insert(rondaPuntos)
    .values({ rondaId, orden: sql`(SELECT COALESCE(MAX(orden), 0) + 1 FROM ronda_puntos WHERE ronda_id = ${rondaId})`, ...nuevo })
    .returning();

  await logAudit(ctx, {
    entidad: "ronda_punto", entidadId: row.id, accion: "create",
    resumen: `Parada agregada al final: «${row.etiqueta}» · ${await nombreDe(db, ronda)}`,
    cambios: Object.fromEntries(NOMBRES_CAMPOS.map((k) => [k, { antes: null, despues: row[k] ?? null }])),
  });
  return Response.json({ ok: true, punto: row });
};

// ── PUT: el recorrido y la sede ─────────────────────────────────────────────
const recorridoSchema = z.discriminatedUnion("accion", [
  z
    .object({
      accion: z.literal("turnos"),
      rondaId: id("Falta el recorrido.", "Recorrido inválido."),
      turnos: z.array(z.string({ invalid_type_error: "Escribe cada turno como HH:MM, por ejemplo 06:00." }), {
        required_error: "Escribe los turnos.",
        invalid_type_error: "Escribe los turnos.",
      }),
    })
    .strict(),
  z.object({ accion: z.literal("crear_propio"), sucursalId: id("Falta la sede.", "Sede inválida.") }).strict(),
  z
    .object({
      accion: z.literal("hace_ronda"),
      sucursalId: id("Falta la sede.", "Sede inválida."),
      haceRonda: z.boolean({ required_error: "Falta decir si la sede hace ronda.", invalid_type_error: "Hace ronda: tiene que ser sí o no." }),
    })
    .strict(),
]);

/** Turnos, recorrido propio de una sede, o si la sede hace ronda. */
export const PUT: APIRoute = async (ctx) => {
  const { user, response } = await jefatura(ctx);
  if (!user) return response;
  const parsed = recorridoSchema.safeParse(await leerCuerpo(ctx));
  if (!parsed.success) return fallo(400, primerError(parsed.error));
  const d = parsed.data;
  const db = getDb(ctx);
  if (d.accion === "turnos") return cambiarTurnos(ctx, db, user, d.rondaId, d.turnos);
  if (d.accion === "crear_propio") return crearPropio(ctx, db, user, d.sucursalId);
  return cambiarMarca(ctx, db, user, d.sucursalId, d.haceRonda);
};

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** «6:00» se entiende como 06:00. Lo demás que no sea HH:MM se rechaza diciendo cuál. */
function revisarTurnos(lista: string[]): { turnos: string[] } | { error: string } {
  const limpios = lista.map((t) => t.trim()).filter(Boolean).map((t) => (/^\d:[0-5]\d$/.test(t) ? `0${t}` : t));
  if (!limpios.length) return { error: "Escribe al menos un turno, por ejemplo 06:00." };
  const malo = limpios.find((t) => !HORA.test(t));
  if (malo) return { error: `Hora inválida: «${malo}». Usa HH:MM, por ejemplo 06:00.` };
  const turnos = [...new Set(limpios)].sort();
  if (turnos.length > 6) return { error: "Son demasiados turnos: como máximo 6." };
  return { turnos };
}

/** Cambia los turnos de un recorrido, el modelo o el propio de una sede. */
async function cambiarTurnos(ctx: APIContext, db: Db, user: Usuario, rondaId: number, pedidos: string[]): Promise<Response> {
  const revisados = revisarTurnos(pedidos);
  if ("error" in revisados) return fallo(400, revisados.error);
  const [ronda] = await db.select().from(rondas).where(eq(rondas.id, rondaId)).limit(1);
  if (!ronda) return fallo(404, "El recorrido no existe.");
  const antes = parsearTurnos(ronda.turnos);
  const { turnos } = revisados;
  if (antes.join() === turnos.join()) return Response.json({ ok: true, ronda, aplicaDesde: null, cambios: {} });

  // Lo que regía hasta ahora queda escrito: los turnos que ya empezaron se juzgan con eso.
  const ahora = new Date().toISOString();
  const [actualizada] = await db.batch([
    db.update(rondas).set({ turnos: JSON.stringify(turnos) }).where(eq(rondas.id, ronda.id)).returning(),
    db.insert(rondaVigencias).values({ rondaId: ronda.id, turnosAntes: JSON.stringify(antes), hasta: ahora, usuarioId: user.id }),
  ]);
  const aplicaDesde = siguienteTurno(turnos, Date.parse(ahora));
  const cambios = { turnos: { antes, despues: turnos } };
  await logAudit(ctx, {
    entidad: "ronda", entidadId: ronda.id, accion: "update",
    resumen: `Turnos de ${await nombreDe(db, ronda)}: ${turnos.join(", ")}, desde el turno ${aplicaDesde.turno} del ${fechaCorta(aplicaDesde.fecha)}`,
    cambios,
  });
  return Response.json({ ok: true, ronda: actualizada[0], aplicaDesde, cambios });
}

/** Copia el modelo a la sede. Desde ahí la sede ya no recibe los cambios del modelo. */
async function crearPropio(ctx: APIContext, db: Db, user: Usuario, sucursalId: number): Promise<Response> {
  const [sede] = await db.select({ id: sucursales.id, nombre: sucursales.nombre }).from(sucursales).where(eq(sucursales.id, sucursalId)).limit(1);
  if (!sede) return fallo(404, "La sede no existe.");
  const buscar = async () => (await db.select().from(rondas).where(eq(rondas.sucursalId, sede.id)).limit(1))[0];
  const existente = await buscar();
  if (existente) return Response.json({ ok: true, ronda: existente, yaExistia: true });
  const [modelo] = await db.select().from(rondas).where(isNull(rondas.sucursalId)).orderBy(asc(rondas.id)).limit(1);
  if (!modelo) return fallo(409, "No hay recorrido modelo que copiar.");

  const codigo = `RONDA-TURNO-S${sede.id}`;
  // Drizzle no enlaza parámetros de un db.run dentro de un batch de D1: van como literales.
  // Solo son enteros que vienen de la base, así que no hay texto ajeno en la sentencia.
  const nueva = sql.raw(`(SELECT id FROM rondas WHERE codigo = 'RONDA-TURNO-S${Math.trunc(sede.id)}')`);
  const delModelo = sql.raw(String(Math.trunc(modelo.id)));
  try {
    // Todo o nada: el recorrido, sus paradas y la historia de sus turnos, que hasta hoy era la del modelo.
    await db.batch([
      db.insert(rondas).values({
        codigo, nombre: modelo.nombre, descripcion: modelo.descripcion, procedimientoId: modelo.procedimientoId, sucursalId: sede.id,
        turnos: modelo.turnos, minutosEstimados: modelo.minutosEstimados, activa: true, creadoPor: user.id, vigenteDesde: modelo.vigenteDesde,
      }),
      db.run(sql`INSERT INTO ronda_puntos (ronda_id, orden, linea_sop, sistema, etiqueta, instruccion, activo_id, ubicacion_id, variable_id, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico, activo, minutos_actuar, minutos_escalar)
        SELECT ${nueva}, orden, linea_sop, sistema, etiqueta, instruccion, activo_id, ubicacion_id, variable_id, requiere_valor, unidad, min_esperado, max_esperado, valor_esperado_texto, fuente, aop_procedimiento_id, critico, activo, minutos_actuar, minutos_escalar
        FROM ronda_puntos WHERE ronda_id = ${delModelo} ORDER BY orden, id`),
      db.run(sql`INSERT INTO ronda_vigencias (ronda_id, turnos_antes, hasta, usuario_id)
        SELECT ${nueva}, turnos_antes, hasta, usuario_id FROM ronda_vigencias WHERE ronda_id = ${delModelo}`),
    ]);
  } catch (e) {
    // Otra jefatura la creó al mismo tiempo: la que ganó ya está ahí.
    const otra = await buscar();
    if (otra) return Response.json({ ok: true, ronda: otra, yaExistia: true });
    throw e;
  }
  const propia = await buscar();
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(rondaPuntos).where(eq(rondaPuntos.rondaId, propia.id));
  await logAudit(ctx, {
    entidad: "ronda", entidadId: propia.id, accion: "create",
    resumen: `Recorrido propio de ${sede.nombre}: copia del modelo con ${n} paradas. Ya no recibe cambios del modelo.`,
    cambios: { recorrido: { antes: "Modelo", despues: nombreRecorrido(propia, sede.nombre) }, paradas: { antes: null, despues: Number(n) } },
  });
  return Response.json({ ok: true, ronda: propia });
}

/** Marca si la sede hace ronda. Entra en el turno que todavía no empezó. */
async function cambiarMarca(ctx: APIContext, db: Db, user: Usuario, sucursalId: number, haceRonda: boolean): Promise<Response> {
  const [sede] = await db
    .select({ id: sucursales.id, nombre: sucursales.nombre, haceRonda: sucursales.haceRonda })
    .from(sucursales)
    .where(eq(sucursales.id, sucursalId))
    .limit(1);
  if (!sede) return fallo(404, "La sede no existe.");
  if (sede.haceRonda === haceRonda) return Response.json({ ok: true, sede, aplicaDesde: null, cambios: {} });

  // Para decir desde qué turno entra: los turnos del recorrido que usa la sede.
  const [propia] = await db.select().from(rondas).where(eq(rondas.sucursalId, sede.id)).limit(1);
  const [recorrido] = propia ? [propia] : await db.select().from(rondas).where(isNull(rondas.sucursalId)).orderBy(asc(rondas.id)).limit(1);
  const ahora = new Date().toISOString();
  const [[actualizada]] = await db.batch([
    db.update(sucursales).set({ haceRonda }).where(eq(sucursales.id, sede.id)).returning({ id: sucursales.id, nombre: sucursales.nombre, haceRonda: sucursales.haceRonda }),
    db.insert(rondaVigencias).values({ sucursalId: sede.id, haceRondaAntes: sede.haceRonda, hasta: ahora, usuarioId: user.id }),
  ]);
  const aplicaDesde = siguienteTurno(parsearTurnos(recorrido?.turnos), Date.parse(ahora));
  const cambios = { haceRonda: { antes: sede.haceRonda, despues: haceRonda } };
  await logAudit(ctx, {
    entidad: "ronda", entidadId: recorrido?.id ?? 0, accion: "update",
    resumen: `${sede.nombre} ${haceRonda ? "hace ronda" : "no hace ronda"} desde el turno ${aplicaDesde.turno} del ${fechaCorta(aplicaDesde.fecha)}`,
    cambios,
  });
  return Response.json({ ok: true, sede: actualizada, aplicaDesde, cambios });
}

// ── GET: las paradas de un recorrido ────────────────────────────────────────
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await jefatura(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const rondaId = Number(new URL(ctx.request.url).searchParams.get("rondaId") ?? "");
  if (!Number.isInteger(rondaId) || rondaId <= 0) return fallo(400, "Falta el recorrido.");
  const [ronda] = await db.select().from(rondas).where(eq(rondas.id, rondaId)).limit(1);
  if (!ronda) return fallo(404, "El recorrido no existe.");
  const puntos = await db.select().from(rondaPuntos).where(eq(rondaPuntos.rondaId, rondaId)).orderBy(asc(rondaPuntos.orden), asc(rondaPuntos.id));
  return Response.json({ ronda: { ...ronda, nombreEnPantalla: await nombreDe(db, ronda) }, puntos });
};
