// Registrar una capacitación con sus asistentes y equipos (Fase 59 · WP-D).
// Admin, jefe y técnico. La sesión se inserta primero; asistentes y equipos van en un
// solo lote (≤ 90 parámetros por sentencia) y, si el lote falla, la sesión se borra.
// Un equipo dado de baja no se enlaza a una capacitación nueva (409).
import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { capacitaciones } from "@/lib/schema";
import { logAudit } from "@/lib/audit";
import { ROLES_BIO_REGISTRAR } from "@/lib/biomedico";
import { codigoCapacitacion, validarCapacitacion } from "@/lib/capacitaciones";
import { insercionesCapacitacion, revisarReferenciasCapacitacion } from "@/lib/bio-consultas";
import { errorJson, exigirRol, leerJson } from "@/lib/bio-archivos";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_REGISTRAR, "Solo el administrador, el jefe o el técnico registran capacitaciones.");
  if (!user) return response;
  const body = await leerJson(ctx);
  if (!body) return errorJson(400, "Datos no válidos.");
  const v = validarCapacitacion(body);
  if (!v.ok) return Response.json({ error: v.error, ...(v.errores ? { errores: v.errores } : {}) }, { status: 400 });
  const db = getDb(ctx);
  const ref = await revisarReferenciasCapacitacion(db, v.datos, v.equipoIds);
  if (ref) return errorJson(ref.status, ref.error);

  const [cap] = await db.insert(capacitaciones).values({ ...v.datos, usuarioId: user.id }).returning({ id: capacitaciones.id });
  const hijos = insercionesCapacitacion(db, cap.id, v.asistentes, v.equipoIds);
  if (hijos.length) {
    try {
      await db.batch(hijos as [any, ...any[]]);
    } catch {
      await db.delete(capacitaciones).where(eq(capacitaciones.id, cap.id)).catch(() => {});
      return errorJson(500, "No se pudo guardar. Intenta de nuevo.");
    }
  }
  await logAudit(ctx, {
    entidad: "capacitacion", entidadId: cap.id, accion: "create",
    resumen: `Capacitación registrada: ${codigoCapacitacion(cap.id)} — ${v.datos.tema} (${v.asistentes.length} asistentes, ${v.equipoIds.length} equipos)`,
  });
  return Response.json({ capacitacion: { id: cap.id } }, { status: 201 });
};
