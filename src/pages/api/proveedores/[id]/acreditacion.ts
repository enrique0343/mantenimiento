// Certificado de acreditación del laboratorio (K-B5). POST: admin y jefe lo suben (el
// anterior queda en R2 y su clave en la bitácora). GET: quien ve lo biomédico.
import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { proveedores } from "@/lib/schema";
import { logAudit } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, ROLES_BIO_VER, nombreSeguroR2 } from "@/lib/biomedico";
import {
  borrarObjetoR2, errorJson, exigirRol, guardarArchivoEvidencia, idDeRuta, leerCuerpo, respuestaArchivoR2,
} from "@/lib/metrologia-db";

export const prerender = false;

async function proveedor(db: ReturnType<typeof getDb>, valor: string | undefined) {
  const id = idDeRuta(valor);
  if (!id) return null;
  const [p] = await db.select({
    id: proveedores.id, nombre: proveedores.nombre, esLaboratorioAcreditado: proveedores.esLaboratorioAcreditado,
    acreditacionR2Key: proveedores.acreditacionR2Key, acreditacionArchivoNombre: proveedores.acreditacionArchivoNombre,
  }).from(proveedores).where(eq(proveedores.id, id)).limit(1);
  return p ?? null;
}

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const p = await proveedor(getDb(ctx), ctx.params.id);
  if (!p) return errorJson("Proveedor no encontrado", 404);
  if (!p.acreditacionR2Key) return errorJson("Sin certificado de acreditación", 404);
  return respuestaArchivoR2(getEnv(ctx), p.acreditacionR2Key, `acreditacion-${nombreSeguroR2(p.nombre, 60)}`);
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, "Solo el jefe o el administrador suben el certificado de acreditación.");
  if (!user) return response;
  const db = getDb(ctx);
  const p = await proveedor(db, ctx.params.id);
  if (!p) return errorJson("Proveedor no encontrado", 404);
  if (!p.esLaboratorioAcreditado) return errorJson("Marca primero el proveedor como laboratorio acreditado.", 409);

  const cuerpo = await leerCuerpo(ctx.request);
  if (!cuerpo.ok) return errorJson(cuerpo.error, 400);
  if (!cuerpo.file) return errorJson("Elige el archivo del certificado de acreditación (PDF o foto).", 400);
  const env = getEnv(ctx);
  const g = await guardarArchivoEvidencia(env, `proveedores/${p.id}/acreditacion`, cuerpo.file);
  if (!g.ok) return errorJson(g.error, g.status);
  try {
    await db.update(proveedores)
      .set({ acreditacionR2Key: g.r2Key, acreditacionArchivoNombre: g.nombre, acreditacionContentType: g.contentType })
      .where(eq(proveedores.id, p.id));
  } catch (e) {
    await borrarObjetoR2(env, g.r2Key);
    throw e;
  }
  await logAudit(ctx, {
    entidad: "proveedor", entidadId: p.id, accion: "update",
    cambios: { acreditacionR2Key: { antes: p.acreditacionR2Key, despues: g.r2Key } },
    resumen: `Certificado de acreditación cargado: ${g.nombre}`,
  });
  return Response.json({ ok: true, nombre: g.nombre }, { status: 201 });
};
