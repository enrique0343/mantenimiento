import type { APIRoute } from "astro";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { centrosCosto, sucursales } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit, logAuditLote } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, ROLES_BIO_VER, etiquetaCentroCosto, normalizarTexto } from "@/lib/biomedico";
import { errorCodigoCentro, errorNombreCentro, normalizarCodigoCentro, normalizarNombreCentro } from "@/lib/registro-activos";
import { parsearCsv } from "@/lib/importar-equipos";

export const prerender = false;

// Fase 59 · Catálogo de centros de costo (admin y jefe). Un centro con equipos no
// se borra: se desactiva. Cada alta queda en la bitácora (entidad centro_costo).

const MAX_LINEAS = 500;
const FILAS_POR_INSERT = 20; // 4 parámetros por fila: 80 por sentencia (D1 acepta 100)

/** GET → { centros } (lo usan formularios y filtros). */
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const centros = await getDb(ctx)
    .select({ id: centrosCosto.id, codigo: centrosCosto.codigo, nombre: centrosCosto.nombre, sucursalId: centrosCosto.sucursalId, activo: centrosCosto.activo })
    .from(centrosCosto).orderBy(asc(centrosCosto.codigo));
  return Response.json({ centros });
};

const unoSchema = z.object({
  codigo: z.string(),
  nombre: z.string(),
  sucursalId: z.number().int().positive().nullable().optional(),
});
const listaSchema = z.object({ lista: z.string().max(100_000) });

const esUnico = (error: unknown) => {
  for (let actual: unknown = error, i = 0; actual && i < 5; i++) {
    if (/UNIQUE constraint failed: centros_costo\.codigo/i.test(String((actual as Error).message ?? actual))) return true;
    actual = (actual as { cause?: unknown }).cause;
  }
  return false;
};

/** POST { codigo, nombre, sucursalId? } → 201 { centro }   o   { lista } → 200 { creados, resultados }. */
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const db = getDb(ctx);
  const existentes = await db.select({ codigo: centrosCosto.codigo }).from(centrosCosto);
  const codigosUsados = new Set(existentes.map((c) => c.codigo.toUpperCase()));

  // ── Una lista pegada desde Excel ──
  const lista = listaSchema.safeParse(body);
  if (lista.success) {
    const sedes = await db.select({ id: sucursales.id, nombre: sucursales.nombre, codigo: sucursales.codigo }).from(sucursales);
    const buscarSede = (t: string) => {
      const n = normalizarTexto(t);
      return sedes.find((s) => normalizarTexto(s.nombre) === n) ?? sedes.find((s) => s.codigo && normalizarTexto(s.codigo) === n) ?? null;
    };
    const registros = parsearCsv(lista.data.lista).registros.map((celdas, i) => ({ linea: i + 1, celdas }))
      .filter((r) => r.celdas.some((c) => c.trim()));
    if (!registros.length) return Response.json({ error: "Pega al menos una línea: CÓDIGO, NOMBRE y, si aplica, SEDE." }, { status: 400 });
    if (registros.length > MAX_LINEAS) return Response.json({ error: `La lista tiene más de ${MAX_LINEAS} líneas: divídela en partes.` }, { status: 400 });
    const resultados: { linea: number; codigo: string; error?: string }[] = [];
    const nuevos: { linea: number; codigo: string; nombre: string; sucursalId: number | null }[] = [];
    const enLista = new Map<string, number>();
    for (const [i, { linea, celdas }] of registros.entries()) {
      const codigo = normalizarCodigoCentro(celdas[0]);
      const nombre = normalizarNombreCentro(celdas[1]);
      const sedeTxt = String(celdas[2] ?? "").trim();
      // Una primera línea de encabezados («Código, Nombre, Sede») no es un centro.
      if (i === 0 && normalizarTexto(codigo) === "codigo" && normalizarTexto(nombre) === "nombre") continue;
      const error = errorCodigoCentro(codigo) ?? errorNombreCentro(nombre)
        ?? (codigosUsados.has(codigo) ? `El código «${codigo}» ya existe.` : null)
        ?? (enLista.has(codigo) ? `Código repetido en la lista (línea ${enLista.get(codigo)}).` : null);
      const sede = sedeTxt ? buscarSede(sedeTxt) : null;
      const errorSede = sedeTxt && !sede ? `La sede «${sedeTxt}» no existe.` : null;
      if (error || errorSede) { resultados.push({ linea, codigo, error: error ?? errorSede! }); continue; }
      enLista.set(codigo, linea);
      nuevos.push({ linea, codigo, nombre, sucursalId: sede?.id ?? null });
      resultados.push({ linea, codigo });
    }
    let creados = 0;
    if (nuevos.length) {
      const inserts: BatchItem<"sqlite">[] = [];
      for (let i = 0; i < nuevos.length; i += FILAS_POR_INSERT) {
        inserts.push(db.insert(centrosCosto)
          .values(nuevos.slice(i, i + FILAS_POR_INSERT).map((n) => ({ codigo: n.codigo, nombre: n.nombre, sucursalId: n.sucursalId, activo: true })))
          .returning({ id: centrosCosto.id, codigo: centrosCosto.codigo, nombre: centrosCosto.nombre }));
      }
      try {
        const lotes = await db.batch(inserts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]) as { id: number; codigo: string; nombre: string }[][];
        const filas = lotes.flat();
        creados = filas.length;
        await logAuditLote(ctx, filas.map((c) => ({
          entidad: "centro_costo" as const, entidadId: c.id, accion: "create" as const, resumen: `Centro de costo creado: ${etiquetaCentroCosto(c)}`,
        })));
      } catch (error) {
        if (esUnico(error)) return Response.json({ error: "Otra persona agregó uno de esos códigos mientras tanto. Vuelve a pegar la lista." }, { status: 409 });
        throw error;
      }
    }
    return Response.json({ creados, resultados });
  }

  // ── Un centro ──
  const uno = unoSchema.safeParse(body);
  if (!uno.success) return Response.json({ error: "Escribe el código y el nombre del centro." }, { status: 400 });
  const codigo = normalizarCodigoCentro(uno.data.codigo);
  const nombre = normalizarNombreCentro(uno.data.nombre);
  const error = errorCodigoCentro(codigo) ?? errorNombreCentro(nombre);
  if (error) return Response.json({ error }, { status: 400 });
  const sucursalId = uno.data.sucursalId ?? null;
  if (sucursalId != null) {
    const [sede] = await db.select({ id: sucursales.id }).from(sucursales).where(eq(sucursales.id, sucursalId)).limit(1);
    if (!sede) return Response.json({ error: "La sede no existe." }, { status: 400 });
  }
  if (codigosUsados.has(codigo)) return Response.json({ error: `El código «${codigo}» ya existe.` }, { status: 409 });
  try {
    const [centro] = await db.insert(centrosCosto).values({ codigo, nombre, sucursalId, activo: true }).returning();
    await logAudit(ctx, { entidad: "centro_costo", entidadId: centro.id, accion: "create", resumen: `Centro de costo creado: ${etiquetaCentroCosto(centro)}` });
    return Response.json({ centro }, { status: 201 });
  } catch (e) {
    if (esUnico(e)) return Response.json({ error: `El código «${codigo}» ya existe.` }, { status: 409 });
    throw e;
  }
};
