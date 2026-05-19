// Helpers para filtrar vistas según especialidad del usuario.
// - Admin: ve todo (sin filtro)
// - Jefe/Tecnico con especialidad="general": solo equipos tipo "general" (o sin equipo)
// - Jefe/Tecnico con especialidad="biomedico": solo equipos tipo "biomedico"
// - especialidad="ambos" o null: ve todo

import type { APIContext } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { usuarios, activos } from "./schema";

export type Especialidad = "general" | "biomedico" | "ambos" | null;

export interface UsuarioConEspecialidad {
  id: number;
  rol: string;
  especialidad: Especialidad;
}

// Decide si el usuario aplica filtro por tipo de activo
export function tipoActivoFiltro(esp: Especialidad): "general" | "biomedico" | null {
  if (!esp || esp === "ambos") return null;
  return esp;
}

// Devuelve los IDs de activos que el usuario PUEDE ver según su especialidad.
// Si el filtro es null, no aplicar nada en query (puede ver todo).
export async function activosVisibles(
  ctx: APIContext,
  esp: Especialidad
): Promise<number[] | null> {
  const filtro = tipoActivoFiltro(esp);
  if (!filtro) return null;
  const db = getDb(ctx);
  const rows = await db.select({ id: activos.id }).from(activos).where(eq(activos.tipo, filtro));
  return rows.map((r) => r.id);
}

// Para notificaciones: encuentra al jefe (o ambos jefes) que debe ser notificado
// según el tipo de equipo. Si no hay equipo asociado, notifica a todos los jefes.
export async function jefesNotificar(
  ctx: APIContext,
  tipoEquipo: "general" | "biomedico" | null
): Promise<{ id: number; email: string; nombre: string }[]> {
  const db = getDb(ctx);
  const rows = await db
    .select({
      id: usuarios.id,
      email: usuarios.email,
      nombre: usuarios.nombre,
      especialidad: usuarios.especialidad,
    })
    .from(usuarios)
    .where(eq(usuarios.rol, "jefe"));

  return rows
    .filter((u) => {
      // Sin tipo o jefe con "ambos" → siempre notifica
      if (!tipoEquipo) return true;
      if (u.especialidad === "ambos" || !u.especialidad) return true;
      return u.especialidad === tipoEquipo;
    })
    .map((u) => ({ id: u.id, email: u.email, nombre: u.nombre }));
}
