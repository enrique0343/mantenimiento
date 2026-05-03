import type { APIRoute } from "astro";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { sendMail, emailLayout } from "@/lib/email";

export const prerender = false;

const schema = z.object({ to: z.string().email() });

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const r = await sendMail(ctx, {
    to: parsed.data.to,
    subject: "Prueba de configuración - Mantenimiento",
    html: emailLayout(
      "Prueba de envío",
      `<p>Si recibes este mensaje, la integración con Microsoft 365 está funcionando.</p>
       <p>Enviado por <strong>${user.nombre}</strong> el ${new Date().toLocaleString("es")}.</p>`
    ),
    tipo: "test",
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: 500 });
  return Response.json({ ok: true });
};
