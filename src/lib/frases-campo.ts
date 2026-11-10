// Las frases de un paso que cambió en la ficha mientras tanto (K17 y K19). Las
// usan el servidor (src/lib/campo.ts) y el celular (src/campo/app.ts): el
// celular reconoce el paso por la frase del rechazo y dice la misma frase cuando
// no deja enviar la orden.

/** El rechazo de una marca cuando el paso cambió en la ficha mientras tanto. N es el número que ve el técnico. */
export const pasoCambioEnLaFicha = (emergencia: boolean, idx: number) =>
  emergencia
    ? `La acción ${idx + 1} cambió en la ficha mientras tanto: revísala y márcala otra vez.`
    : `El paso ${idx + 1} cambió en la ficha mientras tanto: revísalo y márcalo otra vez.`;

/** El número del paso en la frase de pasoCambioEnLaFicha, guardada con el rechazo. */
export const PASO_DE_LA_FRASE = /^(?:El paso|La acción) (\d+) cambió en la ficha mientras tanto/;

/** El índice del paso de una frase de pasoCambioEnLaFicha, o null si es otra frase. */
export function pasoDeLaFrase(texto: unknown): number | null {
  const m = PASO_DE_LA_FRASE.exec(String(texto ?? ""));
  return m ? Number(m[1]) - 1 : null;
}

/** K19 · El envío que no sale mientras un paso que cambió en la ficha no se vuelva a marcar. `idxs`, ordenados. */
export function envioConPasosCambiados(emergencia: boolean, idxs: number[]): string {
  const n = idxs.map((i) => i + 1);
  const cuales = n.length === 1 ? String(n[0]) : `${n.slice(0, -1).join(", ")} y ${n[n.length - 1]}`;
  const que = emergencia
    ? n.length === 1 ? `la acción ${cuales} cambió en la ficha mientras tanto. Revísala, márcala` : `las acciones ${cuales} cambiaron en la ficha mientras tanto. Revísalas, márcalas`
    : n.length === 1 ? `el paso ${cuales} cambió en la ficha mientras tanto. Revísalo, márcalo` : `los pasos ${cuales} cambiaron en la ficha mientras tanto. Revísalos, márcalos`;
  return `La orden no se envió: ${que} otra vez y vuelve a enviarla.`;
}

/**
 * Los pasos que nombra el rechazo de un envío («La orden no se envió: los pasos 2 y 3 cambiaron en la ficha mientras
 * tanto…»), como índices. El cierre en dos pasos marca varios pasos de una vez: si la ficha cambió alguno, el envío
 * entero vuelve y el celular lleva al técnico a cada uno antes de dejarlo enviar otra vez.
 */
export const PASOS_DEL_ENVIO = /^La orden no se envió: (?:el paso|la acción|los pasos|las acciones) (\d+(?:, \d+)*(?: y \d+)?) cambi(?:ó|aron) en la ficha mientras tanto/;
export function pasosDelEnvio(texto: unknown): number[] {
  const m = PASOS_DEL_ENVIO.exec(String(texto ?? ""));
  return m ? (m[1].match(/\d+/g) ?? []).map((n) => Number(n) - 1) : [];
}

/** Sin foto no hay cierre: la regla del servidor y la del celular dicen lo mismo. */
export const FALTA_LA_FOTO = "Falta la foto: toma al menos una foto del trabajo antes de enviar a verificación.";
