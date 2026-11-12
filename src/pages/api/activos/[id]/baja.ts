import type { APIRoute } from "astro";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activoBajas, activos, ordenes, planesMantenimiento } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  DESTINOS_BAJA, DESTINOS_CON_DETALLE, MOTIVOS_BAJA, ROLES_BIO_GESTIONAR, esFechaISO, folioActaBaja, hoySV,
  type DestinoBaja, type MotivoBaja,
} from "@/lib/biomedico";

export const prerender = false;

// Fase 59 · Dar de baja un equipo (admin y jefe). La fila de activo_bajas es la
// constancia firme; en el mismo lote el equipo pasa a «baja» y se desactivan sus
// planes preventivos (contrato K-A5). La bitácora complementa.

const ORDENES_SIN_CERRAR = ["abierta", "en_proceso", "en_espera"] as const;

type Lectura = { ok: true; valor: string | null } | { ok: false; error: string };
/** Texto recortado y en mayúsculas, con largo mínimo y máximo. */
function texto(valor: unknown, min: number, max: number, error: string, opcional = false, nombre = "El texto"): Lectura {
  const t = typeof valor === "string" ? valor.trim().replace(/\r\n/g, "\n").toUpperCase() : "";
  if (!t) return opcional ? { ok: true, valor: null } : { ok: false, error };
  if (t.length < min) return { ok: false, error };
  if (t.length > max) return { ok: false, error: `${nombre} pasa de ${max} caracteres: acórtalo.` };
  return { ok: true, valor: t };
}

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "El equipo no existe." }, { status: 404 });
  const b = await ctx.request.json().catch(() => null) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "Faltan los datos de la baja." }, { status: 400 });

  // ── Validación: un solo mensaje, en el orden del formulario ──
  const hoy = hoySV();
  const fecha = typeof b.fecha === "string" ? b.fecha.trim() : "";
  if (!esFechaISO(fecha)) return Response.json({ error: "Escribe la fecha de baja." }, { status: 400 });
  if (fecha > hoy) return Response.json({ error: "La fecha de baja no puede ser posterior a hoy." }, { status: 400 });
  const motivo = typeof b.motivo === "string" && b.motivo in MOTIVOS_BAJA ? (b.motivo as MotivoBaja) : null;
  if (!motivo) return Response.json({ error: "Elige el motivo de la baja." }, { status: 400 });
  const lecturas: [string, Lectura][] = [
    ["motivoDetalle", texto(b.motivoDetalle, 10, 1000, "Describe por qué se retira el equipo (mínimo 10 caracteres).", false, "El detalle del motivo")],
    ["evaluacionTecnica", texto(b.evaluacionTecnica, 20, 4000, "Escribe la evaluación técnica (mínimo 20 caracteres).", false, "La evaluación técnica")],
    ["evaluadoPor", texto(b.evaluadoPor, 3, 200, "Escribe quién evaluó el equipo: nombre y cargo.", false, "«Evaluó»")],
    ["autorizaNombre", texto(b.autorizaNombre, 3, 200, "Escribe el nombre de quien autoriza la baja.", false, "El nombre de quien autoriza")],
    ["autorizaCargo", texto(b.autorizaCargo, 2, 200, "Escribe el cargo de quien autoriza la baja.", false, "El cargo de quien autoriza")],
  ];
  for (const [, l] of lecturas) if (!l.ok) return Response.json({ error: l.error }, { status: 400 });
  const destino = typeof b.destinoFinal === "string" && b.destinoFinal in DESTINOS_BAJA ? (b.destinoFinal as DestinoBaja) : null;
  if (!destino) return Response.json({ error: "Elige el destino final del equipo." }, { status: 400 });
  const destinoDetalle = texto(b.destinoDetalle, 1, 500, "Indica a quién se dona o se vende, o qué destino es.", !DESTINOS_CON_DETALLE.includes(destino), "El detalle del destino");
  const empresaRetira = texto(b.empresaRetira, 1, 200, "Escribe la empresa que retira el equipo.", true, "La empresa que retira");
  const residuos = texto(b.residuosBaterias, 2, 1000, "Escribe cómo se manejan los residuos y las baterías; si no aplica, escribe «No aplica».", false, "El manejo de residuos");
  for (const l of [destinoDetalle, empresaRetira, residuos]) if (!l.ok) return Response.json({ error: l.error }, { status: 400 });
  const fechaRetiroTxt = typeof b.fechaRetiro === "string" ? b.fechaRetiro.trim() : "";
  if (fechaRetiroTxt && !esFechaISO(fechaRetiroTxt)) return Response.json({ error: "La fecha de retiro no es válida." }, { status: 400 });
  const valor = (l: Lectura) => (l.ok ? l.valor : null);
  const campos = Object.fromEntries(lecturas.map(([k, l]) => [k, valor(l)!])) as Record<"motivoDetalle" | "evaluacionTecnica" | "evaluadoPor" | "autorizaNombre" | "autorizaCargo", string>;

  // ── Estado del equipo y órdenes sin cerrar ──
  const db = getDb(ctx);
  const [a] = await db.select({ id: activos.id, codigo: activos.codigo, nombre: activos.nombre, estado: activos.estado }).from(activos).where(eq(activos.id, id)).limit(1);
  if (!a) return Response.json({ error: "El equipo no existe." }, { status: 404 });
  // Un equipo que figura de baja sin su registro (marcado antes de esta fase) completa
  // aquí sus datos y su acta: la ficha («Completar datos de baja») y Cumplimiento
  // («Falta registro de baja») enlazan a esta pantalla. Con registro vigente, 409.
  const completar = a.estado === "baja";
  if (completar) {
    const [vigente] = await db.select({ id: activoBajas.id }).from(activoBajas)
      .where(and(eq(activoBajas.activoId, id), eq(activoBajas.estado, "vigente"))).limit(1);
    if (vigente) return Response.json({ error: "El equipo ya está dado de baja." }, { status: 409 });
  }
  const abiertas = await db.select({ id: ordenes.id, codigo: ordenes.codigo }).from(ordenes)
    .where(and(eq(ordenes.activoId, id), inArray(ordenes.estado, [...ORDENES_SIN_CERRAR])));
  if (abiertas.length) {
    const lista = abiertas.map((o) => o.codigo ?? `#${o.id}`).join(", ");
    const error = abiertas.length === 1
      ? `Tiene 1 orden sin cerrar: ${lista}. Ciérrala o cancélala antes de dar de baja.`
      : `Tiene ${abiertas.length} órdenes sin cerrar: ${lista}. Ciérralas o cancélalas antes de dar de baja.`;
    return Response.json({ error, ordenes: abiertas.map((o) => ({ id: o.id, codigo: o.codigo ?? `#${o.id}` })) }, { status: 409 });
  }
  let bajaId: number;
  let estadoAnterior: string;
  let n: number;
  try {
    // La constancia se arma dentro del mismo lote: el estado anterior y la lista de
    // planes se leen en la base justo antes de cambiarlos. Así un plan que se agregó
    // después de abrir la pantalla queda en el acta además de desactivado.
    const [insertadas, , desactivados] = await db.batch([
      db.insert(activoBajas).values({
        activoId: id, estado: "vigente", fechaBaja: fecha, motivo, ...campos,
        destinoFinal: destino, destinoDetalle: valor(destinoDetalle), empresaRetira: valor(empresaRetira),
        fechaRetiro: fechaRetiroTxt || null, residuosBaterias: valor(residuos)!,
        estadoAnterior: sql`(SELECT estado FROM activos WHERE id = ${id})`,
        planesDesactivados: sql`(SELECT json_group_array(p.id) FROM (SELECT id FROM planes_mantenimiento WHERE activo_id = ${id} AND activo = 1 ORDER BY id) p)`,
        registradoPor: user.id, registradoPorNombre: user.nombre,
      }).returning({ id: activoBajas.id, estadoAnterior: activoBajas.estadoAnterior }),
      db.update(activos).set({ estado: "baja" }).where(and(eq(activos.id, id), ne(activos.estado, "baja"))),
      db.update(planesMantenimiento).set({ activo: false })
        .where(and(eq(planesMantenimiento.activoId, id), eq(planesMantenimiento.activo, true)))
        .returning({ id: planesMantenimiento.id }),
    ]);
    bajaId = insertadas[0].id;
    estadoAnterior = insertadas[0].estadoAnterior;
    n = desactivados.length;
  } catch (error) {
    // Dos bajas a la vez: el índice único parcial deja pasar solo una.
    const mensaje = String((error as Error)?.message ?? "") + String(((error as { cause?: Error })?.cause)?.message ?? "");
    if (/UNIQUE constraint failed: activo_bajas\.activo_id|uq_activo_bajas_vigente/i.test(mensaje)) {
      return Response.json({ error: "El equipo ya está dado de baja." }, { status: 409 });
    }
    throw error;
  }
  const folio = folioActaBaja(bajaId);
  const planesTxt = `${n} ${n === 1 ? "plan desactivado" : "planes desactivados"}`;
  await logAudit(ctx, completar || estadoAnterior === "baja"
    ? { entidad: "activo", entidadId: id, accion: "update", resumen: `Datos de la baja registrados (${folio}): ${MOTIVOS_BAJA[motivo]}. ${planesTxt}.` }
    : {
      entidad: "activo", entidadId: id, accion: "estado",
      cambios: { estado: { antes: estadoAnterior, despues: "baja" } },
      resumen: `Dado de baja (${folio}): ${MOTIVOS_BAJA[motivo]}. ${planesTxt}.`,
    });
  return Response.json({ baja: { id: bajaId, folio }, planesDesactivados: n }, { status: 201 });
};
