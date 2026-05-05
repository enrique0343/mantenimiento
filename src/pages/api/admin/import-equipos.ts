import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos, ubicaciones, sucursales } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

// Importación masiva desde CSV. Formato esperado de columnas:
// codigo, nombre, tipo (general/biomedico), categoria, marca, modelo, serial,
// anio, estado, ubicacion_nombre, sucursal_nombre, descripcion
// Cualquier columna extra se ignora. Solo codigo + nombre son obligatorias.

const itemSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  tipo: z.enum(["general", "biomedico"]).optional(),
  categoria: z.string().optional().nullable(),
  marca: z.string().optional().nullable(),
  modelo: z.string().optional().nullable(),
  serial: z.string().optional().nullable(),
  anio: z.number().int().optional().nullable(),
  estado: z.enum(["operativo", "averiado", "mantenimiento", "baja"]).optional(),
  ubicacion_nombre: z.string().optional().nullable(),
  sucursal_nombre: z.string().optional().nullable(),
  descripcion: z.string().optional().nullable(),
});

function parseCsv(text: string): Array<Record<string, string>> {
  // Quita BOM
  text = text.replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseLine(lines[0]).map((h) => h.toLowerCase().trim());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const r: Record<string, string> = {};
    headers.forEach((h, j) => { r[h] = (cols[j] ?? "").trim(); });
    rows.push(r);
  }
  return rows;
}

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

const bodySchema = z.object({
  csv: z.string().min(10),
  dryRun: z.boolean().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const dryRun = parsed.data.dryRun ?? false;

  const filas = parseCsv(parsed.data.csv);
  if (filas.length === 0) return Response.json({ error: "CSV vacío o sin encabezados" }, { status: 400 });

  // Cache de ubicaciones y sucursales por nombre (case-insensitive)
  const ubsAll = await db.select({ id: ubicaciones.id, nombre: ubicaciones.nombre, sucursalId: ubicaciones.sucursalId }).from(ubicaciones);
  const sucsAll = await db.select({ id: sucursales.id, nombre: sucursales.nombre }).from(sucursales);
  const ubsByNombre = new Map(ubsAll.map((u) => [u.nombre.toLowerCase(), u]));
  const sucsByNombre = new Map(sucsAll.map((s) => [s.nombre.toLowerCase(), s]));

  // Códigos existentes (para skip)
  const existRows = await db.select({ codigo: activos.codigo }).from(activos);
  const codigosExist = new Set(existRows.map((e) => e.codigo));

  const errores: Array<{ fila: number; codigo?: string; error: string }> = [];
  const aInsertar: any[] = [];

  filas.forEach((row, idx) => {
    const filaNum = idx + 2; // +1 por encabezado, +1 base 1
    const dataRaw = {
      codigo: row.codigo,
      nombre: row.nombre,
      tipo: (row.tipo as any) || undefined,
      categoria: row.categoria || null,
      marca: row.marca || null,
      modelo: row.modelo || null,
      serial: row.serial || null,
      anio: row.anio ? Number(row.anio) : null,
      estado: (row.estado as any) || undefined,
      ubicacion_nombre: row.ubicacion_nombre || null,
      sucursal_nombre: row.sucursal_nombre || null,
      descripcion: row.descripcion || null,
    };
    const v = itemSchema.safeParse(dataRaw);
    if (!v.success) { errores.push({ fila: filaNum, codigo: row.codigo, error: v.error.errors[0]?.message ?? "datos inválidos" }); return; }
    const d = v.data;

    if (codigosExist.has(d.codigo)) { errores.push({ fila: filaNum, codigo: d.codigo, error: "código ya existe" }); return; }

    let ubicacionId: number | null = null;
    if (d.ubicacion_nombre) {
      const u = ubsByNombre.get(d.ubicacion_nombre.toLowerCase());
      if (!u) { errores.push({ fila: filaNum, codigo: d.codigo, error: `ubicación '${d.ubicacion_nombre}' no existe` }); return; }
      ubicacionId = u.id;
    }

    aInsertar.push({
      codigo: d.codigo,
      nombre: d.nombre,
      tipo: d.tipo ?? "general",
      categoria: d.categoria,
      marca: d.marca,
      modelo: d.modelo,
      serial: d.serial,
      anio: d.anio,
      estado: d.estado ?? "operativo",
      descripcion: d.descripcion,
      ubicacionId,
      qrCode: `QR-${d.codigo}`,
    });
  });

  if (dryRun) {
    return Response.json({
      dryRun: true,
      filas: filas.length,
      aInsertar: aInsertar.length,
      errores,
      muestra: aInsertar.slice(0, 5),
    });
  }

  let insertados = 0;
  for (const v of aInsertar) {
    try {
      await db.insert(activos).values(v);
      insertados++;
    } catch (e: any) {
      errores.push({ fila: 0, codigo: v.codigo, error: String(e?.message ?? e).slice(0, 100) });
    }
  }

  return Response.json({
    filas: filas.length,
    insertados,
    errores,
  });
};
