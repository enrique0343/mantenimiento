import { and, eq, isNull, or, sql } from "drizzle-orm";
import { tickets } from "./schema";

type Solicitante = { id: number; email?: string };
type Solicitud = { solicitanteUsuarioId: number | null; solicitanteEmail: string };

/** Las solicitudes con cuenta quedan vinculadas al id estable; el correo solo sirve para las anteriores sin cuenta. */
export function esSolicitudPropia(user: Solicitante, ticket: Solicitud): boolean {
  return ticket.solicitanteUsuarioId !== null
    ? ticket.solicitanteUsuarioId === user.id
    : !!user.email && ticket.solicitanteEmail.trim().toLowerCase() === user.email.trim().toLowerCase();
}

export function condicionSolicitudPropia(user: Solicitante) {
  return or(eq(tickets.solicitanteUsuarioId, user.id), and(
    isNull(tickets.solicitanteUsuarioId),
    user.email ? sql`lower(trim(${tickets.solicitanteEmail})) = ${user.email.trim().toLowerCase()}` : sql`0`,
  ));
}
