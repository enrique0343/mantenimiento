import type { APIContext } from "astro";
import { eq, or } from "drizzle-orm";
import { getDb } from "./db";
import { usuarios, activos } from "./schema";
import { condicionActivoEspacio, espaciosPermitidos, puedeEntrar, type Espacio } from "./espacio";

export type Especialidad = "general" | "biomedico" | "ambos" | "tecnologia" | null;

export interface UsuarioConEspecialidad {
  id: number;
  rol: string;
  especialidad: Especialidad;
}

// Compatibilidad del tipo físico (TI usa general). Para permisos usar activosVisibles.
export function tipoActivoFiltro(esp: Especialidad): "general" | "biomedico" | null {
  if (!esp || esp === "ambos") return null;
  return esp === "tecnologia" ? "general" : esp;
}

// Devuelve los IDs de activos que el usuario PUEDE ver según su especialidad.
// Solo admin/visualizador devuelven null (alcance global); los demás filtran por espacio.
export async function activosVisibles(
  ctx: APIContext,
  esp: Especialidad
): Promise<number[] | null> {
  const user = ctx.locals.user;
  if (user?.rol === "admin" || user?.rol === "visualizador") return null;
  const permitidos = espaciosPermitidos({ rol: user?.rol ?? "tecnico", especialidad: esp });
  const db = getDb(ctx);
  const rows = await db.select({ id: activos.id }).from(activos).where(or(...permitidos.map(condicionActivoEspacio)));
  return rows.map((r) => r.id);
}

// Para notificaciones: encuentra al jefe (o ambos jefes) que debe ser notificado
// según el espacio. Sin dato conserva los destinatarios históricos, excluyendo TI.
export async function jefesNotificar(
  ctx: APIContext,
  tipoEquipo: Espacio | null
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
    .filter((u) => tipoEquipo ? puedeEntrar({ rol: "jefe", especialidad: u.especialidad }, tipoEquipo) : u.especialidad !== "tecnologia")
    .map((u) => ({ id: u.id, email: u.email, nombre: u.nombre }));
}
