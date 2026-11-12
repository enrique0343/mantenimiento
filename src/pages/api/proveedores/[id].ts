// Un proveedor. GET: quien ve lo biomédico. PATCH: admin y jefe (la acreditación se revisa
// con lo guardado más lo nuevo). DELETE: admin; desactiva, no borra.
import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { proveedores } from "@/lib/schema";
import { calcularDiff, logAudit, resumenCambios } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, ROLES_BIO_VER } from "@/lib/biomedico";
import { leerDatosProveedor, validarAcreditacion } from "@/lib/metrologia";
import { errorJson, exigirRol, idDeRuta } from "@/lib/metrologia-db";

export const prerender = false;

async function proveedorPorId(db: ReturnType<typeof getDb>, valor: string | undefined) {
  const id = idDeRuta(valor);
  if (!id) return null;
  const [row] = await db.select().from(proveedores).where(eq(proveedores.id, id)).limit(1);
  return row ?? null;
}

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const row = await proveedorPorId(getDb(ctx), ctx.params.id);
  if (!row) return errorJson("Proveedor no encontrado", 404);
  return Response.json({ proveedor: row });
};

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, "Solo el jefe o el administrador editan proveedores.");
  if (!user) return response;
  const db = getDb(ctx);
  const actual = await proveedorPorId(db, ctx.params.id);
  if (!actual) return errorJson("Proveedor no encontrado", 404);
  const body = await ctx.request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorJson("Datos no válidos.", 400);
  const leido = leerDatosProveedor(body as Record<string, unknown>, true);
  if (!leido.ok) return errorJson(leido.error, 400);
  const error = validarAcreditacion({ ...actual, ...leido.datos });
  if (error) return errorJson(error, 400);

  const diff = calcularDiff(actual as unknown as Record<string, unknown>, leido.datos as Record<string, unknown>);
  if (Object.keys(diff).length === 0) return Response.json({ proveedor: actual });
  const [row] = await db.update(proveedores).set(leido.datos).where(eq(proveedores.id, actual.id)).returning();
  await logAudit(ctx, {
    entidad: "proveedor", entidadId: actual.id, accion: "update", cambios: diff,
    resumen: `Proveedor «${row.nombre}»: ${resumenCambios(diff)}`,
  });
  return Response.json({ proveedor: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ["admin"], "Solo el administrador desactiva proveedores.");
  if (!user) return response;
  const db = getDb(ctx);
  const actual = await proveedorPorId(db, ctx.params.id);
  if (!actual) return errorJson("Proveedor no encontrado", 404);
  if (actual.activo) {
    await db.update(proveedores).set({ activo: false }).where(eq(proveedores.id, actual.id));
    await logAudit(ctx, {
      entidad: "proveedor", entidadId: actual.id, accion: "estado",
      cambios: { activo: { antes: true, despues: false } }, resumen: `Proveedor desactivado: ${actual.nombre}`,
    });
  }
  return Response.json({ ok: true });
};
