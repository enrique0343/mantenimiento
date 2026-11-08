// Cómo se lee un número escrito a mano. La misma regla vale en el celular, en
// la ficha y en el servidor.
//
// Se acepta coma o punto decimal: «14,5» y «14.5» son lo mismo. Lo que no se
// adivina es el separador de miles. «1,200» puede ser mil doscientos o uno coma
// dos, y una lectura de CO₂ de 1200 ppm leída como 1,2 deja pasar un quirófano
// fuera de rango. Un número así vuelve como «ambiguo», con la frase que pide
// escribirlo sin separador.

export type NumeroEscrito =
  | { tipo: "vacio" }
  | { tipo: "numero"; valor: number }
  | { tipo: "ambiguo"; mensaje: string }
  | { tipo: "texto" };

/** La frase para un número que se puede leer de dos formas. */
export function mensajeAmbiguo(entero: string, decimal: string | null): string {
  return decimal
    ? `¿${entero} o ${decimal}? Escribe el número sin separador de miles.`
    : `Escribe el número sin separador de miles: ${entero}.`;
}

const SIMPLE = /^([-+]?)(\d+)$/;
const DECIMAL = /^([-+]?)(\d+)[.,](\d+)$/;
// Dos o más grupos de tres cifras con el mismo separador: 1,234,567 · 1.234.567 · 1 234 567.
const AGRUPADO = /^([-+]?)(\d{1,3})((?:([.,\u0020\u00a0])\d{3})(?:\4\d{3})+)$/;
// Un grupo de miles con espacio: 1 200.
const ESPACIO = /^([-+]?)(\d{1,3})[\u0020\u00a0](\d{3})$/;
// Miles con un separador y decimales con el otro: 1,234.5 · 1.234,5 · 1 234,5.
const MIXTO = /^([-+]?)(\d{1,3}(?:([.,\u0020\u00a0])\d{3})+)([.,])(\d+)$/;

/** Clasifica un número ya recortado, sin unidad. */
function clasificar(t: string): NumeroEscrito {
  let m = SIMPLE.exec(t);
  if (m) return { tipo: "numero", valor: Number(m[1] + m[2]) };
  m = DECIMAL.exec(t);
  if (m) {
    const [, signo, ent, dec] = m;
    // «1,200» o «360.000»: tres cifras después de un entero de una a tres cifras que no empieza en 0.
    if (dec.length === 3 && /^[1-9]\d{0,2}$/.test(ent)) {
      const sinCeros = dec.replace(/0+$/, "");
      return { tipo: "ambiguo", mensaje: mensajeAmbiguo(`${signo}${ent}${dec}`, sinCeros ? `${signo}${ent},${sinCeros}` : `${signo}${ent}`) };
    }
    return { tipo: "numero", valor: Number(`${signo}${ent}.${dec}`) };
  }
  m = ESPACIO.exec(t);
  if (m) return { tipo: "ambiguo", mensaje: mensajeAmbiguo(`${m[1]}${m[2]}${m[3]}`, null) };
  m = AGRUPADO.exec(t);
  if (m) return { tipo: "ambiguo", mensaje: mensajeAmbiguo(`${m[1]}${(m[2] + m[3]).replace(/[^\d]/g, "")}`, null) };
  m = MIXTO.exec(t);
  if (m && m[3] !== m[4]) return { tipo: "ambiguo", mensaje: mensajeAmbiguo(`${m[1]}${m[2].replace(/[^\d]/g, "")},${m[5]}`, null) };
  return { tipo: "texto" };
}

/**
 * Lo escrito completo es un número. Para un campo que solo acepta número: la
 * lectura de una parada de ronda o el valor de un paso del checklist. Un número
 * que ya llega como número se acepta tal cual.
 */
export function leerNumero(v: unknown): NumeroEscrito {
  if (typeof v === "number") return Number.isFinite(v) ? { tipo: "numero", valor: v } : { tipo: "texto" };
  const t = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v).trim();
  if (!t) return { tipo: "vacio" };
  return clasificar(t);
}

// El número con que empieza un texto, con la unidad al lado: «14,5 A», «1,200 ppm».
// Un espacio cuenta como separador de miles solo si lo siguen tres cifras.
const AL_INICIO = /^([-+]?\d+(?:[.,\u0020\u00a0]\d+)*)/;

/**
 * El número con que empieza lo escrito, aunque traiga la unidad al lado. Para
 * una lectura de liberación, que puede escribirse «14,5 A». Sin número al
 * inicio devuelve «texto».
 */
export function numeroAlInicio(v: unknown): NumeroEscrito {
  if (typeof v === "number") return Number.isFinite(v) ? { tipo: "numero", valor: v } : { tipo: "texto" };
  const t = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v).trim();
  if (!t) return { tipo: "vacio" };
  const m = AL_INICIO.exec(t);
  if (!m) return { tipo: "texto" };
  let token = m[1];
  // Un espacio que no separa miles termina el número: «12 5 A» se lee 12.
  const partes = token.split(/[\u0020\u00a0]/);
  if (partes.length > 1) {
    let i = 1;
    while (i < partes.length && /^\d{3}(?:[.,]\d+)?$/.test(partes[i])) i++;
    token = partes.slice(0, i).join(" ");
  }
  const r = clasificar(token);
  return r.tipo === "texto" ? { tipo: "texto" } : r;
}

/** El valor de un número leído, o null si no lo es. */
export const valorDe = (r: NumeroEscrito): number | null => (r.tipo === "numero" ? r.valor : null);
