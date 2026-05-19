import type { APIRoute } from "astro";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { usuarios, ROLES } from "@/lib/schema";
import { hashPassword, requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const rows = await db
    .select({
      id: usuarios.id,
      email: usuarios.email,
      nombre: usuarios.nombre,
      rol: usuarios.rol,
      especialidad: usuarios.especialidad,
      tarifaHora: usuarios.tarifaHora,
      activo: usuarios.activo,
    })
    .from(usuarios)
    .orderBy(desc(usuarios.id));
  return Response.json({ usuarios: rows });
};

const createSchema = z.object({
  email: z.string().email(),
  nombre: z.string().min(2),
  password: z.string().min(6),
  rol: z.enum(ROLES),
  especialidad: z.enum(["general", "biomedico", "ambos"]).nullable().optional(),
  tarifaHora: z.number().nonnegative().optional(),
  sucursalId: z.number().int().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const [row] = await db
      .insert(usuarios)
      .values({
        email: parsed.data.email,
        nombre: parsed.data.nombre,
        rol: parsed.data.rol,
        especialidad: parsed.data.especialidad ?? null,
        tarifaHora: parsed.data.tarifaHora ?? 0,
        passwordHash,
      })
      .returning({
        id: usuarios.id,
        email: usuarios.email,
        nombre: usuarios.nombre,
        rol: usuarios.rol,
        especialidad: usuarios.especialidad,
        activo: usuarios.activo,
      });
    return Response.json({ usuario: row }, { status: 201 });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return Response.json({ error: "Email ya registrado" }, { status: 409 });
    }
    throw e;
  }
};
