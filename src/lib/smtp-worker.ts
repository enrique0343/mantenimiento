// Cliente SMTP para Cloudflare Workers usando cloudflare:sockets
// Soporta port 587 (STARTTLS) y port 465 (SSL directo)
// Variables requeridas: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
// Variable opcional:    EMAIL_FROM_NAME

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromName?: string;
}

export interface SmtpMessage {
  to: string[];
  subject: string;
  html: string;
  cc?: string[];
  replyTo?: string[];
}

// Lee líneas de un ReadableStream acumulando en buffer interno
class LineReader {
  private buf = "";
  private dec = new TextDecoder();
  constructor(private r: ReadableStreamDefaultReader<Uint8Array>) {}

  async line(): Promise<string> {
    while (!this.buf.includes("\r\n")) {
      const { value, done } = await this.r.read();
      if (done) throw new Error("SMTP: conexión cerrada inesperadamente");
      this.buf += this.dec.decode(value, { stream: true });
    }
    const i = this.buf.indexOf("\r\n");
    const line = this.buf.slice(0, i);
    this.buf = this.buf.slice(i + 2);
    return line;
  }

  // Lee respuesta SMTP (puede ser multi-línea: "250-..." hasta "250 ...")
  async resp(): Promise<{ code: number; text: string }> {
    let code = 0;
    let text = "";
    while (true) {
      const line = await this.line();
      code = parseInt(line.slice(0, 3), 10);
      text = line.slice(4);
      if (line[3] !== "-") break; // último segmento
    }
    return { code, text };
  }

  releaseLock() { this.r.releaseLock(); }
}

class LineWriter {
  private enc = new TextEncoder();
  constructor(private w: WritableStreamDefaultWriter<Uint8Array>) {}

  async send(s: string) {
    await this.w.write(this.enc.encode(s + "\r\n"));
  }

  releaseLock() { this.w.releaseLock(); }
}

function expect(r: { code: number; text: string }, expected: number, ctx: string) {
  if (r.code !== expected) throw new Error(`SMTP ${ctx}: esperaba ${expected}, recibí ${r.code} ${r.text}`);
}

function toB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function buildEmail(cfg: SmtpConfig, msg: SmtpMessage): string {
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.from}>` : cfg.from;
  const boundary = `_mnt_${Date.now()}`;
  const headers: string[] = [
    `From: ${from}`,
    `To: ${msg.to.join(", ")}`,
  ];
  if (msg.cc && msg.cc.length) headers.push(`Cc: ${msg.cc.join(", ")}`);
  if (msg.replyTo && msg.replyTo.length) headers.push(`Reply-To: ${msg.replyTo.join(", ")}`);
  return [
    ...headers,
    `Subject: =?UTF-8?B?${toB64(msg.subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    toB64(msg.html),
    ``,
    `--${boundary}--`,
  ].join("\r\n");
}

export async function sendSmtpWorker(cfg: SmtpConfig, msg: SmtpMessage): Promise<void> {
  // cloudflare:sockets disponible con nodejs_compat o runtime moderno
  // @ts-ignore
  const { connect } = await import("cloudflare:sockets");

  const is465 = cfg.port === 465;

  const socket = connect(
    { hostname: cfg.host, port: cfg.port },
    { secureTransport: is465 ? "on" : "starttls" }
  );

  let reader = new LineReader(socket.readable.getReader());
  let writer = new LineWriter(socket.writable.getWriter());

  // Saludo inicial
  let r = await reader.resp();
  expect(r, 220, "saludo");

  // EHLO
  await writer.send("EHLO mantenimiento-app");
  r = await reader.resp();
  expect(r, 250, "EHLO");

  if (!is465) {
    // STARTTLS (port 587)
    await writer.send("STARTTLS");
    r = await reader.resp();
    expect(r, 220, "STARTTLS");

    // Liberar locks antes de upgradar a TLS
    reader.releaseLock();
    writer.releaseLock();

    const secure = await socket.startTls();
    reader = new LineReader(secure.readable.getReader());
    writer = new LineWriter(secure.writable.getWriter());

    // EHLO nuevamente sobre TLS
    await writer.send("EHLO mantenimiento-app");
    r = await reader.resp();
    expect(r, 250, "EHLO/TLS");
  }

  // AUTH LOGIN
  await writer.send("AUTH LOGIN");
  r = await reader.resp();
  expect(r, 334, "AUTH LOGIN");

  await writer.send(btoa(cfg.user));
  r = await reader.resp();
  expect(r, 334, "AUTH user");

  await writer.send(btoa(cfg.pass));
  r = await reader.resp();
  expect(r, 235, "AUTH pass");

  // MAIL FROM
  await writer.send(`MAIL FROM:<${cfg.from}>`);
  r = await reader.resp();
  expect(r, 250, "MAIL FROM");

  // RCPT TO (incluye to + cc para que ambos reciban el correo)
  const allRecipients = [...msg.to, ...(msg.cc ?? [])];
  for (const to of allRecipients) {
    await writer.send(`RCPT TO:<${to}>`);
    r = await reader.resp();
    expect(r, 250, `RCPT TO <${to}>`);
  }

  // DATA
  await writer.send("DATA");
  r = await reader.resp();
  expect(r, 354, "DATA");

  // Cuerpo del email + terminador "."
  await writer.send(buildEmail(cfg, msg) + "\r\n.");
  r = await reader.resp();
  expect(r, 250, "cuerpo mensaje");

  // QUIT
  await writer.send("QUIT");
  try { await reader.resp(); } catch { /* ok */ }

  reader.releaseLock();
  writer.releaseLock();
  try { socket.close(); } catch { /* ok */ }
}
