import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toCsv, csvResponse } from "@/lib/csv";
import { parseArea } from "@/lib/areas";
import { ROLES_BIO_VER, hoySV } from "@/lib/biomedico";
import { columnasCsvPlan, filasCsvPlan } from "@/lib/plan-anual";
import { cargarRutinasPlan } from "@/lib/plan-anual-datos";

export const prerender = false;

/**
 * K-E3: CSV del plan anual con las mismas rutinas que la página.
 * ?anio=AAAA (por defecto el de hoy) · ?area= (sin área = plan general) · ?sede=
 */
export const GET: APIRoute = async (ctx) => {
  // Admin, jefe, técnico y visualizador (los mismos roles que ven lo biomédico).
  const { user, response } = await requireUser(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const q = ctx.url.searchParams;
  const anio = q.get("anio") ? Number(q.get("anio")) : Number(hoySV().slice(0, 4));
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return Response.json({ error: "Año no válido." }, { status: 400 });
  const areaParam = q.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida." }, { status: 400 });
  const sede = q.get("sede") ? Number(q.get("sede")) : null;
  const sedeId = sede && Number.isInteger(sede) && sede > 0 ? sede : null;

  const rutinas = (await cargarRutinasPlan(getDb(ctx), { area, sedeId }))
    .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "equipo" ? -1 : 1) || a.grupo.localeCompare(b.grupo, "es") || a.codigo.localeCompare(b.codigo, "es"));
  return csvResponse(`plan_${area ?? "general"}_${anio}.csv`, toCsv(filasCsvPlan(rutinas, anio), columnasCsvPlan(anio)));
};
