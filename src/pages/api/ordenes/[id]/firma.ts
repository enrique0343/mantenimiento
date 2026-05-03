import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { ordenes } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const schema = z.object({
  rol: z.enum(["tecnico", "jefe", "solicitante"]),
  nombre: z.string().min(1),
  // Imagen base64 dataURL: "data:image/png;base64,...."
  imagenDataUrl: z.string().min(20),
});

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) throw new Error("Formato dataURL invalido");
  const contentType = m[1];
  const b64 = m[2];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType };
}

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const env = getEnv(ctx);

  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  // Permisos: tecnico solo firma como tecnico, admin/jefe puede firmar como jefe
  if (parsed.data.rol === "jefe" && !["admin", "jefe"].includes(user.rol)) {
    return Response.json({ error: "Solo admin/jefe puede firmar como jefe" }, { status: 403 });
  }

  const { bytes, contentType } = dataUrlToBytes(parsed.data.imagenDataUrl);
  const r2Key = `firmas/${id}/${parsed.data.rol}-${Date.now()}.png`;
  await env.R2.put(r2Key, bytes, { httpMetadata: { contentType } });

  const now = new Date().toISOString();
  const data: Record<string, unknown> = {};
  if (parsed.data.rol === "tecnico") {
    data.firmaTecnicoR2 = r2Key;
    data.firmaTecnicoNombre = parsed.data.nombre;
    data.firmaTecnicoFecha = now;
  } else if (parsed.data.rol === "jefe") {
    data.firmaJefeR2 = r2Key;
    data.firmaJefeNombre = parsed.data.nombre;
    data.firmaJefeFecha = now;
  } else {
    data.firmaSolicitanteR2 = r2Key;
    data.firmaSolicitanteNombre = parsed.data.nombre;
    data.firmaSolicitanteFecha = now;
  }

  const db = getDb(ctx);
  await db.update(ordenes).set(data).where(eq(ordenes.id, id));
  return Response.json({ ok: true, r2Key });
};
