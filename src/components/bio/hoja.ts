// Fase 59 · WP-D: variante «hoja» (hoja de vida impresa) de los componentes de documentos,
// licencias y capacitaciones. Puro: lo usan los componentes y las pruebas.

/**
 * Título de la sección como lo pinta la hoja de vida (`<h2 class="doc-h"><span>6.</span> Expediente
 * técnico</h2>`): «6. Expediente técnico» → { numero: "6.", texto: "Expediente técnico" }.
 * Sin número → numero ""; vacío → el título por defecto.
 */
export function partirTitulo(titulo: string | null | undefined, porDefecto: string): { numero: string; texto: string } {
  const t = String(titulo ?? "").replace(/\s+/g, " ").trim() || porDefecto;
  const m = /^(\d+(?:\.\d+)*\.)\s+(\S.*)$/.exec(t);
  return m ? { numero: m[1], texto: m[2] } : { numero: "", texto: t };
}
