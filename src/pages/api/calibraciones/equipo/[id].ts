// Marca de equipo patrón y de «No requiere calibración» (K-B5). Solo jefe y administrador;
// son las únicas escrituras de activos.es_patron y activos.calibracion_no_aplica.
import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos } from "@/lib/schema";
import { calcularDiff, logAudit } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR } from "@/lib/biomedico";
import { errorMotivo, textoLimpio } from "@/lib/metrologia";
import { equipoCalibracion, errorJson, exigirRol, idDeRuta } from "@/lib/metrologia-db";

export const prerender = false;

const SIEMPRE_REQUIERE = "Un equipo patrón siempre requiere calibración.";

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, "Solo el jefe o el administrador marcan equipos patrón o «No requiere calibración».");
  if (!user) return response;
  const db = getDb(ctx);
  const id = idDeRuta(ctx.params.id);
  const equipo = id ? await equipoCalibracion(db, id) : null;
  if (!equipo) return errorJson("Equipo no encontrado", 404);

  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  const esPatron = typeof body?.esPatron === "boolean" ? body.esPatron : undefined;
  const noAplica = typeof body?.calibracionNoAplica === "boolean" ? body.calibracionNoAplica : undefined;
  if (esPatron === undefined && noAplica === undefined) return errorJson("Nada que cambiar.", 400);
  if (equipo.estado === "baja") return errorJson("El equipo está dado de baja.", 409);

  const cambios: {
    esPatron?: boolean; requiereCalibracion?: boolean; calibracionNoAplica?: boolean; calibracionNoAplicaMotivo?: string | null;
  } = {};
  const resumenes: string[] = [];
  if (esPatron === true) {
    if (noAplica === true) return errorJson(SIEMPRE_REQUIERE, 400);
    // Un patrón siempre requiere calibración: se marca la casilla y se quita «No requiere».
    Object.assign(cambios, { esPatron: true, requiereCalibracion: true, calibracionNoAplica: false, calibracionNoAplicaMotivo: null });
    resumenes.push("Marcado como equipo patrón");
  } else if (esPatron === false) {
    cambios.esPatron = false;
    resumenes.push("Quitada la marca de equipo patrón");
  }
  if (noAplica === true) {
    if (equipo.esPatron && esPatron !== false) return errorJson(SIEMPRE_REQUIERE, 400);
    const motivo = textoLimpio(body?.motivo);
    const err = errorMotivo(motivo, "Escribe por qué no requiere calibración (al menos 10 letras).", 300);
    if (err) return errorJson(err, 400);
    Object.assign(cambios, { calibracionNoAplica: true, calibracionNoAplicaMotivo: motivo });
    resumenes.push(`Marcado «No requiere calibración»: ${motivo}`);
  } else if (noAplica === false && esPatron !== true) {
    Object.assign(cambios, { calibracionNoAplica: false, calibracionNoAplicaMotivo: null });
    resumenes.push("Vuelve a requerir calibración");
  }

  const diff = calcularDiff(equipo as unknown as Record<string, unknown>, cambios);
  let activo = equipo;
  if (Object.keys(diff).length > 0) {
    const [row] = await db.update(activos).set(cambios).where(eq(activos.id, equipo.id)).returning({
      id: activos.id, codigo: activos.codigo, nombre: activos.nombre, estado: activos.estado, tipo: activos.tipo, rubro: activos.rubro,
      requiereCalibracion: activos.requiereCalibracion, esPatron: activos.esPatron,
      calibracionNoAplica: activos.calibracionNoAplica, calibracionNoAplicaMotivo: activos.calibracionNoAplicaMotivo,
    });
    activo = row ?? equipo;
    await logAudit(ctx, { entidad: "activo", entidadId: equipo.id, accion: "update", cambios: diff, resumen: resumenes.join(" · ") });
  }
  return Response.json({
    ok: true,
    activo: {
      id: activo.id, esPatron: activo.esPatron, requiereCalibracion: activo.requiereCalibracion,
      calibracionNoAplica: activo.calibracionNoAplica, calibracionNoAplicaMotivo: activo.calibracionNoAplicaMotivo,
    },
  });
};
