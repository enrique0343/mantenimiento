// El nombre de una orden para las personas: OT-MG0001 (Mantenimiento General) u
// OT-MB0001 (Biomédico). El id sigue siendo la llave interna y la dirección de
// la página. Sin imports: también lo usa el celular.

/**
 * La etiqueta de la orden. El respaldo cubre lo único que puede no traer código:
 * una fila recién insertada (RETURNING no ve lo que hace el trigger) y el paquete
 * que un celular guardó antes de este cambio.
 */
export const etiquetaOT = (orden: { id: number; codigo?: string | null }): string =>
  orden.codigo || `OT #${orden.id}`;

/**
 * Convierte lo que alguien escribe al buscar en el código exacto. Acepta
 * «OT-MG0001», «ot mg 1», «MG1» o «mb0012». Devuelve null si no parece un código.
 */
export function codigoDeBusqueda(texto: string): string | null {
  const m = texto.toUpperCase().replace(/[\s-]/g, "").match(/^(?:OT)?(M[GB])0*(\d+)$/);
  return m ? `OT-${m[1]}${m[2].padStart(4, "0")}` : null;
}
