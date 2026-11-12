// Fase 59 · K-C1: historial del equipo en CSV, con los mismos eventos y el mismo
// filtro de período que la pantalla (/activos/{id}/historial). Solo lectura.
import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { csvResponse, toCsv } from "@/lib/csv";
import { hoySV, puedeVerBio } from "@/lib/biomedico";
import { COLUMNAS_CSV_HISTORIAL, construirEventos, enPeriodo, fechaCsv, filaCsv, ordenarEventos, periodoValido } from "@/lib/historial-equipo";
import { cargarHistorialEquipo } from "@/lib/historial-equipo-db";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerBio(user.rol)) return Response.json({ error: "Tu usuario no puede ver el historial de los equipos." }, { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Equipo no válido." }, { status: 400 });
  const url = new URL(ctx.request.url);
  const periodo = periodoValido(url.searchParams.get("desde"), url.searchParams.get("hasta"));
  if (periodo.error) return Response.json({ error: periodo.error }, { status: 400 });

  const db = getDb(ctx);
  const [a] = await db.select({ id: activos.id, codigo: activos.codigo }).from(activos).where(eq(activos.id, id)).limit(1);
  if (!a) return Response.json({ error: "Equipo no encontrado." }, { status: 404 });

  const historial = await cargarHistorialEquipo(db, id);
  const hoy = hoySV();
  const eventos = ordenarEventos(construirEventos(historial, { fecha: fechaCsv, hoy }))
    .filter((e) => enPeriodo(e.fecha, periodo.desde, periodo.hasta));
  const nombre = `historial_${a.codigo.replace(/[^A-Za-z0-9_-]/g, "_")}_${hoy.replace(/-/g, "")}.csv`;
  return csvResponse(nombre, toCsv(eventos.map((e) => filaCsv(e, a.codigo)), COLUMNAS_CSV_HISTORIAL));
};
