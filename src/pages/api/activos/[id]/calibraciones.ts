import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { calibraciones, activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const prerender = false;

const MAX_BYTES = 15 * 1024 * 1024;

// Sincroniza activos.ultimaCalibracion/proximaCalibracion con la calibración
// más reciente registrada (o las limpia si ya no quedan).
async function resyncActivo(db: ReturnType<typeof getDb>, activoId: number) {
  const [ultima] = await db
    .select()
    .from(calibraciones)
    .where(eq(calibraciones.activoId, activoId))
    .orderBy(desc(calibraciones.fechaCalibracion))
    .limit(1);
  await db.update(activos).set({
    ultimaCalibracion: ultima?.fechaCalibracion ?? null,
    proximaCalibracion: ultima?.proximaCalibracion ?? null,
  }).where(eq(activos.id, activoId));
}

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const activoId = Number(ctx.params.id);
  const db = getDb(ctx);
  const rows = await db
    .select()
    .from(calibraciones)
    .where(eq(calibraciones.activoId, activoId))
    .orderBy(desc(calibraciones.fechaCalibracion));
  return Response.json({ calibraciones: rows });
};

const createSchema = z.object({
  fechaCalibracion: z.string().min(1),
  proximaCalibracion: z.string().nullable().optional(),
  laboratorioId: z.number().int().nullable().optional(),
  laboratorioExterno: z.string().nullable().optional(),
  numeroCertificado: z.string().nullable().optional(),
  patronReferencia: z.string().nullable().optional(),
  resultado: z.enum(["conforme", "conforme_con_ajuste", "no_conforme"]).default("conforme"),
  incertidumbre: z.string().nullable().optional(),
  realizadoPor: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const activoId = Number(ctx.params.id);
  const db = getDb(ctx);

  const [activo] = await db.select().from(activos).where(eq(activos.id, activoId)).limit(1);
  if (!activo) return Response.json({ error: "Equipo no encontrado" }, { status: 404 });

  // Acepta JSON o multipart (cuando se adjunta el certificado PDF)
  const ct = ctx.request.headers.get("content-type") ?? "";
  let data: Record<string, unknown>;
  let file: File | null = null;
  if (ct.includes("multipart/form-data")) {
    const form = await ctx.request.formData();
    const raw = form.get("file");
    if (raw instanceof File && raw.size > 0) file = raw;
    data = {
      fechaCalibracion: form.get("fechaCalibracion"),
      proximaCalibracion: form.get("proximaCalibracion") || null,
      laboratorioId: form.get("laboratorioId") ? Number(form.get("laboratorioId")) : null,
      laboratorioExterno: (form.get("laboratorioExterno") as string) || null,
      numeroCertificado: (form.get("numeroCertificado") as string) || null,
      patronReferencia: (form.get("patronReferencia") as string) || null,
      resultado: (form.get("resultado") as string) || "conforme",
      incertidumbre: (form.get("incertidumbre") as string) || null,
      realizadoPor: (form.get("realizadoPor") as string) || null,
      notas: (form.get("notas") as string) || null,
    };
  } else {
    data = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
  }

  const parsed = createSchema.safeParse(data);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  if (parsed.data.resultado === "no_conforme" && !parsed.data.notas?.trim()) {
    return Response.json({ error: "Un resultado No conforme requiere una nota explicativa" }, { status: 400 });
  }

  // Sube el certificado a R2 si vino adjunto
  let certificadoR2Key: string | null = null;
  if (file) {
    if (file.size > MAX_BYTES) return Response.json({ error: "Archivo supera 15MB" }, { status: 413 });
    const env = getEnv(ctx);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    certificadoR2Key = `calibraciones/${activoId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    await env.R2.put(certificadoR2Key, file.stream(), { httpMetadata: { contentType: file.type } });
  }

  const [row] = await db.insert(calibraciones).values({
    activoId,
    ...parsed.data,
    certificadoR2Key,
    usuarioId: user.id,
  }).returning();

  await resyncActivo(db, activoId);
  await logAudit(ctx, {
    entidad: "activo",
    entidadId: activoId,
    accion: "create",
    resumen: `Calibración registrada (${parsed.data.resultado})`,
  });

  return Response.json({ calibracion: row }, { status: 201 });
};
