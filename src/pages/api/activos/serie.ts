import type { APIRoute } from "astro";
import { and, or, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { rubroDeActivo } from "@/lib/rubros";
import { normalizarSerie } from "@/lib/registro-activos";
import { espaciosPermitidos, condicionActivoEspacio } from "@/lib/espacio";
import { ROLES_BIO_REGISTRAR } from "@/lib/biomedico";

export const prerender = false;

// Fase 59 · ¿La serie ya está en otro equipo? Solo avisa: no impide guardar.
// GET ?valor=&excluir= → { coincidencias: [{ id, codigo, nombre, estado, area }] } (5 como máximo).
// «sn 123» y «SN-123» son la misma serie; «S/N», «N/A» o «000» no cuentan.
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_REGISTRAR);
  if (!user) return response;
  const url = new URL(ctx.request.url);
  const serie = normalizarSerie(url.searchParams.get("valor"));
  if (!serie) return Response.json({ coincidencias: [] });
  const excluir = Number(url.searchParams.get("excluir")) || null;
  const rows = await getDb(ctx)
    .select({ id: activos.id, codigo: activos.codigo, nombre: activos.nombre, estado: activos.estado, rubro: activos.rubro, tipo: activos.tipo, serial: activos.serial })
    .from(activos)
    .where(and(isNotNull(activos.serial), or(...espaciosPermitidos(user).map(condicionActivoEspacio))));
  const coincidencias = rows
    .filter((r) => r.id !== excluir && normalizarSerie(r.serial) === serie)
    .slice(0, 5)
    .map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, estado: r.estado, area: rubroDeActivo(r.rubro, r.tipo) }));
  return Response.json({ coincidencias });
};
