import type { APIRoute } from "astro";
import { eq, lte, and } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { planesMantenimiento, ordenes, activos, actividades, actividadCategorias } from "@/lib/schema";
import { siguienteFecha } from "@/lib/frecuencias";
import { enviarRecordatoriosEncuestas } from "@/lib/encuestas-recordatorio";
import { enviarDigestDiario } from "@/lib/daily-digest";

export const prerender = false;

// Endpoint llamado por el Cron Worker. Protegido por header X-Cron-Secret.
// Genera órdenes preventivas para:
//   1) Planes de mantenimiento (planes_mantenimiento) cuyo proximaFecha <= hoy
//   2) Actividades recurrentes (actividades) cuyo proximaFecha <= hoy
export const POST: APIRoute = async (ctx) => {
  const env = getEnv(ctx);
  const expected = (env as any).CRON_SECRET as string | undefined;
  const got = ctx.request.headers.get("x-cron-secret");
  if (!expected || got !== expected) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const db = getDb(ctx);
  const hoy = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  let creadas = 0;
  const detalles: Array<{ origen: string; refId: number; ordenId: number; descripcion: string }> = [];

  // ── 1) Planes de mantenimiento de equipos ──────────────────────────────────
  // Generamos OT solo si proximaFecha <= hoy AND no hay aún OT generada para
  // este ciclo (ultimaGeneracion < proximaFecha). NO avanzamos proximaFecha
  // aquí: se avanza al cerrar la OT (lógica en PATCH /api/ordenes/[id]).
  const planesRows = await db
    .select({ p: planesMantenimiento, a: activos })
    .from(planesMantenimiento)
    .leftJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .where(and(eq(planesMantenimiento.activo, true), lte(planesMantenimiento.proximaFecha, hoy)));

  for (const r of planesRows) {
    const p = r.p;
    // Si ya generamos OT para este ciclo, saltar.
    if (p.ultimaGeneracion && p.ultimaGeneracion.slice(0, 10) >= p.proximaFecha) continue;

    const codigoActivo = r.a?.codigo ?? `Activo #${p.activoId}`;
    const titulo = `[Preventivo] ${p.titulo} - ${codigoActivo}`;
    const venc = new Date(p.proximaFecha);
    venc.setUTCDate(venc.getUTCDate() + p.alertaDiasAntes);

    const [orden] = await db
      .insert(ordenes)
      .values({
        titulo,
        descripcion: p.descripcion ?? null,
        tipo: "preventivo",
        prioridad: p.prioridad,
        estado: "abierta",
        activoId: p.activoId,
        asignadoA: p.asignadoA,
        creadoPor: null,
        planId: p.id,
        vencimiento: venc.toISOString(),
        checklistEjecucion: p.checklist ?? null,
      })
      .returning({ id: ordenes.id });

    // Solo marcar que ya se generó OT de este ciclo. proximaFecha avanza al cerrar.
    await db
      .update(planesMantenimiento)
      .set({ ultimaGeneracion: now })
      .where(eq(planesMantenimiento.id, p.id));

    creadas++;
    detalles.push({ origen: "equipo", refId: p.id, ordenId: orden.id, descripcion: codigoActivo });
  }

  // ── 2) Actividades recurrentes ─────────────────────────────────────────────
  // Mismo patrón: solo generar si no hay OT abierta del ciclo actual.
  const actRows = await db
    .select({ a: actividades, c: actividadCategorias })
    .from(actividades)
    .leftJoin(actividadCategorias, eq(actividadCategorias.id, actividades.categoriaId))
    .where(and(eq(actividades.activo, true), lte(actividades.proximaFecha, hoy)));

  for (const r of actRows) {
    const a = r.a;
    if (a.ultimaGeneracion && a.ultimaGeneracion.slice(0, 10) >= a.proximaFecha) continue;

    const cat = r.c;
    const titulo = `[Actividad${cat ? ` · ${cat.icono ?? ""} ${cat.nombre}` : ""}] ${a.titulo}`;
    const venc = new Date(a.proximaFecha);
    venc.setUTCDate(venc.getUTCDate() + a.alertaDiasAntes);

    const [orden] = await db
      .insert(ordenes)
      .values({
        titulo,
        descripcion: a.descripcion ?? null,
        tipo: "preventivo",
        prioridad: a.prioridad,
        estado: "abierta",
        actividadId: a.id,
        asignadoA: a.asignadoA,
        creadoPor: null,
        vencimiento: venc.toISOString(),
        checklistEjecucion: a.checklist ?? null,
      })
      .returning({ id: ordenes.id });

    // Solo marcar generación. proximaFecha avanza al cerrar OT.
    await db
      .update(actividades)
      .set({ ultimaGeneracion: now })
      .where(eq(actividades.id, a.id));

    creadas++;
    detalles.push({ origen: "actividad", refId: a.id, ordenId: orden.id, descripcion: a.titulo });
  }

  // Recordatorios de encuestas de satisfacción no respondidas (>48h)
  let recordatoriosEnviados = 0;
  try {
    const r = await enviarRecordatoriosEncuestas(ctx);
    recordatoriosEnviados = r.enviados;
  } catch (e) {
    console.error("recordatorios encuestas:", e);
  }

  // Digest diario: solo si la hora UTC está entre 11:30 y 12:30 (= 5:30-6:30 SV).
  // Esta ventana evita enviarlo varias veces si el cron corre múltiples veces
  // al día. Si solo corres una vez al día a otra hora, mejor usa el endpoint
  // dedicado /api/cron/daily-digest con su propio trigger.
  let digestEnviados = 0;
  const horaUtc = new Date().getUTCHours();
  const minUtc = new Date().getUTCMinutes();
  const enVentanaDigest = (horaUtc === 11 && minUtc >= 30) || (horaUtc === 12 && minUtc <= 30);
  if (enVentanaDigest) {
    try {
      const r = await enviarDigestDiario(ctx);
      digestEnviados = r.enviados;
    } catch (e) {
      console.error("digest diario:", e);
    }
  }

  return Response.json({ ok: true, fecha: hoy, creadas, detalles, recordatoriosEnviados, digestEnviados });
};
