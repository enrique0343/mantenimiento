// Seguridad eléctrica IEC 62353 (Fase 59): lo que usa el formulario de la prueba
// en el navegador. Puro: solo importa de biomedico.ts (que también es puro), para
// que el script de la página no arrastre la base de datos.
import { fechaCorta } from "./biomedico";

/** Un equipo patrón como lo da GET /api/calibraciones/patrones?fecha= (K-B4). */
export type PatronDeLista = {
  id: number; codigo?: string; nombre: string; marca: string | null; modelo: string | null; serial: string | null;
  proxima?: string | null; vigenteEnFecha: boolean | null; hasta: string | null;
};

/**
 * Texto de la opción del analizador y si se puede elegir en la fecha de la prueba.
 * «cal. vence» es `hasta`: el vencimiento de la calibración que valía ese día (no
 * la próxima calibración de hoy). Sin calibración hasta esa fecha, se dice así.
 */
export function opcionAnalizador(p: PatronDeLista, fecha: string): { texto: string; habilitado: boolean } {
  const descripcion = [p.marca, p.modelo].map((s) => (s ?? "").trim()).filter(Boolean).join(" ") || p.nombre.trim();
  const serie = (p.serial ?? "").trim();
  const vence = p.hasta;
  const noVigente = p.vigenteEnFecha === false;
  const calibracion = vence ? `cal. vence ${fechaCorta(vence)}` : "sin calibración a esa fecha";
  const motivo = noVigente && vence
    ? (vence < fecha ? " · calibración vencida" : " · calibración no conforme o sin certificado")
    : !noVigente && !serie ? " · sin número de serie" : "";
  return { texto: `${descripcion} · S/N ${serie || "—"} · ${calibracion}${motivo}`, habilitado: !noVigente && !!serie };
}

/** Cambiar la orden recarga la página con sus lecturas: lo escrito se pierde. */
export const MENSAJE_CAMBIAR_ORDEN =
  "Al cambiar la orden, la página se vuelve a cargar con sus lecturas y se pierde lo que escribiste. ¿Cambiar la orden?";
