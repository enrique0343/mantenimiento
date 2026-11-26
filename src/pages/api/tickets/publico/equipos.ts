import type { APIRoute } from "astro";
import { and, asc, eq, ne, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos, ubicaciones } from "@/lib/schema";
import { activoAreaCondition, parseArea } from "@/lib/areas";
import { rubroDeActivo } from "@/lib/rubros";
import { parseEspacio, espacioDeArea, condicionActivoEspacio } from "@/lib/espacio";

export const prerender = false;

// Fase 59 · WP-G. Equipos de una ubicación para el formulario público de soporte
// (/soporte). Es público por el prefijo /api/tickets/publico (middleware): no
// pide sesión. Devuelve lo mínimo para elegir (id, código, nombre y área), sin
// serie, marca ni modelo, sin equipos dados de baja y hasta 300.
const MAX_EQUIPOS = 300;

export const GET: APIRoute = async (ctx) => {
  const url = new URL(ctx.request.url);
  const crudo = (url.searchParams.get("ubicacionId") ?? "").trim();
  const ubicacionId = /^\d+$/.test(crudo) ? Number(crudo) : Number.NaN;
  if (!Number.isSafeInteger(ubicacionId) || ubicacionId <= 0) {
    return Response.json({ error: "Ubicación inválida" }, { status: 400 });
  }
  // Las rutas públicas no pasan por el filtro de área del middleware: se valida aquí.
  const areaCruda = url.searchParams.get("area");
  const area = parseArea(areaCruda);
  if (areaCruda !== null && areaCruda !== "" && !area) {
    return Response.json({ error: "Área de mantenimiento inválida" }, { status: 400 });
  }

  const espacioCrudo = url.searchParams.get("espacio");
  const espacio = parseEspacio(espacioCrudo);
  if (espacioCrudo !== null && !espacio) return Response.json({ error: "Tipo de mantenimiento inválido" }, { status: 400 });
  if (area && espacio && espacioDeArea(area) !== espacio) return Response.json({ error: "El área no corresponde al tipo de mantenimiento" }, { status: 400 });

  const db = getDb(ctx);
  const [ubicacion] = await db
    .select({ id: ubicaciones.id })
    .from(ubicaciones)
    .where(and(eq(ubicaciones.id, ubicacionId), eq(ubicaciones.activa, true)))
    .limit(1);
  if (!ubicacion) return Response.json({ error: "Ubicación no encontrada" }, { status: 404 });

  const condiciones: SQL[] = [eq(activos.ubicacionId, ubicacionId), ne(activos.estado, "baja")];
  if (area) condiciones.push(activoAreaCondition(area));
  if (espacio) condiciones.push(condicionActivoEspacio(espacio));
  const filas = await db
    .select({ id: activos.id, codigo: activos.codigo, nombre: activos.nombre, rubro: activos.rubro, tipo: activos.tipo })
    .from(activos)
    .where(and(...condiciones))
    .orderBy(asc(activos.codigo))
    .limit(MAX_EQUIPOS);

  return Response.json(
    { equipos: filas.map((a) => ({ id: a.id, codigo: a.codigo, nombre: a.nombre, area: rubroDeActivo(a.rubro, a.tipo) })) },
    { headers: { "cache-control": "private, max-age=120" } },
  );
};
