import type { APIRoute } from "astro";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sucursales, ubicaciones, activos, planesMantenimiento } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import inventario from "@/data/inventario.json";

export const prerender = false;

// Endpoint de import masivo. Crea sucursales, ubicaciones y equipos con plan
// preventivo trimestral. Es idempotente: si una sucursal/ubicacion/equipo
// ya existe (por nombre/codigo), no se duplica.
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;

  const db = getDb(ctx);
  const data = inventario as {
    sucursales: { nombre: string; codigo: string; ubicaciones: string[] }[];
    equipos: {
      codigo: string; nombre: string; marca: string | null; modelo: string | null;
      capacidad: string | null; notas: string | null;
      sucursal: string; ubicacion: string;
    }[];
  };

  const url = new URL(ctx.request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const frecuencia = (url.searchParams.get("frecuencia") ?? "trimestral") as
    "diaria" | "semanal" | "quincenal" | "mensual" | "bimestral" | "trimestral" | "semestral" | "anual";

  const sucursalIdMap = new Map<string, number>();
  const ubicacionIdMap = new Map<string, number>(); // key = `${sucursalId}::${nombre}`

  // Estadisticas
  const stats = {
    sucursalesCreadas: 0, sucursalesExistentes: 0,
    ubicacionesCreadas: 0, ubicacionesExistentes: 0,
    equiposCreados: 0, equiposExistentes: 0,
    planesCreados: 0,
    errores: [] as string[],
  };

  // 1) Sucursales
  for (const s of data.sucursales) {
    const [existente] = await db.select().from(sucursales).where(eq(sucursales.nombre, s.nombre)).limit(1);
    if (existente) {
      sucursalIdMap.set(s.nombre, existente.id);
      stats.sucursalesExistentes++;
      continue;
    }
    if (dryRun) { stats.sucursalesCreadas++; sucursalIdMap.set(s.nombre, -1); continue; }
    try {
      const [creada] = await db.insert(sucursales).values({
        nombre: s.nombre,
        codigo: s.codigo,
      }).returning();
      sucursalIdMap.set(s.nombre, creada.id);
      stats.sucursalesCreadas++;
    } catch (e: any) {
      stats.errores.push(`Sucursal "${s.nombre}": ${e?.message ?? e}`);
    }
  }

  // 2) Ubicaciones
  for (const s of data.sucursales) {
    const sucursalId = sucursalIdMap.get(s.nombre);
    if (!sucursalId) continue;
    for (const ubNombre of s.ubicaciones) {
      const key = `${sucursalId}::${ubNombre}`;
      if (sucursalId !== -1) {
        const [existente] = await db.select().from(ubicaciones)
          .where(and(eq(ubicaciones.sucursalId, sucursalId), eq(ubicaciones.nombre, ubNombre)))
          .limit(1);
        if (existente) {
          ubicacionIdMap.set(key, existente.id);
          stats.ubicacionesExistentes++;
          continue;
        }
      }
      if (dryRun) { stats.ubicacionesCreadas++; ubicacionIdMap.set(key, -1); continue; }
      try {
        const [creada] = await db.insert(ubicaciones).values({
          sucursalId,
          nombre: ubNombre,
          tipo: "area",
        }).returning();
        ubicacionIdMap.set(key, creada.id);
        stats.ubicacionesCreadas++;
      } catch (e: any) {
        stats.errores.push(`Ubicacion "${ubNombre}" en ${s.nombre}: ${e?.message ?? e}`);
      }
    }
  }

  // 3) Equipos + plan preventivo distribuido
  // Distribuimos las próximas fechas: equipo[i] = hoy + (i * spread / total)
  const intervaloSpread = frecuencia === "diaria" ? 1
    : frecuencia === "semanal" ? 7
    : frecuencia === "quincenal" ? 15
    : frecuencia === "mensual" ? 30
    : frecuencia === "bimestral" ? 60
    : frecuencia === "trimestral" ? 90
    : frecuencia === "semestral" ? 180
    : 365;
  const total = data.equipos.length;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  let i = 0;
  for (const eq of data.equipos) {
    const sucId = sucursalIdMap.get(eq.sucursal);
    const ubId = ubicacionIdMap.get(`${sucId}::${eq.ubicacion}`);
    if (!sucId) {
      stats.errores.push(`Equipo ${eq.codigo}: sucursal "${eq.sucursal}" no encontrada`);
      continue;
    }

    // ¿Ya existe este equipo?
    if (sucId !== -1) {
      const [existe] = await db.select({ id: activos.id }).from(activos).where(eq(activos.codigo, eq.codigo)).limit(1);
      if (existe) {
        stats.equiposExistentes++;
        i++;
        continue;
      }
    }

    if (dryRun) { stats.equiposCreados++; i++; continue; }

    // Calcula proxima fecha distribuida
    const offsetDias = Math.floor((i * intervaloSpread) / Math.max(total, 1));
    const proximaFecha = new Date(hoy);
    proximaFecha.setDate(proximaFecha.getDate() + offsetDias);
    const proximaFechaStr = proximaFecha.toISOString().slice(0, 10);

    try {
      const [creado] = await db.insert(activos).values({
        codigo: eq.codigo,
        nombre: eq.nombre,
        descripcion: eq.notas,
        ubicacion: eq.ubicacion,
        ubicacionId: ubId && ubId !== -1 ? ubId : null,
        estado: "operativo",
        marca: eq.marca,
        modelo: eq.modelo,
        categoria: "HVAC",
        tipo: "general",
        qrCode: `QR-${eq.codigo}`,
        notas: eq.capacidad ? `Capacidad: ${eq.capacidad}` : null,
      } as any).returning();
      stats.equiposCreados++;

      // Plan preventivo
      await db.insert(planesMantenimiento).values({
        activoId: creado.id,
        titulo: `Mantenimiento preventivo ${frecuencia}`,
        descripcion: `Limpieza, revisión general y mantenimiento del aire acondicionado.`,
        frecuencia,
        proximaFecha: proximaFechaStr,
        prioridad: "media",
      });
      stats.planesCreados++;
    } catch (e: any) {
      stats.errores.push(`Equipo ${eq.codigo}: ${e?.message ?? e}`);
    }
    i++;
  }

  return Response.json({ ok: true, dryRun, stats });
};
