import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ordenes, ordenIncidentes } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { validarContextoArea } from "@/lib/ordenes";
import { ROLES_BIO_GESTIONAR, hoySV } from "@/lib/biomedico";
import {
  cambiosMarca, resumenMarca, validarMarcaIncidente, validarMotivoQuitar, type MarcaIncidente,
} from "@/lib/incidentes";

export const prerender = false;

// Fase 59 · WP-G. Marca de incidente o evento adverso en una orden. Solo escribe
// orden_incidentes: no toca la orden, su estado, su checklist ni su verificación
// (no pasa por aplicarCambioOrden). Marcan, editan y quitan admin y jefe; la
// bitácora de la orden (entidad «orden», acción «update») lo deja escrito.

const idDe = (raw: string | undefined): number | null => {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const marcaDe = (r: { numeroReporte: string | null; fechaNotificacion: string; nota: string | null }): MarcaIncidente => ({
  numeroReporte: r.numeroReporte, fechaNotificacion: r.fechaNotificacion, nota: r.nota,
});

/** Crea o edita la marca: { numeroReporte?, fechaNotificacion, nota? }. */
export const PUT: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;
  const id = idDe(ctx.params.id);
  if (!id) return Response.json({ error: "Orden inválida" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const v = validarMarcaIncidente(body, hoySV());
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });

  const db = getDb(ctx);
  const [ot] = await db.select({ id: ordenes.id, rubro: ordenes.rubro }).from(ordenes).where(eq(ordenes.id, id)).limit(1);
  if (!ot) return Response.json({ error: "La orden no existe" }, { status: 404 });
  const contextError = validarContextoArea(ctx.request, ot.rubro);
  if (contextError) return contextError;

  const [actual] = await db.select().from(ordenIncidentes).where(eq(ordenIncidentes.ordenId, id)).limit(1);
  if (!actual) {
    try {
      await db.insert(ordenIncidentes).values({ ordenId: id, ...v.valor, marcadoPor: user.id });
    } catch {
      // orden_id es UNIQUE: si ahora hay marca, otra persona la puso entre la lectura y el alta.
      const [otra] = await db.select({ id: ordenIncidentes.id }).from(ordenIncidentes).where(eq(ordenIncidentes.ordenId, id)).limit(1);
      if (otra) return Response.json({ error: "Otra persona acaba de marcar esta orden. Recarga la página." }, { status: 409 });
      return Response.json({ error: "No se pudo guardar la marca de incidente." }, { status: 500 });
    }
    await logAudit(ctx, {
      entidad: "orden", entidadId: id, accion: "update",
      cambios: cambiosMarca(null, v.valor), resumen: resumenMarca("marcar", v.valor),
    });
    return Response.json({ ok: true, creada: true }, { status: 201 });
  }

  const cambios = cambiosMarca(marcaDe(actual), v.valor);
  if (Object.keys(cambios).length === 0) return Response.json({ ok: true, sinCambios: true });
  const editadas = await db.update(ordenIncidentes).set(v.valor)
    .where(eq(ordenIncidentes.id, actual.id)).returning({ id: ordenIncidentes.id });
  if (!editadas.length) {
    return Response.json({ error: "Otra persona acaba de quitar la marca. Recarga la página." }, { status: 409 });
  }
  await logAudit(ctx, {
    entidad: "orden", entidadId: id, accion: "update",
    cambios, resumen: resumenMarca("editar", v.valor, { campos: Object.keys(cambios) }),
  });
  return Response.json({ ok: true });
};

/** Quita la marca: { motivo } de 10 a 500 caracteres. */
export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;
  const id = idDe(ctx.params.id);
  if (!id) return Response.json({ error: "Orden inválida" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const m = validarMotivoQuitar(body);
  if (!m.ok) return Response.json({ error: m.error }, { status: 400 });

  const db = getDb(ctx);
  const [ot] = await db.select({ id: ordenes.id, rubro: ordenes.rubro }).from(ordenes).where(eq(ordenes.id, id)).limit(1);
  if (!ot) return Response.json({ error: "La orden no existe" }, { status: 404 });
  const contextError = validarContextoArea(ctx.request, ot.rubro);
  if (contextError) return contextError;

  const [actual] = await db.select().from(ordenIncidentes).where(eq(ordenIncidentes.ordenId, id)).limit(1);
  if (!actual) return Response.json({ error: "Esta orden no está marcada como incidente." }, { status: 404 });
  const borradas = await db.delete(ordenIncidentes).where(eq(ordenIncidentes.id, actual.id)).returning({ id: ordenIncidentes.id });
  if (!borradas.length) return Response.json({ error: "Esta orden no está marcada como incidente." }, { status: 404 });

  const antes = marcaDe(actual);
  await logAudit(ctx, {
    entidad: "orden", entidadId: id, accion: "update",
    cambios: cambiosMarca(antes, null), resumen: resumenMarca("quitar", antes, { motivo: m.valor }),
  });
  return Response.json({ ok: true });
};
