// Equipos patrón (K-B4): la lista del formulario de calibración y del analizador de la
// prueba de seguridad eléctrica. Sin bajas. Con `fecha`, dice si cada patrón tenía
// calibración vigente ese día (conforme, con certificado y sin vencer).
import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { ROLES_BIO_VER, esFechaISO, hoySV, patronVigenteEn } from "@/lib/biomedico";
import { errorJson, exigirRol, listarPatrones } from "@/lib/metrologia-db";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const fecha = (ctx.url.searchParams.get("fecha") ?? "").trim() || null;
  if (fecha !== null && !esFechaISO(fecha)) return errorJson("Fecha no válida.", 400);
  const patrones = await listarPatrones(getDb(ctx), hoySV());
  return Response.json({
    patrones: patrones.map((p) => {
      const enFecha = fecha ? patronVigenteEn(p.calibs, fecha) : null;
      return {
        id: p.activoId, codigo: p.codigo, nombre: p.nombre, marca: p.marca, modelo: p.modelo, serial: p.serial,
        estado: p.estado, proxima: p.proxima, vigenteEnFecha: enFecha ? enFecha.vigente : null, hasta: enFecha ? enFecha.hasta : null,
      };
    }),
  });
};
