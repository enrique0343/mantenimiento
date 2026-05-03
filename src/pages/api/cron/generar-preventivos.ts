import type { APIRoute } from "astro";
import { eq, lte, and } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { planesMantenimiento, ordenes, activos } from "@/lib/schema";
import { siguienteFecha } from "@/lib/frecuencias";

export const prerender = false;

// Endpoint llamado por el Cron Worker. Protegido por header X-Cron-Secret.
// Genera ordenes preventivas para todos los planes con proximaFecha <= hoy.
export const POST: APIRoute = async (ctx) => {
  const env = getEnv(ctx);
  const expected = (env as any).CRON_SECRET as string | undefined;
  const got = ctx.request.headers.get("x-cron-secret");
  if (!expected || got !== expected) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const db = getDb(ctx);
  const hoy = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({ p: planesMantenimiento, a: activos })
    .from(planesMantenimiento)
    .leftJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .where(
      and(
        eq(planesMantenimiento.activo, true),
        lte(planesMantenimiento.proximaFecha, hoy)
      )
    );

  let creadas = 0;
  const detalles: Array<{ planId: number; ordenId: number; activo: string }> = [];

  for (const r of rows) {
    const p = r.p;
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
        asignadoA: null, // opcion B: sin asignar, admin decide
        creadoPor: null,
        planId: p.id,
        vencimiento: venc.toISOString(),
        // Copia el checklist del plan a la orden para que el tecnico lo marque
        checklistEjecucion: p.checklist ?? null,
      })
      .returning({ id: ordenes.id });

    const proxima = siguienteFecha(p.proximaFecha, p.frecuencia as any);
    await db
      .update(planesMantenimiento)
      .set({ proximaFecha: proxima, ultimaGeneracion: new Date().toISOString() })
      .where(eq(planesMantenimiento.id, p.id));

    creadas++;
    detalles.push({ planId: p.id, ordenId: orden.id, activo: codigoActivo });
  }

  return Response.json({ ok: true, fecha: hoy, creadas, detalles });
};
