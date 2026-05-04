import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { usuarios, ROLES } from "@/lib/schema";
import { hashPassword, requireUser } from "@/lib/auth";

export const prerender = false;

const updateSchema = z.object({
  nombre: z.string().min(2).optional(),
  email: z.string().email().optional(),
  rol: z.enum(ROLES).optional(),
  sucursalId: z.number().int().nullable().optional(),
  activo: z.boolean().optional(),
  password: z.string().min(6).optional(), // si viene, resetea la contraseña
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  // Evitar que un admin se desactive o quite admin a sí mismo
  if (id === user.id) {
    if (parsed.data.activo === false) return Response.json({ error: "No puedes desactivarte a ti mismo" }, { status: 400 });
    if (parsed.data.rol && parsed.data.rol !== "admin") return Response.json({ error: "No puedes quitarte el rol admin" }, { status: 400 });
  }

  const db = getDb(ctx);
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.password) {
    data.passwordHash = await hashPassword(parsed.data.password);
    delete data.password;
  }

  try {
    const [row] = await db
      .update(usuarios)
      .set(data)
      .where(eq(usuarios.id, id))
      .returning({ id: usuarios.id, email: usuarios.email, nombre: usuarios.nombre, rol: usuarios.rol, activo: usuarios.activo });
    if (!row) return Response.json({ error: "Usuario no encontrado" }, { status: 404 });
    return Response.json({ usuario: row });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return Response.json({ error: "Email ya registrado" }, { status: 409 });
    }
    throw e;
  }
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  if (id === user.id) return Response.json({ error: "No puedes eliminarte a ti mismo" }, { status: 400 });
  const db = getDb(ctx);
  // Soft delete (preserva referencias en OTs/auditoria)
  await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, id));
  return Response.json({ ok: true });
};
