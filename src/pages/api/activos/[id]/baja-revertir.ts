import type { APIRoute } from "astro";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activoBajas, activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, folioActaBaja } from "@/lib/biomedico";

export const prerender = false;

// Fase 59 · Revertir la baja de un equipo (admin y jefe), con motivo. El equipo
// vuelve al estado que tenía antes de la baja. Los planes NO se reactivan: tienen
// fechas pasadas y crearían órdenes vencidas de golpe (D6).

const ESTADOS_VIVOS = ["operativo", "averiado", "mantenimiento"] as const;
type EstadoVivo = (typeof ESTADOS_VIVOS)[number];

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "El equipo no existe." }, { status: 404 });
  const body = await ctx.request.json().catch(() => null) as { motivo?: unknown } | null;
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim().toUpperCase() : "";
  if (motivo.length < 10) return Response.json({ error: "Escribe el motivo de la reversión (mínimo 10 caracteres)." }, { status: 400 });
  if (motivo.length > 1000) return Response.json({ error: "El motivo pasa de 1000 caracteres: acórtalo." }, { status: 400 });

  const db = getDb(ctx);
  const [a] = await db.select({ id: activos.id, estado: activos.estado }).from(activos).where(eq(activos.id, id)).limit(1);
  if (!a) return Response.json({ error: "El equipo no existe." }, { status: 404 });
  if (a.estado !== "baja") return Response.json({ error: "El equipo no está dado de baja." }, { status: 409 });
  const [vigente] = await db.select({ id: activoBajas.id, estadoAnterior: activoBajas.estadoAnterior }).from(activoBajas)
    .where(and(eq(activoBajas.activoId, id), eq(activoBajas.estado, "vigente"))).orderBy(desc(activoBajas.id)).limit(1);

  // Un equipo marcado «baja» antes de esta fase no tiene fila: vuelve a operativo.
  const destino: EstadoVivo = vigente && (ESTADOS_VIVOS as readonly string[]).includes(vigente.estadoAnterior)
    ? vigente.estadoAnterior as EstadoVivo : "operativo";
  const volver = db.update(activos).set({ estado: destino }).where(and(eq(activos.id, id), eq(activos.estado, "baja")));
  if (vigente) {
    await db.batch([
      db.update(activoBajas).set({
        estado: "revertida", revertidaEn: new Date().toISOString(), revertidaPor: user.id,
        revertidaPorNombre: user.nombre, reversionMotivo: motivo,
      }).where(and(eq(activoBajas.id, vigente.id), eq(activoBajas.estado, "vigente"))),
      volver,
    ]);
  } else {
    await volver;
  }
  await logAudit(ctx, {
    entidad: "activo", entidadId: id, accion: "estado",
    cambios: { estado: { antes: "baja", despues: destino } },
    resumen: `Baja revertida${vigente ? ` (${folioActaBaja(vigente.id)})` : ""}: ${motivo}`,
  });
  return Response.json({ mensaje: "Baja revertida. Los planes preventivos siguen desactivados: reactívalos en «Planes» si corresponde." });
};
