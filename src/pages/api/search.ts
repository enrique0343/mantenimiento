import type { APIRoute } from "astro";
import { sql, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ordenes, activos, tickets, items, requisiciones, comentarios, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

// Construye una query FTS5 segura desde texto libre del usuario.
// - Quita caracteres especiales de FTS5 (, " ' : * ( ) - ^ + . / \)
// - Tokeniza por espacios
// - Añade * al final de cada token (prefix match)
// - Une con AND implícito
function fts5Query(q: string): string {
  const tokens = q
    .replace(/["'(),:*^+./\\\-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `${t}*`).join(" ");
}

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const url = new URL(ctx.request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q || q.length < 2) {
    return Response.json({ resultados: { ordenes: [], equipos: [], tickets: [], items: [], requisiciones: [], comentarios: [] } });
  }
  const db = getDb(ctx);
  const ftsQ = fts5Query(q);
  const N = 6;

  // OTs por id (búsqueda numérica directa)
  const idNum = Number(q);
  const isNumeric = Number.isFinite(idNum) && /^\d+$/.test(q);

  let ordenesList: any[] = [];
  if (isNumeric) {
    const r = await db.execute(sql`
      SELECT id, titulo, estado, tipo, NULL as snippet
      FROM ordenes WHERE id = ${idNum} LIMIT 1
    `);
    ordenesList = (r as any).results ?? r ?? [];
  }
  if (ftsQ && ordenesList.length < N) {
    const r = await db.execute(sql`
      SELECT o.id, o.titulo, o.estado, o.tipo,
             snippet(ordenes_fts, -1, '<mark>', '</mark>', '...', 12) as snippet
      FROM ordenes_fts
      JOIN ordenes o ON o.id = ordenes_fts.rowid
      WHERE ordenes_fts MATCH ${ftsQ}
      ORDER BY rank
      LIMIT ${N}
    `);
    const more = (r as any).results ?? r ?? [];
    // Evitar duplicar el id ya encontrado
    const seen = new Set(ordenesList.map((o: any) => o.id));
    for (const row of more) {
      if (!seen.has(row.id)) { ordenesList.push(row); seen.add(row.id); }
    }
  }

  // Equipos
  let equiposList: any[] = [];
  if (ftsQ) {
    const r = await db.execute(sql`
      SELECT a.id, a.codigo, a.nombre, a.tipo, a.estado,
             snippet(activos_fts, -1, '<mark>', '</mark>', '...', 10) as snippet
      FROM activos_fts
      JOIN activos a ON a.id = activos_fts.rowid
      WHERE activos_fts MATCH ${ftsQ}
      ORDER BY rank
      LIMIT ${N}
    `);
    equiposList = (r as any).results ?? r ?? [];
  }

  // Tickets
  let ticketsList: any[] = [];
  if (isNumeric) {
    const r = await db.execute(sql`
      SELECT id, asunto, estado, tracking_token as trackingToken, NULL as snippet
      FROM tickets WHERE id = ${idNum} LIMIT 1
    `);
    ticketsList = (r as any).results ?? r ?? [];
  }
  if (ftsQ && ticketsList.length < N) {
    const r = await db.execute(sql`
      SELECT t.id, t.asunto, t.estado, t.tracking_token as trackingToken,
             snippet(tickets_fts, -1, '<mark>', '</mark>', '...', 12) as snippet
      FROM tickets_fts
      JOIN tickets t ON t.id = tickets_fts.rowid
      WHERE tickets_fts MATCH ${ftsQ}
      ORDER BY rank
      LIMIT ${N}
    `);
    const more = (r as any).results ?? r ?? [];
    const seen = new Set(ticketsList.map((t: any) => t.id));
    for (const row of more) {
      if (!seen.has(row.id)) { ticketsList.push(row); seen.add(row.id); }
    }
  }

  // Items
  let itemsList: any[] = [];
  if (ftsQ) {
    const r = await db.execute(sql`
      SELECT i.id, i.codigo, i.nombre, i.unidad,
             snippet(items_fts, -1, '<mark>', '</mark>', '...', 10) as snippet
      FROM items_fts
      JOIN items i ON i.id = items_fts.rowid
      WHERE items_fts MATCH ${ftsQ}
      ORDER BY rank
      LIMIT ${N}
    `);
    itemsList = (r as any).results ?? r ?? [];
  }

  // Requisiciones (no tiene FTS, búsqueda LIKE simple)
  let requisicionesList: any[] = [];
  if (q.length >= 2) {
    const pat = `%${q}%`;
    const r = await db.execute(sql`
      SELECT id, numero, estado FROM requisiciones
      WHERE numero LIKE ${pat} OR notas LIKE ${pat}
      ORDER BY id DESC LIMIT ${N}
    `);
    requisicionesList = (r as any).results ?? r ?? [];
  }

  // Comentarios (resultados con OT que los contiene)
  let comentariosList: any[] = [];
  if (ftsQ) {
    const r = await db.execute(sql`
      SELECT c.id, c.orden_id as ordenId, o.titulo as ordenTitulo,
             snippet(comentarios_fts, -1, '<mark>', '</mark>', '...', 14) as snippet,
             c.created_at as createdAt
      FROM comentarios_fts
      JOIN comentarios c ON c.id = comentarios_fts.rowid
      JOIN ordenes o ON o.id = c.orden_id
      WHERE comentarios_fts MATCH ${ftsQ}
      ORDER BY rank
      LIMIT ${N}
    `);
    comentariosList = (r as any).results ?? r ?? [];
  }

  return Response.json({
    resultados: {
      ordenes: ordenesList,
      equipos: equiposList,
      tickets: ticketsList,
      items: itemsList,
      requisiciones: requisicionesList,
      comentarios: comentariosList,
    },
  });
};
