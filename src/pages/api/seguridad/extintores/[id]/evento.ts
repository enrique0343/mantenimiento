import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { extintores, extintorEventos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeAdministrarSeguridad, calcularProximaFecha } from "@/lib/extintores";

export const prerender = false;

const schema = z.object({
  tipo: z.enum(["inspeccion", "recarga", "prueba_hidrostatica", "reemplazo", "baja", "otro"]),
  fecha: z.string().min(1), // YYYY-MM-DD
  proveedorId: z.number().int().nullable().optional(),
  costo: z.number().nonnegative().nullable().optional(),
  notas: z.string().nullable().optional(),
  evidenciaBase64: z.string().nullable().optional(),
});

function dataUrlToBytes(dataUrl: string) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType: m[1] };
}

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarSeguridad(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const env = getEnv(ctx);
  const db = getDb(ctx);

  const [ext] = await db.select().from(extintores).where(eq(extintores.id, id)).limit(1);
  if (!ext) return Response.json({ error: "Extintor no existe" }, { status: 404 });

  // Sube evidencia si vino
  let evidenciaR2: string | null = null;
  if (parsed.data.evidenciaBase64) {
    const r = dataUrlToBytes(parsed.data.evidenciaBase64);
    if (r) {
      const ext2 = (r.contentType.split("/")[1] ?? "bin").split("+")[0];
      evidenciaR2 = `extintores/${id}/eventos/${Date.now()}-${parsed.data.tipo}.${ext2}`;
      await env.R2.put(evidenciaR2, r.bytes, { httpMetadata: { contentType: r.contentType } });
    }
  }

  // Calcula proxima fecha si aplica
  let proximaFecha: string | null = null;
  if (parsed.data.tipo === "inspeccion" || parsed.data.tipo === "recarga" || parsed.data.tipo === "prueba_hidrostatica") {
    proximaFecha = calcularProximaFecha(parsed.data.tipo, parsed.data.fecha, {
      diasInspeccion: ext.diasInspeccion,
      mesesRecarga: ext.mesesRecarga,
      aniosPrueba: ext.aniosPrueba,
    });
  }

  // Inserta evento
  const [evento] = await db
    .insert(extintorEventos)
    .values({
      extintorId: id,
      tipo: parsed.data.tipo,
      fecha: parsed.data.fecha,
      proximaFecha,
      responsableId: user.id,
      proveedorId: parsed.data.proveedorId ?? null,
      costo: parsed.data.costo ?? null,
      notas: parsed.data.notas ?? null,
      evidenciaR2,
    })
    .returning();

  // Actualiza fechas en el extintor
  const updates: Record<string, unknown> = {};
  if (parsed.data.tipo === "inspeccion") {
    updates.ultimaInspeccion = parsed.data.fecha;
    updates.proximaInspeccion = proximaFecha;
  } else if (parsed.data.tipo === "recarga") {
    updates.ultimaRecarga = parsed.data.fecha;
    updates.proximaRecarga = proximaFecha;
  } else if (parsed.data.tipo === "prueba_hidrostatica") {
    updates.ultimaPruebaHidrostatica = parsed.data.fecha;
    updates.proximaPruebaHidrostatica = proximaFecha;
  } else if (parsed.data.tipo === "baja") {
    updates.estado = "baja";
    updates.activo = false;
  } else if (parsed.data.tipo === "reemplazo") {
    // El reemplazo da de baja el actual; el nuevo se registra aparte
    updates.estado = "baja";
    updates.activo = false;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(extintores).set(updates).where(eq(extintores.id, id));
  }

  return Response.json({ evento, proximaFecha }, { status: 201 });
};
