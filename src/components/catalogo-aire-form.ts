/** Only shared model fields belong to the catalog. Unit identity stays separate. */
export function datosFichaAire(form: HTMLFormElement) {
  const data = new FormData(form);
  const text = (key: string) => String(data.get(key) ?? "").trim().toUpperCase();
  return {
    nombre: text("nombre"), descripcion: text("descripcion") || null,
    categoria: text("categoria") || null, marca: text("marca") || null, modelo: text("modelo") || null,
    datosTecnicos: {
      tipoUnidad: text("tipoUnidad") || null,
      capacidadBtuH: text("capacidadBtuH") ? Number(text("capacidadBtuH")) : null,
      refrigerante: text("refrigerante") || null,
    },
  };
}

export function errorFichaAire(json: unknown, fallback: string): string {
  if (json && typeof json === "object" && "error" in json && typeof json.error === "string") return json.error;
  return fallback;
}
