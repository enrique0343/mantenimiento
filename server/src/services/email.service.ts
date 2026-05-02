import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = `"${process.env.SMTP_FROM_NAME || 'Gestión de Mantenimiento'}" <${process.env.SMTP_USER}>`;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

async function send(to: string, subject: string, html: string): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    console.log(`📧 Email → ${to} | ${subject}`);
    return;
  }
  await transporter.sendMail({ from: FROM, to, subject, html });
}

function baseTemplate(title: string, body: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#1e40af;border-bottom:2px solid #1e40af;padding-bottom:8px">${title}</h2>
      ${body}
      <hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb"/>
      <p style="color:#6b7280;font-size:12px;margin-top:8px">
        Sistema de Gestión de Mantenimiento — Este es un correo automático, no responder.
      </p>
    </div>`;
}

// ── Helpdesk ──────────────────────────────────────────────────────────────────

export async function sendTicketCreated(opts: {
  to: string;
  requesterName: string;
  ticketCode: string;
  trackingToken: string;
  description: string;
}): Promise<void> {
  const trackingUrl = `${CLIENT_URL}/helpdesk/ticket/${opts.trackingToken}`;
  await send(
    opts.to,
    `[${opts.ticketCode}] Su solicitud ha sido recibida`,
    baseTemplate(
      `Solicitud recibida — ${opts.ticketCode}`,
      `<p>Estimado/a <strong>${opts.requesterName}</strong>,</p>
       <p>Hemos recibido su solicitud correctamente.</p>
       <p><strong>Descripción:</strong><br/>${opts.description}</p>
       <p>Puede hacer seguimiento en cualquier momento usando el siguiente enlace:</p>
       <p><a href="${trackingUrl}" style="color:#1e40af">${trackingUrl}</a></p>`
    )
  );
}

export async function sendTicketStatusUpdate(opts: {
  to: string;
  requesterName: string;
  ticketCode: string;
  trackingToken: string;
  newStatus: string;
  comment?: string;
}): Promise<void> {
  const statusLabels: Record<string, string> = {
    IN_PROGRESS: 'En progreso',
    ESCALATED: 'Escalado',
    RESOLVED: 'Resuelto',
    CLOSED: 'Cerrado',
  };
  const label = statusLabels[opts.newStatus] || opts.newStatus;
  const trackingUrl = `${CLIENT_URL}/helpdesk/ticket/${opts.trackingToken}`;

  await send(
    opts.to,
    `[${opts.ticketCode}] Actualización: ${label}`,
    baseTemplate(
      `Actualización de su solicitud — ${opts.ticketCode}`,
      `<p>Estimado/a <strong>${opts.requesterName}</strong>,</p>
       <p>El estado de su solicitud cambió a: <strong>${label}</strong></p>
       ${opts.comment ? `<p><strong>Comentario del técnico:</strong><br/>${opts.comment}</p>` : ''}
       <p><a href="${trackingUrl}" style="color:#1e40af">Ver seguimiento</a></p>`
    )
  );
}

export async function sendNewTicketNotification(opts: {
  to: string;
  ticketCode: string;
  requesterName: string;
  priority: string;
  description: string;
  area: string;
}): Promise<void> {
  const priorityLabels: Record<string, string> = {
    CRITICAL: '🔴 Crítica',
    HIGH: '🟠 Alta',
    MEDIUM: '🟡 Media',
    LOW: '🟢 Baja',
  };
  await send(
    opts.to,
    `[Nuevo ticket ${opts.ticketCode}] ${priorityLabels[opts.priority] || opts.priority}`,
    baseTemplate(
      `Nuevo ticket — ${opts.ticketCode}`,
      `<p>Se recibió una nueva solicitud de helpdesk.</p>
       <table style="border-collapse:collapse;width:100%">
         <tr><td style="padding:4px 8px;font-weight:bold">Solicitante</td><td>${opts.requesterName}</td></tr>
         <tr><td style="padding:4px 8px;font-weight:bold">Área</td><td>${opts.area}</td></tr>
         <tr><td style="padding:4px 8px;font-weight:bold">Prioridad</td><td>${priorityLabels[opts.priority] || opts.priority}</td></tr>
         <tr><td style="padding:4px 8px;font-weight:bold">Descripción</td><td>${opts.description}</td></tr>
       </table>
       <p><a href="${CLIENT_URL}/helpdesk" style="color:#1e40af">Ver en el sistema</a></p>`
    )
  );
}

// ── Órdenes de Trabajo ────────────────────────────────────────────────────────

export async function sendWOAssigned(opts: {
  to: string;
  technicianName: string;
  woCode: string;
  equipmentName: string;
  scheduledDate?: string;
}): Promise<void> {
  await send(
    opts.to,
    `[OT ${opts.woCode}] Se te asignó una orden de trabajo`,
    baseTemplate(
      `Nueva OT asignada — ${opts.woCode}`,
      `<p>Hola <strong>${opts.technicianName}</strong>,</p>
       <p>Se te asignó una orden de trabajo.</p>
       <p><strong>Equipo:</strong> ${opts.equipmentName}</p>
       ${opts.scheduledDate ? `<p><strong>Fecha programada:</strong> ${opts.scheduledDate}</p>` : ''}
       <p><a href="${CLIENT_URL}/ordenes/${opts.woCode}" style="color:#1e40af">Ver OT</a></p>`
    )
  );
}

export async function sendPreventiveAlert(opts: {
  to: string;
  equipmentName: string;
  woCode: string;
  dueDate: string;
  daysLeft: number;
}): Promise<void> {
  await send(
    opts.to,
    `⚠️ Mantenimiento preventivo próximo — ${opts.equipmentName}`,
    baseTemplate(
      `Alerta: mantenimiento preventivo`,
      `<p>El equipo <strong>${opts.equipmentName}</strong> tiene un mantenimiento preventivo programado en <strong>${opts.daysLeft} día(s)</strong>.</p>
       <p><strong>Fecha límite:</strong> ${opts.dueDate}</p>
       <p><strong>OT:</strong> ${opts.woCode}</p>
       <p><a href="${CLIENT_URL}" style="color:#1e40af">Ir al sistema</a></p>`
    )
  );
}

// ── Inventario ────────────────────────────────────────────────────────────────

export async function sendLowStockAlert(opts: {
  to: string;
  partName: string;
  partCode: string;
  branchName: string;
  currentStock: number;
  minStock: number;
}): Promise<void> {
  await send(
    opts.to,
    `⚠️ Stock bajo — ${opts.partName}`,
    baseTemplate(
      `Alerta de stock bajo`,
      `<p>El repuesto <strong>${opts.partName}</strong> (${opts.partCode}) en la sucursal <strong>${opts.branchName}</strong> está por debajo del stock mínimo.</p>
       <p><strong>Stock actual:</strong> ${opts.currentStock} | <strong>Stock mínimo:</strong> ${opts.minStock}</p>
       <p><a href="${CLIENT_URL}/inventario" style="color:#1e40af">Ver inventario</a></p>`
    )
  );
}
