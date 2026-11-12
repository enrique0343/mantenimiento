// Pruebas de seguridad eléctrica IEC 62353 de un equipo (Fase 59).
// GET (ver): pruebas y resumen. POST (registrar): una prueba nueva con sus
// mediciones, el analizador, el resultado confirmado y, si viene, el informe.
// Nada se edita: una prueba mal registrada se anula y se registra otra.
import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { activos, ordenes, pruebasSeguridadElectrica, usuarios } from "@/lib/schema";
import { logAuditLote } from "@/lib/audit";
import { rubroDeActivo } from "@/lib/rubros";
import {
  CLASES_PROTECCION, METODOS_FUGA, PARTES_APLICADAS, RESULTADO_SE_LABEL, ROLES_BIO_REGISTRAR, ROLES_BIO_VER,
  TIPOS_PRUEBA_ELECTRICA, TIPO_PRUEBA_ELECTRICA_LABEL, esFechaISO, evaluarPruebaIec62353, hoySV, leerFechaEntrada,
  limitesIec62353, nombreSeguroR2, puedeGestionarBio, sumarMeses, validarArchivo, validarResultadoConfirmado,
  type ClaseProteccion, type Conformidad, type MetodoFuga, type ParteAplicada, type ResultadoPruebaElectrica,
  type TipoPruebaElectrica,
} from "@/lib/biomedico";
import {
  ROLES_REALIZAN, calibracionesDe, descripcionAnalizador, errorJson, exigirRol, idPositivo, leerMedida,
  mensajeAnalizadorVencido, periodicidadSeguridadElectrica, pruebasDeActivo, resumenSeguridadElectrica,
  revisarCalibracionAnalizador,
} from "@/lib/seguridad-electrica";

export const prerender = false;

const MAX_TEXTO = 120;
const MAX_NOTAS = 2000;
const MAX_MOTIVO = 1000;

const enLista = <T extends string>(lista: readonly T[], v: string): v is T => (lista as readonly string[]).includes(v);

async function equipoDe(ctx: Parameters<APIRoute>[0]) {
  const activoId = idPositivo(ctx.params.id);
  if (!activoId) return null;
  const db = getDb(ctx);
  const [equipo] = await db
    .select({ id: activos.id, codigo: activos.codigo, nombre: activos.nombre, tipo: activos.tipo, rubro: activos.rubro, estado: activos.estado })
    .from(activos)
    .where(eq(activos.id, activoId))
    .limit(1);
  return equipo ?? null;
}

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const equipo = await equipoDe(ctx);
  if (!equipo) return errorJson(404, "Equipo no encontrado");
  const db = getDb(ctx);
  const [pruebas, resumen] = await Promise.all([pruebasDeActivo(db, equipo.id), resumenSeguridadElectrica(db, equipo.id)]);
  return Response.json({
    // La llave del informe en R2 no sale del servidor: se descarga por su ruta.
    pruebas: pruebas.map(({ informeR2Key, ...p }) => ({ ...p, tieneInforme: !!informeR2Key })),
    resumen,
  });
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_REGISTRAR);
  if (!user) return response;
  const equipo = await equipoDe(ctx);
  if (!equipo) return errorJson(404, "Equipo no encontrado");
  if (rubroDeActivo(equipo.rubro, equipo.tipo) !== "biomedico") return errorJson(400, "Solo los equipos biomédicos llevan esta prueba.");
  if (equipo.estado === "baja") return errorJson(409, "El equipo está dado de baja.");

  const form = await ctx.request.formData().catch(() => null);
  if (!form) return errorJson(400, "Envía el formulario de la prueba.");
  const campo = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const db = getDb(ctx);

  if (campo("confirmado") !== "1") return errorJson(400, "Marca la casilla de confirmación.");

  // Fecha
  const fecha = campo("fecha");
  if (!esFechaISO(fecha)) return errorJson(400, "Revisa la fecha de la prueba.");
  if (fecha > hoySV()) return errorJson(400, "La fecha no puede ser futura.");

  // Listas
  const tipo = campo("tipo");
  if (!enLista<TipoPruebaElectrica>(TIPOS_PRUEBA_ELECTRICA, tipo)) return errorJson(400, "Elige el tipo de prueba.");
  const clase = campo("claseProteccion");
  if (!enLista<ClaseProteccion>(CLASES_PROTECCION, clase)) return errorJson(400, "Elige la clase de protección.");
  const parte = campo("parteAplicada");
  if (!enLista<ParteAplicada>(PARTES_APLICADAS, parte)) return errorJson(400, "Elige el tipo de parte aplicada.");
  const metodo = campo("metodoFuga") || "directo";
  if (!enLista<MetodoFuga>(METODOS_FUGA, metodo)) return errorJson(400, "Elige el método de medición de la fuga.");
  const conformidades = ["conforme", "no_conforme"] as const;
  const visual = campo("inspeccionVisual");
  if (!enLista<Conformidad>(conformidades, visual)) return errorJson(400, "Indica el resultado de la inspección visual.");
  const funcional = campo("pruebaFuncional");
  if (!enLista<Conformidad>(conformidades, funcional)) return errorJson(400, "Indica el resultado de la prueba funcional.");

  // Orden (opcional): tiene que ser de este equipo.
  let ordenId: number | null = null;
  if (campo("ordenId")) {
    const oid = idPositivo(campo("ordenId"));
    const [orden] = oid ? await db.select({ id: ordenes.id, activoId: ordenes.activoId }).from(ordenes).where(eq(ordenes.id, oid)).limit(1) : [];
    if (!orden || orden.activoId !== equipo.id) return errorJson(400, "La orden elegida no es de este equipo.");
    ordenId = orden.id;
  }

  // Mediciones: solo las que aplican a la clase y la parte aplicada; las demás quedan vacías.
  const limites = limitesIec62353(clase, parte, metodo);
  const medidas = {
    tierraOhm: { aplica: limites.tierraOhm !== null, etiqueta: "Resistencia de tierra (Ω)" },
    aislamientoMohm: { aplica: limites.aislamientoMohm !== null, etiqueta: "Resistencia de aislamiento (MΩ)" },
    fugaEquipoUa: { aplica: limites.fugaEquipoUa !== null, etiqueta: "Fuga del equipo (µA)" },
    fugaParteUa: { aplica: limites.fugaParteUa !== null, etiqueta: "Fuga de parte aplicada (µA)" },
  } as const;
  const valores = { tierraOhm: null, aislamientoMohm: null, fugaEquipoUa: null, fugaParteUa: null } as Record<keyof typeof medidas, number | null>;
  for (const k of Object.keys(medidas) as (keyof typeof medidas)[]) {
    if (!medidas[k].aplica) continue;
    const r = leerMedida(campo(k), medidas[k].etiqueta);
    if ("error" in r) return errorJson(400, r.error);
    valores[k] = r.valor;
  }
  const ev = evaluarPruebaIec62353({ inspeccionVisual: visual, pruebaFuncional: funcional, ...valores }, clase, parte, metodo);
  if (ev.resultado === null) return errorJson(400, `Falta la lectura de: ${ev.faltan.join(", ")}.`);

  // Resultado confirmado
  const resultado = campo("resultado");
  if (!enLista<ResultadoPruebaElectrica>(["pasa", "no_pasa"] as const, resultado)) return errorJson(400, "Elige el resultado que confirmas.");
  const motivo = campo("motivoResultado");
  if (motivo.length > MAX_MOTIVO) return errorJson(400, `El motivo tiene como máximo ${MAX_MOTIVO} letras.`);
  const confirmado = validarResultadoConfirmado(ev.resultado, resultado, motivo);
  if (!confirmado.ok) return errorJson(400, confirmado.error);

  // Analizador: equipo patrón de la lista o escrito a mano; vigente el día de la prueba.
  let analizadorActivoId: number | null = null;
  let analizadorDescripcion: string, analizadorSerie: string, analizadorCalVence: string;
  if (campo("analizadorActivoId")) {
    const aid = idPositivo(campo("analizadorActivoId"));
    const [an] = aid
      ? await db
          .select({ id: activos.id, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo, serial: activos.serial, estado: activos.estado, esPatron: activos.esPatron })
          .from(activos)
          .where(eq(activos.id, aid))
          .limit(1)
      : [];
    if (!an || !an.esPatron || an.estado === "baja") return errorJson(400, "El analizador elegido no está en la lista de equipos patrón.");
    if (an.id === equipo.id) return errorJson(400, "El analizador no puede ser el mismo equipo.");
    if (!an.serial?.trim()) return errorJson(400, "El analizador elegido no tiene número de serie en su ficha.");
    const cal = revisarCalibracionAnalizador(await calibracionesDe(db, an.id), fecha);
    if (!cal.ok) return errorJson(400, cal.error);
    analizadorActivoId = an.id;
    analizadorDescripcion = descripcionAnalizador(an).slice(0, MAX_TEXTO);
    analizadorSerie = an.serial.trim().slice(0, MAX_TEXTO);
    analizadorCalVence = cal.hasta;
  } else {
    analizadorDescripcion = campo("analizadorDescripcion");
    analizadorSerie = campo("analizadorSerie");
    const vence = campo("analizadorCalVence");
    if (!analizadorDescripcion || !analizadorSerie || !vence) return errorJson(400, "Elige el analizador o escribe sus datos.");
    if (analizadorDescripcion.length > MAX_TEXTO || analizadorSerie.length > MAX_TEXTO) return errorJson(400, `Los datos del analizador tienen como máximo ${MAX_TEXTO} letras.`);
    const leida = leerFechaEntrada(vence);
    if ("error" in leida || !leida.valor) return errorJson(400, "Revisa hasta cuándo está vigente la calibración del analizador.");
    if (leida.valor < fecha) return errorJson(400, mensajeAnalizadorVencido(leida.valor));
    analizadorCalVence = leida.valor;
  }

  // Quién realizó: un usuario activo (admin, jefe o técnico) o una persona escrita a mano.
  let realizadoPorId: number | null = null;
  let realizadoPor: string;
  let empresaExterna: string | null = null;
  if (campo("realizadoPorId")) {
    const rid = idPositivo(campo("realizadoPorId"));
    const [persona] = rid
      ? await db.select({ id: usuarios.id, nombre: usuarios.nombre, rol: usuarios.rol, activo: usuarios.activo }).from(usuarios).where(eq(usuarios.id, rid)).limit(1)
      : [];
    if (!persona || !persona.activo || !ROLES_REALIZAN.includes(persona.rol)) return errorJson(400, "Indica quién realizó la prueba.");
    realizadoPorId = persona.id;
    realizadoPor = persona.nombre;
  } else {
    realizadoPor = campo("realizadoPor");
    if (realizadoPor.length < 2 || realizadoPor.length > MAX_TEXTO) return errorJson(400, "Indica quién realizó la prueba.");
    empresaExterna = campo("empresaExterna") || null;
    if (empresaExterna && empresaExterna.length > MAX_TEXTO) return errorJson(400, `El nombre de la empresa tiene como máximo ${MAX_TEXTO} letras.`);
  }

  // Próxima prueba: la periodicidad; admin y jefe pueden fijar otra fecha.
  let proximaFecha = sumarMeses(fecha, await periodicidadSeguridadElectrica(db));
  if (campo("proximaFecha") && puedeGestionarBio(user.rol)) {
    const leida = leerFechaEntrada(campo("proximaFecha"));
    if ("error" in leida || !leida.valor || leida.valor <= fecha || leida.valor > sumarMeses(fecha, 60)) {
      return errorJson(400, "La próxima prueba debe ser posterior a la fecha de la prueba y dentro de 5 años.");
    }
    proximaFecha = leida.valor;
  }

  const notas = campo("notas");
  if (notas.length > MAX_NOTAS) return errorJson(400, `Las notas tienen como máximo ${MAX_NOTAS} letras.`);

  // Informe: obligatorio en la prueba de aceptación. Un campo de archivo vacío llega sin nombre.
  const archivo = form.get("informe");
  const hayArchivo = archivo instanceof File && (archivo.size > 0 || archivo.name !== "");
  if (tipo === "aceptacion" && !hayArchivo) return errorJson(400, "La prueba de aceptación necesita el informe adjunto (PDF o foto).");
  let informe: { r2Key: string; nombre: string; tipo: string; tamano: number; bytes: ArrayBuffer } | null = null;
  if (hayArchivo) {
    const bytes = await archivo.arrayBuffer();
    const revisado = validarArchivo({ tamano: archivo.size, cabecera: new Uint8Array(bytes).subarray(0, 1024) });
    if (!revisado.ok) return errorJson(revisado.status, revisado.error);
    informe = {
      r2Key: `seguridad-electrica/${equipo.id}/${Date.now()}-${crypto.randomUUID()}-${nombreSeguroR2(archivo.name)}`,
      nombre: (archivo.name || `informe.${revisado.extension}`).slice(0, 200),
      tipo: revisado.contentType,
      tamano: archivo.size,
      bytes,
    };
  }

  const env = getEnv(ctx);
  if (informe) {
    try {
      await env.R2.put(informe.r2Key, informe.bytes, { httpMetadata: { contentType: informe.tipo } });
    } catch {
      return errorJson(500, "No se pudo subir el informe. Intenta de nuevo.");
    }
  }
  let id: number;
  try {
    const [fila] = await db.insert(pruebasSeguridadElectrica).values({
      activoId: equipo.id,
      fecha,
      tipo,
      ordenId,
      claseProteccion: clase,
      parteAplicada: parte,
      metodoFuga: metodo,
      inspeccionVisual: visual,
      pruebaFuncional: funcional,
      ...valores,
      // El límite con que se juzgó queda en la fila (null = no aplica).
      limiteTierraOhm: ev.limites.tierraOhm,
      limiteAislamientoMohm: ev.limites.aislamientoMohm,
      limiteFugaEquipoUa: ev.limites.fugaEquipoUa,
      limiteFugaParteUa: ev.limites.fugaParteUa,
      resultadoCalculado: ev.resultado,
      resultado,
      motivoResultado: resultado === "no_pasa" && motivo ? motivo : null,
      analizadorActivoId,
      analizadorDescripcion,
      analizadorSerie,
      analizadorCalVence,
      realizadoPor,
      realizadoPorId,
      empresaExterna,
      proximaFecha,
      informeR2Key: informe?.r2Key ?? null,
      informeNombre: informe?.nombre ?? null,
      informeTipo: informe?.tipo ?? null,
      informeTamano: informe?.tamano ?? null,
      notas: notas || null,
      registradoPor: user.id,
    }).returning({ id: pruebasSeguridadElectrica.id });
    id = fila.id;
  } catch {
    // Sin fila no hay prueba: el informe recién subido no queda huérfano en R2.
    if (informe) await env.R2.delete(informe.r2Key).catch(() => {});
    return errorJson(500, "No se pudo guardar la prueba. Intenta de nuevo.");
  }

  const resumen = `Prueba de seguridad eléctrica (${TIPO_PRUEBA_ELECTRICA_LABEL[tipo]}) registrada en ${equipo.codigo}: ${RESULTADO_SE_LABEL[resultado]}`;
  await logAuditLote(ctx, [
    { entidad: "prueba_electrica", entidadId: id, accion: "create", resumen },
    { entidad: "activo", entidadId: equipo.id, accion: "update", resumen },
  ]);
  return Response.json({ prueba: { id, resultado, proximaFecha }, url: `/seguridad-electrica/${id}` }, { status: 201 });
};
