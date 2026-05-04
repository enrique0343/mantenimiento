import type { APIRoute } from "astro";
import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sucursales, ubicaciones, activos, planesMantenimiento } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import inventario from "@/data/inventario.json";

export const prerender = false;

// Endpoint de import masivo. Optimizado para Cloudflare Workers:
// - Lee duplicados con SELECT IN(...) en lote (no N+1)
// - Inserta con .values([...]) en chunks
// Total subrequests: ~10 (vs 700+ en la version naive)
export const POST: APIRoute = async (ctx) => {
  try {
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

    const stats = {
      sucursalesCreadas: 0, sucursalesExistentes: 0,
      ubicacionesCreadas: 0, ubicacionesExistentes: 0,
      equiposCreados: 0, equiposExistentes: 0,
      planesCreados: 0,
      errores: [] as string[],
    };

    // ── 1) SUCURSALES (1-2 queries) ──────────────────────────────────────────
    const sucNombres = data.sucursales.map((s) => s.nombre);
    const sucExistentes = await db
      .select({ id: sucursales.id, nombre: sucursales.nombre })
      .from(sucursales)
      .where(inArray(sucursales.nombre, sucNombres));
    const sucIdMap = new Map<string, number>();
    for (const s of sucExistentes) sucIdMap.set(s.nombre, s.id);
    stats.sucursalesExistentes = sucExistentes.length;

    const sucPorCrear = data.sucursales.filter((s) => !sucIdMap.has(s.nombre));
    if (sucPorCrear.length > 0) {
      if (!dryRun) {
        const insertados = await db.insert(sucursales).values(
          sucPorCrear.map((s) => ({ nombre: s.nombre, codigo: s.codigo }))
        ).returning({ id: sucursales.id, nombre: sucursales.nombre });
        for (const s of insertados) sucIdMap.set(s.nombre, s.id);
      } else {
        for (const s of sucPorCrear) sucIdMap.set(s.nombre, -1);
      }
      stats.sucursalesCreadas = sucPorCrear.length;
    }

    // ── 2) UBICACIONES (1-4 queries) ─────────────────────────────────────────
    const ubsNeeded: Array<{ sucursalId: number; nombre: string }> = [];
    for (const s of data.sucursales) {
      const sId = sucIdMap.get(s.nombre);
      if (!sId) continue;
      for (const ub of s.ubicaciones) ubsNeeded.push({ sucursalId: sId, nombre: ub });
    }

    const sucIdsPositive = Array.from(new Set(ubsNeeded.map((u) => u.sucursalId).filter((id) => id > 0)));
    let ubExistentes: { id: number; sucursalId: number; nombre: string }[] = [];
    if (sucIdsPositive.length > 0) {
      ubExistentes = await db
        .select({ id: ubicaciones.id, sucursalId: ubicaciones.sucursalId, nombre: ubicaciones.nombre })
        .from(ubicaciones)
        .where(inArray(ubicaciones.sucursalId, sucIdsPositive));
    }
    const ubIdMap = new Map<string, number>();
    for (const u of ubExistentes) ubIdMap.set(`${u.sucursalId}::${u.nombre}`, u.id);
    stats.ubicacionesExistentes = ubExistentes.length;

    const ubPorCrear = ubsNeeded.filter((u) => !ubIdMap.has(`${u.sucursalId}::${u.nombre}`));
    if (ubPorCrear.length > 0) {
      if (!dryRun) {
        const validas = ubPorCrear.filter((u) => u.sucursalId > 0);
        const chunkSize = 50;
        for (let i = 0; i < validas.length; i += chunkSize) {
          const chunk = validas.slice(i, i + chunkSize);
          const insertados = await db.insert(ubicaciones).values(
            chunk.map((u) => ({ sucursalId: u.sucursalId, nombre: u.nombre, tipo: "area" as const }))
          ).returning({ id: ubicaciones.id, sucursalId: ubicaciones.sucursalId, nombre: ubicaciones.nombre });
          for (const u of insertados) ubIdMap.set(`${u.sucursalId}::${u.nombre}`, u.id);
        }
      }
      stats.ubicacionesCreadas = ubPorCrear.length;
    }

    // ── 3) EQUIPOS + PLANES (~8 queries) ─────────────────────────────────────
    const codigos = data.equipos.map((e) => e.codigo);
    const eqExistentes = await db
      .select({ codigo: activos.codigo })
      .from(activos)
      .where(inArray(activos.codigo, codigos));
    const codigosExistentes = new Set(eqExistentes.map((e) => e.codigo));
    stats.equiposExistentes = codigosExistentes.size;

    const equiposPorCrear = data.equipos.filter((e) => !codigosExistentes.has(e.codigo));

    const intervaloSpread = frecuencia === "diaria" ? 1
      : frecuencia === "semanal" ? 7
      : frecuencia === "quincenal" ? 15
      : frecuencia === "mensual" ? 30
      : frecuencia === "bimestral" ? 60
      : frecuencia === "trimestral" ? 90
      : frecuencia === "semestral" ? 180
      : 365;
    const total = equiposPorCrear.length;
    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);

    if (equiposPorCrear.length > 0) {
      if (!dryRun) {
        const chunkSize = 50;
        for (let i = 0; i < equiposPorCrear.length; i += chunkSize) {
          const chunk = equiposPorCrear.slice(i, i + chunkSize);
          const valuesEquipos = chunk.map((e) => {
            const sucId = sucIdMap.get(e.sucursal);
            const ubId = sucId ? ubIdMap.get(`${sucId}::${e.ubicacion}`) ?? null : null;
            return {
              codigo: e.codigo,
              nombre: e.nombre,
              descripcion: e.notas,
              ubicacion: e.ubicacion,
              ubicacionId: ubId,
              estado: "operativo" as const,
              marca: e.marca,
              modelo: e.modelo,
              categoria: "HVAC",
              tipo: "general" as const,
              qrCode: `QR-${e.codigo}`,
              notas: e.capacidad ? `Capacidad: ${e.capacidad}` : null,
            };
          });
          const insertados = await db.insert(activos).values(valuesEquipos).returning({ id: activos.id, codigo: activos.codigo });

          const valuesPlanes = insertados.map((row) => {
            const idxGlobal = equiposPorCrear.findIndex((e) => e.codigo === row.codigo);
            const offsetDias = Math.floor((idxGlobal * intervaloSpread) / Math.max(total, 1));
            const proximaFecha = new Date(hoy);
            proximaFecha.setUTCDate(proximaFecha.getUTCDate() + offsetDias);
            return {
              activoId: row.id,
              titulo: `Mantenimiento preventivo ${frecuencia}`,
              descripcion: "Limpieza, revisión general y mantenimiento del aire acondicionado.",
              frecuencia,
              proximaFecha: proximaFecha.toISOString().slice(0, 10),
              prioridad: "media" as const,
            };
          });
          if (valuesPlanes.length > 0) {
            await db.insert(planesMantenimiento).values(valuesPlanes);
            stats.planesCreados += valuesPlanes.length;
          }
          stats.equiposCreados += insertados.length;
        }
      } else {
        stats.equiposCreados = equiposPorCrear.length;
        stats.planesCreados = equiposPorCrear.length;
      }
    }

    return Response.json({ ok: true, dryRun, stats });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: String(e?.message ?? e), stack: String(e?.stack ?? "").slice(0, 800) },
      { status: 500 }
    );
  }
};
