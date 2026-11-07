// Modo técnico · una foto del teléfono pesa varios MB; subirla así con señal
// floja bloquea casi un minuto. Se reduce antes de guardarla y se envía por detrás.
const LADO_MAX = 1600;
const CALIDAD = 0.72;

export interface FotoLista {
  blob: Blob;
  url: string;
  antes: number;
  despues: number;
}

export async function comprimir(file: File): Promise<FotoLista> {
  let fuente: ImageBitmap | HTMLImageElement;
  let ancho: number;
  let alto: number;
  try {
    const b = await createImageBitmap(file);
    fuente = b; ancho = b.width; alto = b.height;
  } catch {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("imagen ilegible"));
      i.src = URL.createObjectURL(file);
    });
    fuente = img; ancho = img.naturalWidth; alto = img.naturalHeight;
  }
  const k = Math.min(1, LADO_MAX / Math.max(ancho, alto));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(ancho * k));
  lienzo.height = Math.max(1, Math.round(alto * k));
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("sin lienzo");
  ctx.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
  const blob = await new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, "image/jpeg", CALIDAD));
  if (!blob) throw new Error("sin imagen");
  // Si por alguna razón no bajó de peso, se queda la original.
  const final = blob.size < file.size || !file.type.startsWith("image/jpeg") ? blob : file;
  return { blob: final, url: URL.createObjectURL(final), antes: file.size, despues: final.size };
}

export const peso = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
