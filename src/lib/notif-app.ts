// Crear notificación in-app para mostrar en la campana del topbar.

import type { APIContext } from "astro";
import { getDb } from "./db";
import { notificaciones } from "./schema";

export async function crearNotificacion(
  ctx: APIContext,
  params: { usuarioId: number; tipo: string; titulo: string; mensaje?: string; link?: string }
): Promise<void> {
  const db = getDb(ctx);
  await db.insert(notificaciones).values({
    usuarioId: params.usuarioId,
    tipo: params.tipo,
    titulo: params.titulo,
    mensaje: params.mensaje ?? null,
    link: params.link ?? null,
  });
}
