import type { APIRoute } from "astro";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  procedimientos,
  procedimientoCampos,
  procedimientoValidaciones,
  procedimientoVersiones,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import {
  ESTADOS_PROC,
  SISTEMAS_PROC,
  TIPOS_PROC,
  hoyISO,
  puedeAdministrarProcedimientos,
  puedeVerProcedimientos,
  semanaSugerida,
} from "@/lib/procedimientos";

export const prerender = false;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Cap. 08: "un dueño por documento" y una fecha programada por área validadora.
// Sin eso el borrador se vuelve permanente, asi que se exigen al crear.
const validacionSchema = z.object({
  area: z.string().min(1, "El área validadora es obligatoria"),
  queConfirma: z.string().nullable().optional(),
  fechaProgramada: z.string().regex(FECHA, "Cada área necesita fecha programada (YYYY-MM-DD)"),
  metodoVerificacion: z.string().nullable().optional(),
});

const campoSchema = z.object({
  etiqueta: z.string().min(1),
  valor: z.string().nullable().optional(),
  unidad: z.string().nullable().optional(),
  decideArea: z.string().nullable().optional(),
});

const createSchema = z.object({
  codigoCorto: z.string().min(3).max(40),
  codigoInstitucional: z.string().nullable().optional(),
  tipo: z.enum(TIPOS_PROC),
  sistema: z.enum(SISTEMAS_PROC),
  dominio: z.string().nullable().optional(),
  titulo: z.string().min(3),
  proposito: z.string().nullable().optional(),
  alcance: z.string().nullable().optional(),
  sucursalId: z.number().int().positive().nullable().optional(),
  heredadoDeId: z.number().int().positive().nullable().optional(),
  version: z.string().min(1).default("0.1"),
  // Un dueño por documento: obligatorio, no admite null.
  responsableId: z.number().int().positive({ message: "El documento necesita un responsable (dueño)" }),
  suplenteCargo: z.string().nullable().optional(),
  normaAdoptada: z.string().nullable().optional(),
  referencias: z.string().nullable().optional(),
  registro: z.string().nullable().optional(),
  nivelRiesgo: z.enum(["bajo", "medio", "alto"]).nullable().optional(),
  semanaValidacion: z.number().int().min(1).max(4).nullable().optional(),
  proximaRevision: z.string().regex(FECHA).nullable().optional(),
  validaciones: z.array(validacionSchema).min(1, "Asigna al menos un área validadora con su fecha"),
  campos: z.array(campoSchema).default([]),
});

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerProcedimientos(user.rol)) return new Response("Sin permisos", { status: 403 });

  const url = new URL(ctx.request.url);
  const tipo = url.searchParams.get("tipo");
  const sistema = url.searchParams.get("sistema");
  const estado = url.searchParams.get("estado");
  const sucursalId = url.searchParams.get("sucursalId");

  const cond = [eq(procedimientos.activo, true)];
  if (tipo && (TIPOS_PROC as readonly string[]).includes(tipo)) {
    cond.push(eq(procedimientos.tipo, tipo as (typeof TIPOS_PROC)[number]));
  }
  if (sistema && (SISTEMAS_PROC as readonly string[]).includes(sistema)) {
    cond.push(eq(procedimientos.sistema, sistema as (typeof SISTEMAS_PROC)[number]));
  }
  if (estado && (ESTADOS_PROC as readonly string[]).includes(estado)) {
    cond.push(eq(procedimientos.estado, estado as (typeof ESTADOS_PROC)[number]));
  }
  if (sucursalId && Number.isInteger(Number(sucursalId))) {
    cond.push(eq(procedimientos.sucursalId, Number(sucursalId)));
  }

  const db = getDb(ctx);
  const rows = await db
    .select()
    .from(procedimientos)
    .where(and(...cond))
    .orderBy(asc(procedimientos.tipo), asc(procedimientos.codigoCorto));

  return Response.json({ procedimientos: rows });
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarProcedimientos(user.rol)) return new Response("Sin permisos", { status: 403 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(" · "), detalle: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { validaciones, campos, ...proc } = parsed.data;

  const db = getDb(ctx);
  const codigoCorto = proc.codigoCorto.trim().toUpperCase();

  const [dup] = await db
    .select({ id: procedimientos.id })
    .from(procedimientos)
    .where(eq(procedimientos.codigoCorto, codigoCorto))
    .limit(1);
  if (dup) {
    return Response.json(
      { error: `El código corto ${codigoCorto} ya existe. El índice de equivalencia admite un solo documento por código (cap. 2.4).` },
      { status: 409 },
    );
  }

  // Áreas repetidas: la matriz de validación lleva un renglón por área.
  const areas = validaciones.map((v) => v.area.trim());
  const repetida = areas.find((a, i) => areas.indexOf(a) !== i);
  if (repetida) {
    return Response.json({ error: `El área "${repetida}" está dos veces en la matriz.` }, { status: 400 });
  }

  const hoy = hoyISO();
  const [row] = await db
    .insert(procedimientos)
    .values({
      ...proc,
      codigoCorto,
      // Nace en borrador: sólo pasa a vigente cuando la regla del 8.1 lo permite.
      estado: "borrador",
      semanaValidacion: proc.semanaValidacion ?? semanaSugerida(proc.tipo),
      creadoPor: user.id,
    })
    .returning();

  if (validaciones.length > 0) {
    await db.insert(procedimientoValidaciones).values(
      validaciones.map((v) => ({
        procedimientoId: row.id,
        area: v.area.trim(),
        queConfirma: v.queConfirma ?? null,
        fechaProgramada: v.fechaProgramada,
        metodoVerificacion: v.metodoVerificacion ?? null,
        estado: "pendiente" as const,
      })),
    );
  }

  if (campos.length > 0) {
    await db.insert(procedimientoCampos).values(
      campos.map((c, i) => ({
        procedimientoId: row.id,
        etiqueta: c.etiqueta.trim(),
        valor: c.valor?.trim() || null,
        unidad: c.unidad ?? null,
        decideArea: c.decideArea ?? null,
        orden: i,
      })),
    );
  }

  await db.insert(procedimientoVersiones).values({
    procedimientoId: row.id,
    version: row.version,
    fecha: hoy,
    cambio: "Alta del documento en la biblioteca.",
    responsableId: proc.responsableId,
  });

  return Response.json({ procedimiento: row }, { status: 201 });
};
