// Proveedores. GET: quien ve lo biomédico (los laboratorios de calibración salen de aquí).
// POST: admin y jefe, con la acreditación completa si es laboratorio acreditado.
import type { APIRoute } from "astro";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { proveedores } from "@/lib/schema";
import { logAudit } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, ROLES_BIO_VER } from "@/lib/biomedico";
import { leerDatosProveedor, validarAcreditacion, type DatosProveedor } from "@/lib/metrologia";
import { errorJson, exigirRol } from "@/lib/metrologia-db";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const rows = await getDb(ctx).select().from(proveedores).orderBy(desc(proveedores.id));
  return Response.json({ proveedores: rows });
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, "Solo el jefe o el administrador registran proveedores.");
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorJson("Datos no válidos.", 400);
  const leido = leerDatosProveedor(body as Record<string, unknown>, false);
  if (!leido.ok) return errorJson(leido.error, 400);
  const datos = { esLaboratorioAcreditado: false, ...leido.datos } as Omit<DatosProveedor, "activo"> & { activo?: boolean };
  const error = validarAcreditacion(datos);
  if (error) return errorJson(error, 400);

  const [row] = await getDb(ctx).insert(proveedores).values(datos).returning();
  await logAudit(ctx, {
    entidad: "proveedor", entidadId: row.id, accion: "create",
    resumen: `Proveedor creado: ${row.nombre}${row.esLaboratorioAcreditado ? " (laboratorio acreditado)" : ""}`,
  });
  return Response.json({ proveedor: row }, { status: 201 });
};
