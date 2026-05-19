import type { APIRoute } from "astro";
import { eq, and, isNotNull, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { encuestasSatisfaccion, ordenes, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

// CSV escape: rodea con comillas si tiene coma/comillas/saltos; duplica comillas internas
function csv(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const db = getDb(ctx);
  const url = new URL(ctx.request.url);
  const filtroTec = url.searchParams.get("tecnico");
  const filtroCal = url.searchParams.get("cal");

  const conds: any[] = [isNotNull(encuestasSatisfaccion.respondidaEn)];
  if (filtroTec) conds.push(eq(ordenes.asignadoA, Number(filtroTec)));
  if (filtroCal) conds.push(eq(encuestasSatisfaccion.calificacion, Number(filtroCal)));

  const rows = await db
    .select({ e: encuestasSatisfaccion, o: ordenes, tec: usuarios })
    .from(encuestasSatisfaccion)
    .leftJoin(ordenes, eq(ordenes.id, encuestasSatisfaccion.ordenId))
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(and(...conds))
    .orderBy(desc(encuestasSatisfaccion.respondidaEn));

  const header = [
    "Fecha respuesta", "OT ID", "OT título", "Técnico",
    "Evaluador", "Email evaluador", "Calificación",
    "Comentario", "Leída", "Respuesta jefe",
  ];
  const lines = [header.map(csv).join(",")];
  for (const { e, o, tec } of rows) {
    lines.push([
      e.respondidaEn ?? "",
      o?.id ?? "",
      o?.titulo ?? "",
      tec?.nombre ?? "",
      e.destinatarioNombre ?? "",
      e.destinatarioEmail,
      e.calificacion ?? "",
      e.comentario ?? "",
      e.leidaEn ? "Sí" : "No",
      e.respuestaJefe ?? "",
    ].map(csv).join(","));
  }

  const csvBody = "﻿" + lines.join("\r\n"); // BOM para Excel UTF-8
  const fecha = new Date().toISOString().slice(0, 10);
  return new Response(csvBody, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="encuestas-${fecha}.csv"`,
    },
  });
};
