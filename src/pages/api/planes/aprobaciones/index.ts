import type { APIRoute } from "astro";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { planAprobaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { AREA_KEYS } from "@/lib/areas";
import { rubroLabel } from "@/lib/rubros";
import { ROLES_BIO_GESTIONAR, ROLES_BIO_VER, esFechaISO, fechaCorta, hoySV, nombreSeguroR2, validarArchivo } from "@/lib/biomedico";
import { cargarAprobacionesPlan } from "@/lib/plan-anual-datos";

export const prerender = false;

/** 'general' (plan de todas las áreas) o una clave de área. */
const esAreaPlan = (v: string) => v === "general" || (AREA_KEYS as readonly string[]).includes(v);
const etiquetaArea = (area: string) => (area === "general" ? "General" : rubroLabel(area));

/**
 * Aprobaciones de un año y área. ?anio=AAAA&area=… (sin área = plan general: el
 * middleware no deja pasar area=general en la URL).
 */
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const q = ctx.url.searchParams;
  const anio = q.get("anio") ? Number(q.get("anio")) : Number(hoySV().slice(0, 4));
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return Response.json({ error: "Año no válido." }, { status: 400 });
  const area = q.get("area") || "general";
  if (!esAreaPlan(area)) return Response.json({ error: "Área no válida." }, { status: 400 });
  return Response.json({ aprobaciones: await cargarAprobacionesPlan(getDb(ctx), anio, area) });
};

/**
 * Registra la aprobación con el plan firmado (admin y jefe). Multipart: anio, area
 * ('general' o clave), version, aprobadoPor, fechaAprobacion, notas y archivo.
 */
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;
  const form = await ctx.request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Adjunta el plan firmado." }, { status: 400 });
  const texto = (k: string) => String(form.get(k) ?? "").trim();

  const anio = Number(texto("anio"));
  if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) return Response.json({ error: "Año no válido." }, { status: 400 });
  const area = texto("area") || "general";
  if (!esAreaPlan(area)) return Response.json({ error: "Área no válida." }, { status: 400 });
  const version = texto("version");
  if (version.length < 1 || version.length > 20) return Response.json({ error: "Escribe la versión aprobada." }, { status: 400 });
  const aprobadoPor = texto("aprobadoPor");
  if (aprobadoPor.length < 3 || aprobadoPor.length > 120) return Response.json({ error: "Escribe quién aprobó (nombre y cargo)." }, { status: 400 });
  const fechaAprobacion = texto("fechaAprobacion");
  if (!esFechaISO(fechaAprobacion)) return Response.json({ error: "Fecha de aprobación no válida." }, { status: 400 });
  if (fechaAprobacion > hoySV()) return Response.json({ error: "La fecha de aprobación no puede ser futura." }, { status: 400 });
  const notas = texto("notas");
  if (notas.length > 500) return Response.json({ error: "Las notas son muy largas." }, { status: 400 });
  const archivo = form.get("archivo") ?? form.get("file");
  if (!archivo || typeof archivo === "string") return Response.json({ error: "Adjunta el plan firmado." }, { status: 400 });
  const file = archivo as File;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const v = validarArchivo({ tamano: file.size, cabecera: bytes.subarray(0, 1024) });
  if (!v.ok) return Response.json({ error: v.error }, { status: v.status });

  const db = getDb(ctx);
  const [repetida] = await db.select({ id: planAprobaciones.id }).from(planAprobaciones)
    .where(and(eq(planAprobaciones.anio, anio), eq(planAprobaciones.area, area), eq(planAprobaciones.version, version), isNull(planAprobaciones.anuladaEn)))
    .limit(1);
  if (repetida) {
    return Response.json({ error: `Ya hay una aprobación vigente de la versión ${version} para ${anio}. Anúlala o registra otra versión.` }, { status: 409 });
  }

  const nombreArchivo = (file.name || `plan-firmado.${v.extension}`).slice(0, 200);
  const r2Key = `planes/aprobaciones/${anio}/${area}/${Date.now()}-${crypto.randomUUID()}-${nombreSeguroR2(nombreArchivo)}`;
  const env = getEnv(ctx);
  try {
    await env.R2.put(r2Key, bytes, { httpMetadata: { contentType: v.contentType } });
  } catch (e) {
    console.error("plan: R2", e);
    return Response.json({ error: "No se pudo guardar el archivo. Intenta de nuevo." }, { status: 500 });
  }
  let aprobacion;
  try {
    [aprobacion] = await db.insert(planAprobaciones).values({
      anio, area, version, aprobadoPor, fechaAprobacion, notas: notas || null,
      nombreArchivo, contentType: v.contentType, tamano: file.size, r2Key, registradoPor: user.id,
    }).returning();
  } catch (e) {
    console.error("plan: aprobación", e);
    await env.R2.delete(r2Key).catch(() => {});
    return Response.json({ error: "No se pudo registrar la aprobación. Intenta de nuevo." }, { status: 500 });
  }
  await logAudit(ctx, {
    entidad: "plan_aprobacion", entidadId: aprobacion.id, accion: "create",
    resumen: `Plan ${anio} (${etiquetaArea(area)}) versión ${version} aprobado por ${aprobadoPor} el ${fechaCorta(fechaAprobacion)}`,
  });
  return Response.json({ aprobacion }, { status: 201 });
};
