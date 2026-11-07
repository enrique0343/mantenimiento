import type { APIRoute } from "astro";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  eopSimulacros,
  procedimientos,
  procedimientoCampos,
  procedimientoEscalamientos,
  procedimientoValidaciones,
  procedimientoVersiones,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import {
  ESTADOS_PROC,
  SISTEMAS_PROC,
  exigeSimulacroDeMesa,
  hoyISO,
  puedeAdministrarProcedimientos,
  puedeSerVigente,
  puedeVerProcedimientos,
  revisionAnual,
} from "@/lib/procedimientos";

export const prerender = false;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const patchSchema = z.object({
  codigoInstitucional: z.string().nullable().optional(),
  sistema: z.enum(SISTEMAS_PROC).optional(),
  dominio: z.string().nullable().optional(),
  titulo: z.string().min(3).optional(),
  proposito: z.string().nullable().optional(),
  alcance: z.string().nullable().optional(),
  sucursalId: z.number().int().positive().nullable().optional(),
  version: z.string().min(1).optional(),
  estado: z.enum(ESTADOS_PROC).optional(),
  responsableId: z.number().int().positive().optional(),
  suplenteCargo: z.string().nullable().optional(),
  normaAdoptada: z.string().nullable().optional(),
  referencias: z.string().nullable().optional(),
  registro: z.string().nullable().optional(),
  nivelRiesgo: z.enum(["bajo", "medio", "alto"]).nullable().optional(),
  semanaValidacion: z.number().int().min(1).max(4).nullable().optional(),
  proximaRevision: z.string().regex(FECHA).nullable().optional(),
  r2Key: z.string().nullable().optional(),
  /** Nota para el historial de versiones (se guarda si cambia la versión o el estado). */
  cambio: z.string().nullable().optional(),
});

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerProcedimientos(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const db = getDb(ctx);
  const [proc] = await db.select().from(procedimientos).where(eq(procedimientos.id, id)).limit(1);
  if (!proc) return Response.json({ error: "No encontrado" }, { status: 404 });

  const [campos, validaciones, versiones, escalamientos] = await Promise.all([
    db.select().from(procedimientoCampos).where(eq(procedimientoCampos.procedimientoId, id))
      .orderBy(asc(procedimientoCampos.orden), asc(procedimientoCampos.id)),
    db.select().from(procedimientoValidaciones).where(eq(procedimientoValidaciones.procedimientoId, id))
      .orderBy(asc(procedimientoValidaciones.fechaProgramada), asc(procedimientoValidaciones.id)),
    db.select().from(procedimientoVersiones).where(eq(procedimientoVersiones.procedimientoId, id))
      .orderBy(asc(procedimientoVersiones.fecha), asc(procedimientoVersiones.id)),
    db.select().from(procedimientoEscalamientos).where(eq(procedimientoEscalamientos.procedimientoId, id))
      .orderBy(asc(procedimientoEscalamientos.orden), asc(procedimientoEscalamientos.minutos)),
  ]);

  const veredicto = puedeSerVigente(campos, validaciones);
  return Response.json({ procedimiento: proc, campos, validaciones, versiones, escalamientos, veredicto });
};

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarProcedimientos(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(" · "), detalle: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { cambio, ...datos } = parsed.data;

  const db = getDb(ctx);
  const [actual] = await db.select().from(procedimientos).where(eq(procedimientos.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });

  const hoy = hoyISO();
  const extras: Partial<typeof procedimientos.$inferInsert> = {};

  // ── REGLA DURA DEL CAPÍTULO 8.1 ───────────────────────────────────────────
  // "Ningún documento de este volumen entra en vigor por haber sido escrito."
  // Se verifica aquí, en la API, no sólo en la pantalla: un documento no pasa a
  // 'vigente' con un campo en azul vacío ni con un área en 'pendiente'.
  if (datos.estado === "vigente" && actual.estado !== "vigente") {
    const [campos, validaciones] = await Promise.all([
      db.select().from(procedimientoCampos).where(eq(procedimientoCampos.procedimientoId, id)),
      db.select().from(procedimientoValidaciones).where(eq(procedimientoValidaciones.procedimientoId, id)),
    ]);
    const veredicto = puedeSerVigente(campos, validaciones);
    if (!veredicto.ok) {
      return Response.json(
        {
          error: "No puede entrar en vigencia todavía.",
          motivos: veredicto.motivos,
          camposFaltantes: veredicto.camposFaltantes,
          areasPendientes: veredicto.areasPendientes,
        },
        { status: 409 },
      );
    }
    // ── REGLA DURA DEL CAPÍTULO 06 (EOP) ───────────────────────────────────
    // "Cada EOP se ensaya antes de aprobarse: simulacro de mesa para la
    // versión nueva […]. Un EOP sin simulacro es una hipótesis."  También en
    // la API: un EOP no entra en vigencia sin el ensayo de mesa de la versión
    // que se está aprobando.
    if (exigeSimulacroDeMesa(actual.tipo)) {
      const versionFinal = datos.version ?? actual.version;
      const ensayos = await db
        .select({ fecha: eopSimulacros.fecha, version: eopSimulacros.versionEnsayada })
        .from(eopSimulacros)
        .where(and(eq(eopSimulacros.procedimientoId, id), eq(eopSimulacros.tipo, "mesa")));
      // Una constancia sin versión anotada es de las viejas: se acepta.
      const deEstaVersion = ensayos.filter((e) => !e.version || e.version === versionFinal);
      if (deEstaVersion.length === 0) {
        return Response.json(
          {
            error: "No puede entrar en vigencia todavía.",
            motivos: [
              ensayos.length === 0
                ? "Este EOP no tiene ningún simulacro de mesa registrado. Capítulo 06: un EOP sin simulacro es una hipótesis."
                : `Los simulacros de mesa registrados son de otra versión; falta ensayar la versión ${versionFinal} antes de aprobarla.`,
            ],
            requiereSimulacroDeMesa: true,
            version: versionFinal,
          },
          { status: 409 },
        );
      }
    }

    extras.aprobadoPor = user.id;
    extras.aprobadoEn = hoy;
    // Revisión anual y tras cada cambio (cap. 03), si nadie fijó otra fecha.
    if (!datos.proximaRevision && !actual.proximaRevision) {
      extras.proximaRevision = revisionAnual(hoy);
    }
  }

  // Volver atrás desde vigente borra la aprobación: la firma era de esa versión.
  if (datos.estado && datos.estado !== "vigente" && actual.estado === "vigente") {
    extras.aprobadoPor = null;
    extras.aprobadoEn = null;
  }

  const [row] = await db
    .update(procedimientos)
    .set({ ...datos, ...extras })
    .where(eq(procedimientos.id, id))
    .returning();

  // Historial: toda versión nueva y todo cambio de estado dejan renglón.
  const cambioVersion = datos.version != null && datos.version !== actual.version;
  const cambioEstado = datos.estado != null && datos.estado !== actual.estado;
  if (cambioVersion || cambioEstado) {
    const notas: string[] = [];
    if (cambioVersion) notas.push(`Versión ${actual.version} → ${row.version}`);
    if (cambioEstado) notas.push(`Estado ${actual.estado} → ${row.estado}`);
    if (cambio) notas.push(cambio);
    await db.insert(procedimientoVersiones).values({
      procedimientoId: id,
      version: row.version,
      fecha: hoy,
      cambio: notas.join(" · "),
      responsableId: user.id,
    });
  }

  return Response.json({ procedimiento: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarProcedimientos(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const db = getDb(ctx);
  // Baja lógica: el documento retirado se conserva como historial, porque los
  // activos y las plantillas de orden citan su versión.
  const [row] = await db
    .update(procedimientos)
    .set({ activo: false, estado: "retirado" })
    .where(eq(procedimientos.id, id))
    .returning();
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });

  await db.insert(procedimientoVersiones).values({
    procedimientoId: id,
    version: row.version,
    fecha: hoyISO(),
    cambio: "Documento retirado de la biblioteca.",
    responsableId: user.id,
  });

  return Response.json({ ok: true });
};
