import type { APIRoute } from "astro";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { sendMail, emailLayout, detectarProveedor, nombreProveedor } from "@/lib/email";
import { getEnv } from "@/lib/db";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const env = getEnv(ctx);
  const proveedor = detectarProveedor(env as any);
  return Response.json({ proveedor, nombre: nombreProveedor(proveedor) });
};

const schema = z.object({ to: z.string().email() });

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const env = getEnv(ctx);
  const proveedorActual = detectarProveedor(env as any);
  const r = await sendMail(ctx, {
    to: parsed.data.to,
    subject: "Prueba de configuración - Mantenimiento",
    html: emailLayout(
      "Prueba de envío",
      `<p>Si recibes este mensaje, la integración de email está funcionando.</p>
       <p>Proveedor: <strong>${nombreProveedor(proveedorActual)}</strong></p>
       <p>Enviado por <strong>${user.nombre}</strong> el ${new Date().toLocaleString("es")}.</p>`
    ),
    tipo: "test",
  });
  if (!r.ok) return Response.json({ error: r.error, proveedor: r.proveedor, nombreProveedor: nombreProveedor(r.proveedor ?? "ninguno") }, { status: 500 });
  return Response.json({ ok: true, proveedor: r.proveedor, nombreProveedor: nombreProveedor(r.proveedor!) });
};
