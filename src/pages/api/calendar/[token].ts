import type { APIRoute } from "astro";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { usuarios, ordenes, planesMantenimiento, actividades, activos } from "@/lib/schema";

export const prerender = false;

// Endpoint público (con token) para suscribir calendario en Google/Outlook/Apple.
// URL: /api/calendar/<calendar_token>.ics

function fmtIcsDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function fmtIcsDateOnly(date: string): string {
  // YYYY-MM-DD → YYYYMMDD
  return date.replace(/-/g, "");
}

function escapeIcs(s: string): string {
  return (s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export const GET: APIRoute = async (ctx) => {
  const tokenWithExt = ctx.params.token!;
  const token = tokenWithExt.replace(/\.ics$/, "");
  const db = getDb(ctx);

  const [u] = await db.select({ id: usuarios.id, nombre: usuarios.nombre })
    .from(usuarios).where(eq(usuarios.calendarToken, token)).limit(1);
  if (!u) return new Response("Token inválido", { status: 404 });

  const env = (ctx.locals as any)?.runtime?.env ?? {};
  const baseUrl = env.APP_URL || `${ctx.url.origin}`;

  // OTs activas asignadas
  const ots = await db
    .select({ o: ordenes, a: activos })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .where(and(
      eq(ordenes.asignadoA, u.id),
      eq(ordenes.estado, "abierta"),
    ));

  const otsEnProceso = await db
    .select({ o: ordenes, a: activos })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .where(and(
      eq(ordenes.asignadoA, u.id),
      eq(ordenes.estado, "en_proceso"),
    ));

  // Planes preventivos asignados
  const planes = await db
    .select({ p: planesMantenimiento, a: activos })
    .from(planesMantenimiento)
    .leftJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .where(and(
      eq(planesMantenimiento.asignadoA, u.id),
      eq(planesMantenimiento.activo, true),
    ));

  // Actividades recurrentes asignadas
  const acts = await db
    .select()
    .from(actividades)
    .where(and(
      eq(actividades.asignadoA, u.id),
      eq(actividades.activo, true),
    ));

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mantenimiento Avante//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Mantenimiento - ${u.nombre}`,
  ];

  function addEvent(uid: string, summary: string, dtStart: string, isDate: boolean, descripcion: string, url: string) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}@mantenimiento`);
    lines.push(`DTSTAMP:${fmtIcsDate(new Date().toISOString())}`);
    if (isDate) {
      lines.push(`DTSTART;VALUE=DATE:${fmtIcsDateOnly(dtStart)}`);
    } else {
      lines.push(`DTSTART:${fmtIcsDate(dtStart)}`);
    }
    lines.push(`SUMMARY:${escapeIcs(summary)}`);
    lines.push(`DESCRIPTION:${escapeIcs(descripcion)}`);
    lines.push(`URL:${url}`);
    lines.push("END:VEVENT");
  }

  for (const r of [...ots, ...otsEnProceso]) {
    const target = r.o.vencimiento || r.o.createdAt;
    const eq = r.a ? `${r.a.codigo} - ${r.a.nombre}` : "";
    addEvent(
      `ot-${r.o.id}`,
      `🛠 OT #${r.o.id}: ${r.o.titulo} [${r.o.prioridad}]`,
      target,
      false,
      `${eq}${r.o.descripcion ? "\n" + r.o.descripcion : ""}`,
      `${baseUrl}/ordenes/${r.o.id}`
    );
  }

  for (const r of planes) {
    const eq = r.a ? `${r.a.codigo} - ${r.a.nombre}` : "";
    addEvent(
      `plan-${r.p.id}-${r.p.proximaFecha}`,
      `🔧 Preventivo: ${r.p.titulo}`,
      r.p.proximaFecha,
      true,
      `Plan ${r.p.frecuencia} · ${eq}`,
      r.a ? `${baseUrl}/activos/${r.a.id}` : baseUrl
    );
  }

  for (const a of acts) {
    addEvent(
      `act-${a.id}-${a.proximaFecha}`,
      `📌 ${a.titulo}`,
      a.proximaFecha,
      true,
      `Actividad ${a.frecuencia}${a.descripcion ? "\n" + a.descripcion : ""}`,
      `${baseUrl}/actividades/${a.id}`
    );
  }

  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n"), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "public, max-age=900",
    },
  });
};
