import type { APIContext } from "astro";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ordenes, activos, usuarios, comentarios, adjuntos, planesMantenimiento, tickets, actividades, movimientosInventario, extintorEventos, ubicaciones, sucursales, ordenPrerrequisitos, ordenLiberaciones } from "@/lib/schema";

import { requireUser } from "@/lib/auth";
import { vencimientoCausaRaiz, type EstadoOT } from "@/lib/ordenes";
import { etiquetaOT } from "@/lib/orden-codigo";
import { actualizarOrdenConVerificacion, leerVerificacionOrden, ErrorVerificacion } from "@/lib/orden-verificacion";
import { sendMail, emailLayout } from "@/lib/email";
import { disparadorOT } from "@/lib/notificaciones";
import { sendTelegram } from "@/lib/telegram";
import { crearNotificacion } from "@/lib/notif-app";
import { logAudit } from "@/lib/audit";
import { sembrarDesdeMop } from "@/lib/mop";
import { fmtFechaLarga, fmtFechaCompacta } from "@/lib/datetime";

import { validarAreaTrabajo, validarContextoArea } from "@/lib/ordenes";
import { ordenesTienenConjunto, MENSAJE_ORDEN_TRAZADA } from "@/lib/trazabilidad-conjuntos";


// Un solo camino para cambiar una orden. La ficha completa (PATCH) y el celular
// (Modo técnico) pasan por aquí: mismas reglas, mismas notificaciones y mismo
// rastro. `momento` es la hora real capturada en el celular, ya validada por
// quien llama; sin ella, manda el reloj del servidor.
const updateSchema = z.object({
  rubro: z.enum(["aires", "infraestructura", "equipo_general", "biomedico"]).optional(),
  titulo: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  tipo: z.enum(["preventivo", "correctivo", "predictivo", "intervencion", "emergencia"]).optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  estado: z.enum(["abierta", "en_proceso", "en_espera", "completada", "verificada", "cerrada", "cancelada"]).optional(),
  activoId: z.number().int().positive().nullable().optional(),
  asignadoA: z.number().int().positive().nullable().optional(),
  vencimiento: z.string().nullable().optional(),
  accion: z.enum(["devolver", "reabrir"]).optional(),
  motivo: z.string().max(2000).optional(),
  revisorId: z.number().int().positive().nullable().optional(),
  revisorSuplenteId: z.number().int().positive().nullable().optional(),
  // Ejecucion
  trabajosRealizados: z.string().nullable().optional(),
  causaRaiz: z.string().nullable().optional(),
  solucionAplicada: z.string().nullable().optional(),
  horasTrabajadas: z.number().nullable().optional(),
  checklistEjecucion: z.string().nullable().optional(),
  // El checklist tal como la ficha lo recibió: con él, el servidor fusiona por
  // punto y no deshace lo que el celular marcó mientras tanto.
  checklistBase: z.string().nullable().optional(),
  // Verificacion (solo se setea via accion explicita; aqui aceptamos notas)
  verificacionNotas: z.string().nullable().optional(),
  // Motivo opcional al reasignar (solo se usa para el email al técnico nuevo)
  motivoReasignacion: z.string().nullable().optional(),
  // Si es correctivo y se cierra, reprogramar planes preventivos del activo
  // (default true; el técnico puede desmarcar si fue trivial)
  reprogramarPreventivos: z.boolean().optional(),
  // ── Biblioteca de procedimientos (Fase 47) ──
  procedimientoId: z.number().int().positive().nullable().optional(),
  nivelRiesgo: z.enum(["bajo", "medio", "alto"]).nullable().optional(),
  clasePrioridad: z.enum(["P1", "P2", "P3", "P4"]).nullable().optional(),
  // Los tiempos del EOP. El primer toque del celular fija cada hora vacía; una
  // hora ya fijada y la de alarma las corrige la jefatura, también hacia atrás.
  horaAlarma: z.string().nullable().optional(),
  horaLlegada: z.string().nullable().optional(),
  horaMitigacion: z.string().nullable().optional(),
  horaRestablecimiento: z.string().nullable().optional(),
  // Plan de reversa del MOP: se escribe antes de empezar. La reversa se marca
  // con la orden empezada; enviada a verificación, la registra la jefatura.
  planReversa: z.string().nullable().optional(),
  reversaEjecutada: z.boolean().optional(),
  reversaNotas: z.string().nullable().optional(),
  // Único escape de la regla de liberación: cerrar sin lectura con motivo
  // escrito. Solo admin o jefe; se valida aparte, no se escribe desde el body.
  cierreSinLecturaMotivo: z.string().nullable().optional(),
});

export interface OpcionesCambioOrden {
  momento?: string;
}

export async function aplicarCambioOrden(
  ctx: APIContext,
  user: { id: number; rol: any; nombre: string },
  id: number,
  body: unknown,
  opciones: OpcionesCambioOrden = {},
): Promise<Response> {
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [actual] = await db.select().from(ordenes).where(eq(ordenes.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });

  const contextError = validarContextoArea(ctx.request, actual.rubro);
  if (contextError) return contextError;
  if (parsed.data.rubro && parsed.data.rubro !== actual.rubro) return Response.json({ error: "El área de una orden no puede cambiarse" }, { status: 400 });
  if (parsed.data.activoId !== undefined) {
    if (actual.planId && parsed.data.activoId !== actual.activoId) return Response.json({ error: "La orden está vinculada al PM de este equipo. Conserva su origen y crea otra orden para un equipo distinto." }, { status: 409 });
    if (parsed.data.activoId !== actual.activoId && await ordenesTienenConjunto(ctx, [id])) {
      return Response.json({ error: "El equipo de esta orden está registrado en la trazabilidad de un conjunto. Conserva la orden original y abre otra para el equipo que corresponda." }, { status: 409 });
    }
    const areaResult = await validarAreaTrabajo(db, { ...actual, ...parsed.data });
    if ("error" in areaResult) return Response.json({ error: areaResult.error }, { status: 400 });
  }

  const { motivoReasignacion } = parsed.data;
  const now = opciones.momento ?? new Date().toISOString();

  // ── Fase 47 · derivados de los campos de EOP y MOP ───────────────────────
  // Las reglas duras (prerrequisitos, liberaciones, lecturas, causa raíz) viven
  // en actualizarOrdenConVerificacion: aplican por cualquier vía de cierre.
  const entrada: Record<string, unknown> = { ...parsed.data };
  // El plazo de la causa raíz corre desde la hora de alarma: 72 h (cap. 06).
  if (parsed.data.horaAlarma !== undefined) {
    entrada.causaRaizVencimiento = vencimientoCausaRaiz(parsed.data.horaAlarma);
  }
  // Una emergencia nace P1: atención inmediata. Solo se rellena si nadie fijó
  // la clase todavía (no sobreescribe una decisión de la jefatura).
  if (parsed.data.tipo === "emergencia" && parsed.data.clasePrioridad === undefined && !actual.clasePrioridad) {
    entrada.clasePrioridad = "P1";
  }
  // Quién marca la reversa, en qué estado y con qué notas lo revisa actualizarOrdenConVerificacion.

  let row: typeof ordenes.$inferSelect;
  try {
    const result = await actualizarOrdenConVerificacion(db, actual, user, entrada, now);
    row = result.row;
    if (result.estado !== actual.estado) parsed.data.estado = result.estado as EstadoOT;
  } catch (error) {
    if (error instanceof ErrorVerificacion) return Response.json({ error: error.message }, { status: error.status });
    if (parsed.data.activoId !== undefined && parsed.data.activoId !== actual.activoId
      && await ordenesTienenConjunto(ctx, [id])) {
      return Response.json({ error: MENSAJE_ORDEN_TRAZADA }, { status: 409 });
    }
    console.error('No se pudo guardar la orden con su verificación', error);
    return Response.json({ error: 'No se pudo confirmar la operación. Actualiza la orden para consultar su estado antes de reintentar.' }, { status: 500 });
  }

  // ── MOP · la plantilla baja a la orden ──
  // Al quedar vinculada a un MOP, la orden hereda sus prerrequisitos y sus
  // lecturas de liberación. Sin esto la regla dura de prerrequisitos no tiene
  // qué revisar y el MOP queda de adorno.
  let sembradoMop: { prerrequisitos: number; liberaciones: number; plantilla: string | null } | null = null;
  const procAhora = row.procedimientoId ?? null;
  const vinculoNuevo = parsed.data.procedimientoId != null && parsed.data.procedimientoId !== actual.procedimientoId;
  const esIntervencion = (row.tipo ?? actual.tipo) === "intervencion";
  if (procAhora && esIntervencion && (vinculoNuevo || parsed.data.tipo === "intervencion")) {
    try {
      const r = await sembrarDesdeMop(db, id, procAhora);
      if (r.prerrequisitos > 0 || r.liberaciones > 0) {
        sembradoMop = r;
        await logAudit(ctx, {
          entidad: "orden", entidadId: id, accion: "update",
          resumen: `MOP aplicado desde «${r.plantilla}»: ${r.prerrequisitos} prerrequisito(s) y ${r.liberaciones} lectura(s) de liberación`,
        });
      }
    } catch {}
  }

  // Audit: cambio de estado (con resumen legible)
  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
    await logAudit(ctx, {
      entidad: "orden", entidadId: id, accion: "estado",
      resumen: `Estado: ${actual.estado} → ${parsed.data.estado}`,
      cambios: { estado: { antes: actual.estado, despues: parsed.data.estado } },
    });
  }
  // Audit: cambio de asignación
  if (parsed.data.asignadoA !== undefined && parsed.data.asignadoA !== actual.asignadoA) {
    let nombreNuevo: string | null = null;
    if (parsed.data.asignadoA) {
      const [u] = await db.select({ nombre: usuarios.nombre }).from(usuarios).where(eq(usuarios.id, parsed.data.asignadoA)).limit(1);
      nombreNuevo = u?.nombre ?? `id ${parsed.data.asignadoA}`;
    }
    await logAudit(ctx, {
      entidad: "orden", entidadId: id, accion: "asignacion",
      resumen: parsed.data.asignadoA
        ? `Asignada a ${nombreNuevo}`
        : "Asignación removida",
      cambios: { asignadoA: { antes: actual.asignadoA, despues: parsed.data.asignadoA } },
    });
  }
  // Audit: otros cambios (campos de ejecución, prioridad, etc.). Se compara con
  // lo que quedó guardado: lo que llegó igual y se dejó fuera no es un cambio.
  const camposEditables = [
    "titulo", "descripcion", "prioridad", "tipo", "vencimiento",
    "trabajosRealizados", "causaRaiz", "solucionAplicada", "horasTrabajadas",
    // Fase 47 — MOP/EOP
    "clasePrioridad", "nivelRiesgo", "procedimientoId",
    "horaAlarma", "horaLlegada", "horaMitigacion", "horaRestablecimiento",
    "planReversa", "reversaEjecutada", "reversaNotas",
  ];
  const otrosCambios: any = {};
  for (const c of camposEditables) {
    if ((parsed.data as any)[c] !== undefined && (row as any)[c] !== (actual as any)[c]) {
      otrosCambios[c] = { antes: (actual as any)[c], despues: (row as any)[c] };
    }
  }
  if (Object.keys(otrosCambios).length > 0) {
    await logAudit(ctx, {
      entidad: "orden", entidadId: id, accion: "update",
      cambios: otrosCambios,
    });
  }

  // El avance preventivo se confirma una sola vez en la misma transacción
  // que la aprobación independiente y su evidencia inmutable.

  // Sync con ticket vinculado: si la OT cambió de estado, propagar al ticket
  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
    try {
      const mapeo: Record<string, string> = {
        abierta: "asignado",
        en_proceso: "en_proceso",
        completada: "en_proceso",
        verificada: "en_proceso",
        cerrada: "cerrado",
        cancelada: "descartado",
      };
      const nuevoEstadoTicket = mapeo[parsed.data.estado];
      if (nuevoEstadoTicket) {
        const updateTicket: Record<string, unknown> = {
          estado: nuevoEstadoTicket,
          updatedAt: now,
        };
        // Solo el cierre verificado resuelve el ticket; una ejecución pendiente
        // o una devolución permanece en proceso.
        if (nuevoEstadoTicket === "resuelto" || nuevoEstadoTicket === "cerrado") {
          updateTicket.resueltoEn = now;
          if (actual.solucionAplicada || parsed.data.solucionAplicada) {
            updateTicket.resolucionNotas = parsed.data.solucionAplicada ?? actual.solucionAplicada;
          }
        }
        if (nuevoEstadoTicket === "en_proceso" || nuevoEstadoTicket === "asignado") updateTicket.resueltoEn = null;
        await db.update(tickets).set(updateTicket).where(eq(tickets.otId, id));
      }
    } catch {}
  }

  // Notifica al tecnico cuando se le asigna o reasigna una OT. Quien toma una
  // orden libre desde el celular no necesita un correo que se lo cuente.
  if (parsed.data.asignadoA && parsed.data.asignadoA !== actual.asignadoA && parsed.data.asignadoA !== user.id) {
    try {
      const [u] = await db.select({ email: usuarios.email, nombre: usuarios.nombre, telegramChatId: usuarios.telegramChatId })
        .from(usuarios).where(eq(usuarios.id, parsed.data.asignadoA)).limit(1);
      const env = (ctx.locals as any)?.runtime?.env ?? {};
      const baseUrl = env.APP_URL || "https://mantenimiento.complejoavante.dev";
      const otUrl = `${baseUrl}/ordenes/${row.id}`;

      // Detecta si es reasignación (ya tenía técnico) vs primera asignación
      const esReasignacion = !!actual.asignadoA;
      let nombreAnterior: string | null = null;
      if (esReasignacion && actual.asignadoA) {
        const [prev] = await db.select({ nombre: usuarios.nombre }).from(usuarios).where(eq(usuarios.id, actual.asignadoA)).limit(1);
        nombreAnterior = prev?.nombre ?? null;
      }

      // Resolver ubicación
      let ubicacionTexto: string | null = null;
      if (row.activoId) {
        try {
          const [info] = await db
            .select({ ub: ubicaciones.nombre, suc: sucursales.nombre })
            .from(activos)
            .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
            .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
            .where(eq(activos.id, row.activoId))
            .limit(1);
          ubicacionTexto = [info?.ub, info?.suc].filter(Boolean).join(", ") || null;
        } catch {}
      }

      // Derivar avance previo automáticamente
      let avancePrevio = "Ninguno aún. La orden estaba pendiente de iniciar.";
      if (esReasignacion) {
        const partes: string[] = [];
        if (actual.iniciadaEn) partes.push("trabajo iniciado");
        if (actual.completadaEn) partes.push("marcada como completada");
        if (actual.trabajosRealizados) partes.push("hay registro de trabajos realizados");
        if (actual.solucionAplicada) partes.push("se documentó solución aplicada");
        try {
          const [{ n: nCom }] = await db.select({ n: sql<number>`count(*)` }).from(comentarios).where(eq(comentarios.ordenId, row.id));
          if (Number(nCom) > 0) partes.push(`${nCom} comentario${Number(nCom) === 1 ? "" : "s"}`);
        } catch {}
        try {
          const [{ n: nAdj }] = await db.select({ n: sql<number>`count(*)` }).from(adjuntos).where(eq(adjuntos.ordenId, row.id));
          if (Number(nAdj) > 0) partes.push(`${nAdj} adjunto${Number(nAdj) === 1 ? "" : "s"}`);
        } catch {}
        if (partes.length > 0) {
          const joined = partes.join(", ");
          avancePrevio = joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
        }
      }

      const primerNombre = (u?.nombre ?? "").split(" ")[0] || u?.nombre || "";
      const venceFormateado = row.vencimiento ? fmtFechaLarga(row.vencimiento) : null;
      const subjectVence = venceFormateado ? ` — vence ${venceFormateado}` : "";
      const motivo = motivoReasignacion?.trim() || "";

      if (u?.email) {
        if (esReasignacion) {
          // ── CORREO #4 — Reasignación ──────────────────────────────────
          ctx.locals.runtime.ctx.waitUntil(
            sendMail(ctx, {
              to: u.email,
              subject: `[${etiquetaOT(row)}] Reasignación: ahora la atiendes tú — ${row.titulo}`,
              html: emailLayout(
                "Esta orden pasa a tus manos",
                `<p>Hola <strong>${primerNombre}</strong>,</p>
                 <p>Te estamos transfiriendo la <strong>${etiquetaOT(row)} — ${row.titulo}</strong>${nombreAnterior ? `, que hasta hoy estaba asignada a <strong>${nombreAnterior}</strong>` : ""}.</p>
                 <h3 style="margin:18px 0 10px 0;color:#23417D;font-size:16px">Datos de la orden</h3>
                 <ul style="margin:0 0 14px 0;padding-left:20px;line-height:1.7">
                   <li><strong>Tipo:</strong> ${row.tipo}</li>
                   <li><strong>Prioridad:</strong> ${row.prioridad}</li>
                   ${venceFormateado ? `<li><strong>Vence:</strong> ${venceFormateado}</li>` : ""}
                   ${ubicacionTexto ? `<li><strong>Ubicación:</strong> ${ubicacionTexto}</li>` : ""}
                 </ul>
                 ${motivo ? `<h3 style="margin:18px 0 6px 0;color:#23417D;font-size:15px">Motivo de la reasignación</h3>
                   <p style="white-space:pre-wrap;background:#F2F4F7;padding:12px;border-left:3px solid #23417D;border-radius:2px;margin:0 0 14px 0">${motivo}</p>` : ""}
                 <h3 style="margin:18px 0 6px 0;color:#23417D;font-size:15px">Lo que ya se hizo antes de tu llegada</h3>
                 <p style="margin:0 0 14px 0">${avancePrevio}</p>
                 ${row.descripcion ? `<h3 style="margin:18px 0 6px 0;color:#23417D;font-size:15px">Lo que reportaron originalmente</h3>
                   <p style="white-space:pre-wrap;background:#F2F4F7;padding:12px;border-left:3px solid #23417D;border-radius:2px;margin:0 0 14px 0">${row.descripcion}</p>` : ""}
                 <h3 style="margin:18px 0 6px 0;color:#23417D;font-size:15px">Antes de iniciar</h3>
                 <p>Revisa los comentarios y registros previos en la orden. Si encuentras algo distinto a lo descrito al llegar al sitio, regístralo antes de intervenir.${nombreAnterior ? ` Si necesitas hablar con <strong>${nombreAnterior}</strong> para entender mejor el estado actual, queda autorizado.` : ""}</p>
                 <p style="margin:18px 0"><a href="${otUrl}" style="display:inline-block;padding:10px 20px;background:#23417D;color:#fff;border-radius:2px;text-decoration:none;font-weight:500">Abrir orden →</a></p>
                 <p style="margin-top:14px"><em>Contamos contigo para cerrar este caso.</em></p>`
              ),
              tipo: "ot_reasignada",
              referencia: `orden:${row.id}`,
            }).catch(() => {})
          );
        } else {
          // ── CORREO #3 — Primera asignación a OT existente ─────────────
          ctx.locals.runtime.ctx.waitUntil(
            sendMail(ctx, {
              to: u.email,
              subject: `[${etiquetaOT(row)}] Te asignamos: ${row.titulo}${subjectVence}`,
              html: emailLayout(
                "Nueva orden para ti",
                `<p>Hola <strong>${primerNombre}</strong>,</p>
                 <p>Contamos contigo para esta orden. Te dejamos los detalles abajo.</p>
                 <h3 style="margin:18px 0 10px 0;color:#23417D;font-size:16px">${etiquetaOT(row)} — ${row.titulo}</h3>
                 <ul style="margin:0 0 14px 0;padding-left:20px;line-height:1.7">
                   <li><strong>Tipo:</strong> ${row.tipo}</li>
                   <li><strong>Prioridad:</strong> ${row.prioridad}</li>
                   ${venceFormateado ? `<li><strong>Vence:</strong> ${venceFormateado}</li>` : ""}
                   ${ubicacionTexto ? `<li><strong>Ubicación:</strong> ${ubicacionTexto}</li>` : ""}
                 </ul>
                 ${row.descripcion ? `<p style="margin:0 0 6px 0"><strong>Lo que reportaron:</strong></p>
                   <p style="white-space:pre-wrap;background:#F2F4F7;padding:12px;border-left:3px solid #23417D;border-radius:2px;margin:0 0 18px 0">${row.descripcion}</p>` : ""}
                 <p style="margin:18px 0"><a href="${otUrl}" style="display:inline-block;padding:10px 20px;background:#23417D;color:#fff;border-radius:2px;text-decoration:none;font-weight:500">Abrir orden →</a></p>
                 <p style="font-size:13px;color:#4A4A4A;margin-top:18px">Si encuentras algo distinto a lo descrito al llegar al sitio, regístralo en la orden antes de iniciar el trabajo. Si necesitas apoyo o materiales adicionales, escríbele directamente a tu jefatura.</p>
                 <p style="margin-top:14px"><em>Gracias por mantener Avante funcionando.</em></p>`
              ),
              tipo: "ot_asignada",
              referencia: `orden:${row.id}`,
            }).catch(() => {})
          );
        }
      }
      if (u?.telegramChatId) {
        ctx.locals.runtime.ctx.waitUntil(
          sendTelegram(env, u.telegramChatId,
            `<b>Nueva OT asignada</b>\n${etiquetaOT(row)} - ${row.titulo}\nPrioridad: ${row.prioridad}${row.vencimiento ? `\nVence: ${fmtFechaCompacta(row.vencimiento)}` : ""}`,
            { linkUrl: otUrl, linkLabel: "Abrir orden" }
          )
        );
      }
      await crearNotificacion(ctx, {
        usuarioId: parsed.data.asignadoA, tipo: "ot_asignada",
        titulo: `Te asignaron ${etiquetaOT(row)}: ${row.titulo}`,
        mensaje: `Prioridad: ${row.prioridad}${row.vencimiento ? ` · Vence ${fmtFechaLarga(row.vencimiento)}` : ""}`,
        link: `/ordenes/${row.id}`,
      });
    } catch {}
  }

  // Dispara emails según cambio de estado (iniciada/completada/cerrada)
  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
    try {
      await disparadorOT(ctx, row as any, actual.estado, parsed.data.estado);
    } catch {}
  }

  return Response.json({ orden: row, ...(sembradoMop ? { mop: sembradoMop } : {}) });
}
