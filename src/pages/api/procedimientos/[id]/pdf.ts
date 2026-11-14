import type { APIRoute } from "astro";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { procedimientos, procedimientoVersiones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { puedeAdministrarProcedimientos, puedeVerProcedimientos } from "@/lib/procedimientos";
import { contentDisposition, hoySV, nombreSeguroR2 } from "@/lib/biomedico";
import { nombreDescargaPdf, validarPdf } from "@/lib/protocolos";

export const prerender = false;

// Fase 59 · WP-G. PDF aprobado de un documento de la biblioteca (procedimiento o
// protocolo institucional). Un solo PDF por documento: al reemplazarlo se borra
// el anterior de R2 y queda línea en el historial de versiones y en la bitácora.
// Lo ve quien ve la biblioteca (si el documento está retirado, solo admin y jefe);
// lo suben y lo quitan admin y jefe.

const idDe = (raw: string | undefined): number | null => {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const retirado = (p: { activo: boolean; estado: string }) => !p.activo || p.estado === "retirado";
const sinPermiso = () => Response.json({ error: "Sin permisos" }, { status: 403 });

const COLUMNAS = {
  id: procedimientos.id,
  codigoCorto: procedimientos.codigoCorto,
  version: procedimientos.version,
  estado: procedimientos.estado,
  activo: procedimientos.activo,
  r2Key: procedimientos.r2Key,
  pdfNombre: procedimientos.pdfNombre,
  pdfVersion: procedimientos.pdfVersion,
};

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerProcedimientos(user.rol)) return sinPermiso();
  const id = idDe(ctx.params.id);
  if (!id) return Response.json({ error: "Documento inválido" }, { status: 400 });

  const db = getDb(ctx);
  const [p] = await db.select(COLUMNAS).from(procedimientos).where(eq(procedimientos.id, id)).limit(1);
  if (!p) return Response.json({ error: "No encontrado" }, { status: 404 });
  if (retirado(p) && !puedeAdministrarProcedimientos(user.rol)) {
    return Response.json({ error: "Documento retirado: su PDF ya no se usa." }, { status: 403 });
  }
  if (!p.r2Key) return Response.json({ error: "Este documento no tiene PDF cargado." }, { status: 404 });
  const obj = await getEnv(ctx).R2.get(p.r2Key);
  if (!obj) return Response.json({ error: "El archivo no está disponible." }, { status: 404 });

  const descargar = new URL(ctx.request.url).searchParams.get("descargar") === "1";
  return new Response(obj.body as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": contentDisposition(nombreDescargaPdf(p.codigoCorto, p.pdfVersion), descargar ? "attachment" : "inline"),
      // Los enlaces llevan ?v=<fecha de carga>: un PDF reemplazado no se sirve desde la caché.
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarProcedimientos(user.rol)) return sinPermiso();
  const id = idDe(ctx.params.id);
  if (!id) return Response.json({ error: "Documento inválido" }, { status: 400 });

  const db = getDb(ctx);
  const [p] = await db.select(COLUMNAS).from(procedimientos).where(eq(procedimientos.id, id)).limit(1);
  if (!p) return Response.json({ error: "No encontrado" }, { status: 404 });
  if (retirado(p)) return Response.json({ error: "El documento está retirado: no se le sube PDF." }, { status: 409 });

  const form = await ctx.request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Elige el PDF." }, { status: 400 });
  // Tamaño y firma antes de leer el archivo entero.
  const cabecera = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const v = validarPdf(file.size, cabecera);
  if (!v.ok) return Response.json({ error: v.error }, { status: v.status });
  const bytes = new Uint8Array(await file.arrayBuffer());

  const env = getEnv(ctx);
  const key = `procedimientos/${id}/${Date.now()}-${crypto.randomUUID()}-${nombreSeguroR2(file.name)}`;
  try {
    await env.R2.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
  } catch {
    return Response.json({ error: "No se pudo guardar el PDF." }, { status: 500 });
  }

  const nombre = (file.name || "documento.pdf").slice(0, 200);
  const subidoEn = new Date().toISOString();
  const anterior = p.r2Key;
  let guardado: { id: number }[] = [];
  try {
    // Solo si nadie cambió el PDF entre la lectura y ahora (si no, el otro archivo quedaría huérfano).
    guardado = await db
      .update(procedimientos)
      .set({ r2Key: key, pdfNombre: nombre, pdfTamano: file.size, pdfVersion: p.version, pdfSubidoPor: user.id, pdfSubidoEn: subidoEn })
      .where(and(eq(procedimientos.id, id), anterior ? eq(procedimientos.r2Key, anterior) : isNull(procedimientos.r2Key)))
      .returning({ id: procedimientos.id });
  } catch {
    await env.R2.delete(key).catch(() => {});
    return Response.json({ error: "No se pudo guardar el PDF." }, { status: 500 });
  }
  if (!guardado.length) {
    await env.R2.delete(key).catch(() => {});
    return Response.json({ error: "Otra persona acaba de cambiar el PDF de este documento. Recarga la página." }, { status: 409 });
  }
  if (anterior) await env.R2.delete(anterior).catch(() => {});

  const cambio = anterior
    ? `PDF reemplazado: ${p.pdfNombre ?? "archivo anterior"} → ${nombre} (versión ${p.version})`
    : `PDF aprobado cargado: ${nombre} (versión ${p.version})`;
  try {
    await db.insert(procedimientoVersiones).values({ procedimientoId: id, version: p.version, fecha: hoySV(), responsableId: user.id, cambio });
  } catch {
    // El PDF ya quedó guardado; la bitácora de abajo también deja constancia.
  }
  await logAudit(ctx, { entidad: "procedimiento", entidadId: id, accion: "update", resumen: cambio });
  return Response.json({ pdf: { nombre, tamano: file.size, version: p.version, subidoEn } }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarProcedimientos(user.rol)) return sinPermiso();
  const id = idDe(ctx.params.id);
  if (!id) return Response.json({ error: "Documento inválido" }, { status: 400 });

  const db = getDb(ctx);
  const [p] = await db.select(COLUMNAS).from(procedimientos).where(eq(procedimientos.id, id)).limit(1);
  if (!p) return Response.json({ error: "No encontrado" }, { status: 404 });
  if (!p.r2Key) return Response.json({ error: "Este documento no tiene PDF cargado." }, { status: 404 });

  const quitado = await db
    .update(procedimientos)
    .set({ r2Key: null, pdfNombre: null, pdfTamano: null, pdfVersion: null, pdfSubidoPor: null, pdfSubidoEn: null })
    .where(and(eq(procedimientos.id, id), eq(procedimientos.r2Key, p.r2Key)))
    .returning({ id: procedimientos.id });
  if (!quitado.length) {
    return Response.json({ error: "Otra persona acaba de cambiar el PDF de este documento. Recarga la página." }, { status: 409 });
  }
  await getEnv(ctx).R2.delete(p.r2Key).catch(() => {});

  const cambio = `PDF quitado: ${p.pdfNombre ?? "archivo sin nombre"}`;
  try {
    await db.insert(procedimientoVersiones).values({ procedimientoId: id, version: p.version, fecha: hoySV(), responsableId: user.id, cambio });
  } catch {
    // Ya no hay PDF; la bitácora de abajo también deja constancia.
  }
  await logAudit(ctx, { entidad: "procedimiento", entidadId: id, accion: "update", resumen: cambio });
  return Response.json({ ok: true });
};
