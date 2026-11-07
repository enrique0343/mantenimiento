// Modo técnico. El celular trabaja primero y sincroniza después: cada toque se
// aplica aquí, se guarda en el teléfono con su hora real y se envía en orden.
// Si se va la señal no cambia nada para el técnico.
import * as cola from "./cola";
import type { Op } from "./cola";
import { comprimir, peso } from "./foto";
import { turnoActual } from "../lib/turnos";
import { etiquetaOT } from "../lib/orden-codigo";

const TZ = "America/El_Salvador";
const cuerpo = document.body.dataset;
const UID = Number(cuerpo.uid);
const NOMBRE = cuerpo.nombre ?? "";
const ROL = cuerpo.rol ?? "tecnico";

const svg = (d: string) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ico = {
  casa: svg('<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>'),
  lupa: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  falla: svg('<path d="M12 3 2 20h20zM12 10v4M12 17v.5"/>'),
  ayuda: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1.9-1.1 1.8M12 17v.5"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  flecha: svg('<path d="m9 6 6 6-6 6"/>'),
  abajo: svg('<path d="m6 9 6 6 6-6"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  camara: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  pausa: svg('<path d="M9 5v14M15 5v14"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z"/>'),
};

type Any = any;
interface Flujo { tipo: "pm" | "ronda"; ordenId?: number; i: number }
const E = {
  base: null as Any,
  p: null as Any,
  pend: [] as Op[],
  rechazos: [] as Any[],
  sede: null as number | null,
  enLinea: navigator.onLine,
  drenando: false,
  guardado: false,
  sesionVencida: false,
  cargando: true,
  vista: "hoy",
  params: {} as Any,
  flujo: null as Flujo | null,
  hoja: null as Any,
  grupo: null as string | null,
  listo: null as Any,
  notas: {} as Record<string, string>,
  verNota: false,
  b: { ubicaciones: null as Any, sinUbicacion: 0, equipos: null as Any, ubId: null as string | null, ubNombre: "", ficha: null as Any, copia: false, error: "", modo: "buscar" },
  lock: null as Any,
  ultimoSeq: 0,
  ultimoFetch: 0,
  instalar: null as Any,
};

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const num = (s: unknown): number | null => { const t = String(s ?? "").replace(",", ".").trim(); if (t === "") return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const hora = (iso: string | number | Date) => new Date(iso).toLocaleTimeString("es-SV", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
const hoySV = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
const fecha = (iso: string | null | undefined) => {
  if (!iso) return "";
  const s = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(Date.parse(iso) - 6 * 3_600_000).toISOString().slice(0, 10);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
};
const duracion = (min: number) => { const m = Math.max(0, Math.round(min)); if (m < 60) return `${m} min`; const h = Math.floor(m / 60); return `${h} h${m % 60 ? ` ${m % 60} min` : ""}`; };
const relojTxt = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0"); const ss = String(s % 60).padStart(2, "0"); return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`; };
const plazo = (m: number | null | undefined) => (m == null ? "Sin plazo" : m >= 60 ? `${Math.round((m / 60) * 10) / 10} h` : `${m} min`);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
const zumbar = () => { try { navigator.vibrate?.(12); } catch {} };
const primerNombre = (n: string) => n.split(/\s+/)[0] || n;

const rangoDe = (p: Any) => {
  const u = p.unidad ? ` ${p.unidad}` : "";
  if (p.min != null && p.max != null) return `${p.min} a ${p.max}${u}`;
  if (p.min != null) return `mínimo ${p.min}${u}`;
  if (p.max != null) return `máximo ${p.max}${u}`;
  return "";
};
const fueraDe = (p: Any, v: number) => (p.min != null && v < p.min) || (p.max != null && v > p.max);
const SISTEMAS: Record<string, string> = { electrico: "Sistema eléctrico", hvac: "Climatización crítica", minisplit: "Minisplit", gases: "Gases medicinales", agua: "Agua", incendios: "Incendios", ascensores: "Ascensores", otro: "Otros" };
const limpiarTitulo = (t: string) => String(t ?? "").replace(/^\[[^\]]+\]\s*/, "");
const tituloOrden = (o: Any) => o.activo?.nombre || limpiarTitulo(o.titulo);
const subOrden = (o: Any) => [o.activo?.codigo, o.lugar?.ubicacion].filter(Boolean).join(" · ");
const ordenDe = (id: number) => E.p?.ordenes.find((o: Any) => o.id === id) ?? E.p?.libres.find((o: Any) => o.id === id) ?? null;
const efectivoMs = (o: Any) => {
  if (!o.iniciadaEn) return 0;
  const fin = o.pausadaEn ? Date.parse(o.pausadaEn) : Date.now();
  return fin - Date.parse(o.iniciadaEn) - (o.pausadoMin ?? 0) * 60000;
};

// ── Lo que cada operación cambia en pantalla ────────────────────────────────
function aplicarLocal(p: Any, op: Op) {
  if (!p) return;
  const o = op.ordenId ? p.ordenes.find((x: Any) => x.id === op.ordenId) ?? p.libres.find((x: Any) => x.id === op.ordenId) : null;
  switch (op.tipo) {
    case "orden.iniciar":
      if (!o) break;
      if (!o.iniciadaEn) o.iniciadaEn = op.at;
      if (o.pausadaEn) { o.pausadoMin = (o.pausadoMin ?? 0) + Math.max(0, Math.round((Date.parse(op.at) - Date.parse(o.pausadaEn)) / 60000)); o.pausadaEn = null; }
      o.estado = "en_proceso";
      if (!o.asignadoA) {
        o.asignadoA = UID;
        p.libres = p.libres.filter((x: Any) => x.id !== o.id);
        if (!p.ordenes.some((x: Any) => x.id === o.id)) p.ordenes.unshift(o);
      }
      break;
    case "orden.pausar":
      if (o) { o.estado = "en_espera"; o.pausadaEn = op.at; o.motivoPausa = op.motivo; }
      break;
    case "orden.reanudar":
      if (o) {
        if (o.pausadaEn) o.pausadoMin = (o.pausadoMin ?? 0) + Math.max(0, Math.round((Date.parse(op.at) - Date.parse(o.pausadaEn)) / 60000));
        o.pausadaEn = null; o.estado = "en_proceso"; o.motivoPausa = null;
      }
      break;
    case "orden.paso": {
      const paso = o?.pasos?.[op.idx as number];
      if (paso) {
        paso.estado = op.estado;
        if (op.valor !== undefined && op.valor !== null) paso.valor = String(op.valor);
        if (typeof op.nota === "string") paso.nota = op.nota;
      }
      break;
    }
    case "orden.terminar":
      if (o) {
        p.ordenes = p.ordenes.filter((x: Any) => x.id !== o.id);
        p.hechasHoy = [{ id: o.id, codigo: o.codigo, titulo: o.titulo, estado: "completada", completadaEn: op.at }, ...(p.hechasHoy ?? []).filter((x: Any) => x.id !== o.id)];
      }
      break;
    case "foto":
      if (o) o.fotos = (o.fotos ?? 0) + 1;
      break;
    case "ronda.iniciar":
      if (esDeEstaRonda(p, op) && p.ronda.estado === "sin_iniciar") { p.ronda.estado = "en_curso"; p.ronda.iniciadaEn = op.at; }
      break;
    case "ronda.lectura":
      if (esDeEstaRonda(p, op)) {
        p.ronda.lecturas[op.puntoId as number] = { resultado: op.resultado, valor: op.valor ?? null, nota: op.nota ?? null };
        if (p.ronda.estado === "sin_iniciar") { p.ronda.estado = "en_curso"; p.ronda.iniciadaEn = op.at; }
      }
      break;
    case "ronda.cerrar":
      if (esDeEstaRonda(p, op)) p.ronda.estado = "completada";
      break;
    case "emergencia.abrir":
    case "correctivo.abrir":
      p.locales = [...(p.locales ?? []), { opId: op.opId, tipo: op.tipo, titulo: op.titulo ?? "Orden por enviar" }];
      break;
  }
}
const esDeEstaRonda = (p: Any, op: Any) => !!p.ronda && op.fecha === p.ronda.fecha && op.turno === p.ronda.turno && Number(op.sucursalId) === Number(p.ronda.sucursalId);
/** Sin señal al cambiar de turno: la misma lista, una ronda nueva. A media ronda se termina con su turno, pero no para siempre. */
function rodarTurno(): boolean {
  const r = E.base?.ronda;
  if (!r?.turnos?.length) return false;
  if (E.flujo?.tipo === "ronda") {
    if (Date.now() - Date.parse(`${r.fecha}T${r.turno}:00-06:00`) < 16 * 3_600_000) return false;
    soltarPantalla();
    E.flujo = null;
    aviso("Esa ronda ya venció. Lo que anotaste quedó guardado.");
    ir("#hoy", true);
  }
  const t = turnoActual(r.turnos);
  if (t.fecha === r.fecha && t.turno === r.turno) return false;
  E.base.ronda = { ...r, fecha: t.fecha, turno: t.turno, etiqueta: t.etiqueta, estado: "sin_iniciar", ejecucionId: null, iniciadaEn: null, lecturas: {}, entregaAnterior: null };
  void cola.guardar(`hoy:${UID}`, E.base); // Si el sistema recarga la página, sigue en el turno nuevo.
  rebase();
  return true;
}
function rebase() {
  if (!E.base) { E.p = null; return; }
  E.p = JSON.parse(JSON.stringify(E.base));
  for (const op of E.pend) aplicarLocal(E.p, op);
}

// ── Enviar ──────────────────────────────────────────────────────────────────
async function despachar(parcial: Partial<Op> & { tipo: string }, at?: string) {
  E.ultimoSeq = Math.max(E.ultimoSeq + 1, Date.now());
  const op: Op = { seq: E.ultimoSeq, uid: UID, opId: uuid(), at: at ?? new Date().toISOString(), ...parcial };
  E.pend.push(op);
  aplicarLocal(E.p, op);
  refrescarPill();
  if (E.pend.length === 1) void cola.pedirPersistencia();
  await cola.poner(op);
  void drenar();
  return op;
}

// Un rechazo puede llegar cuando la orden ya salió de la lista de trabajo (al terminarla, por
// ejemplo): por eso se busca también en lo terminado y en la última copia del servidor.
const ordenParaNombrar = (id: number) => [E.p, E.base]
  .flatMap((p: Any) => [p?.ordenes, p?.libres, p?.hechasHoy, p?.porVerificar])
  .flatMap((lista: Any) => lista ?? [])
  .find((o: Any) => o.id === id);

const describirOp = (op: Any) => {
  if (op.tipo?.startsWith("orden.") || op.tipo === "foto") return op.ordenId ? etiquetaOT(ordenParaNombrar(op.ordenId) ?? { id: op.ordenId }) : "Orden";
  if (op.tipo?.startsWith("ronda.")) return "Ronda";
  if (op.tipo === "emergencia.abrir") return "Emergencia";
  if (op.tipo === "correctivo.abrir") return "Correctivo";
  if (op.tipo === "aop.abrir") return "Desviación";
  return "Registro";
};

async function enviarFoto(op: Op): Promise<{ ok: boolean; error?: string; status: number }> {
  const fd = new FormData();
  fd.set("opId", op.opId);
  fd.set("ordenId", String(op.ordenId));
  fd.set("categoria", String(op.categoria ?? "general"));
  fd.set("at", op.at);
  fd.set("file", new File([op.blob as Blob], String(op.nombre ?? "foto.jpg"), { type: (op.blob as Blob)?.type || "image/jpeg" }));
  const r = await fetch("/api/campo/foto", { method: "POST", body: fd });
  if (r.status === 401 || r.status >= 500) return { ok: false, status: r.status };
  const j: Any = await r.json().catch(() => ({}));
  return { ok: !!j.ok, error: j.error, status: r.status };
}

let tReintento: ReturnType<typeof setTimeout> | undefined;
let esperaMs = 5000;
function programarReintento() {
  clearTimeout(tReintento);
  tReintento = setTimeout(() => void drenar(), esperaMs);
  esperaMs = Math.min(esperaMs * 2, 60000);
}

async function drenar() {
  if (E.drenando || !E.pend.length || E.sesionVencida) return;
  E.drenando = true;
  refrescarPill();
  let huboCambios = false;
  let huboRechazo = false;
  let fallo = false;
  // Lo que el servidor ya aceptó de la ronda queda en la copia base: a media ronda, tras un cambio de turno, el paquete nuevo no lo trae.
  const quitarOp = async (op: Op) => { E.pend = E.pend.filter((x) => x.seq !== op.seq); if (E.base && String(op.tipo).startsWith("ronda.")) aplicarLocal(E.base, op); await cola.quitar(op.seq); };
  const rechazar = (op: Op, error?: string) => {
    huboRechazo = true;
    E.rechazos.push({ que: describirOp(op), error: error ?? "No se pudo guardar.", at: op.at });
  };
  try {
    while (E.pend.length) {
      const primero = E.pend[0];
      if (primero.tipo === "foto") {
        const r = await enviarFoto(primero);
        if (r.status === 401) { E.sesionVencida = true; break; }
        if (r.status >= 500) { fallo = true; break; }
        if (!r.ok) rechazar(primero, r.error);
        await quitarOp(primero);
      } else {
        const lote: Op[] = [];
        for (const op of E.pend) { if (op.tipo === "foto" || lote.length >= 20) break; lote.push(op); }
        const res = await fetch("/api/campo/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reloj: new Date().toISOString(), ops: lote.map(({ blob, seq, uid, ...resto }) => resto) }) });
        if (res.status === 401) { E.sesionVencida = true; break; }
        if (!res.ok) { fallo = true; break; }
        const j: Any = await res.json();
        for (const r of j.resultados ?? []) {
          const op = lote.find((x) => x.opId === r.opId);
          if (!op) continue;
          if (!r.ok) rechazar(op, r.error);
          await quitarOp(op);
        }
        if (j.detenido) { fallo = true; break; }
      }
      huboCambios = true;
      E.enLinea = true;
      esperaMs = 5000;
    }
  } catch {
    E.enLinea = false;
    fallo = true;
  }
  E.drenando = false;
  if (huboRechazo) {
    void cola.guardar(`rechazos:${UID}`, E.rechazos);
    aviso("El servidor no aceptó un registro. Revísalo en Hoy.");
  }
  if (fallo) programarReintento();
  if (huboCambios && !E.pend.length) {
    E.guardado = true;
    setTimeout(() => { E.guardado = false; refrescarPill(); }, 1400);
    void refrescarHoy();
  } else if (huboRechazo) {
    rebase();
    repintarSiEsSeguro();
  }
  refrescarPill();
  if (E.sesionVencida) repintarSiEsSeguro();
}

async function refrescarHoy() {
  E.ultimoFetch = Date.now();
  try {
    const r = await fetch(`/api/campo/hoy${E.sede ? `?sede=${E.sede}` : ""}`, { headers: { accept: "application/json" } });
    if (r.status === 401) { E.sesionVencida = true; E.cargando = false; repintarSiEsSeguro(); return; }
    if (!r.ok) throw new Error(String(r.status));
    const j: Any = await r.json();
    // A media ronda el paquete no le cambia el turno bajo los pies al técnico.
    const enCursoAqui = E.flujo?.tipo === "ronda" ? E.base?.ronda : null;
    if (enCursoAqui && (j.ronda?.fecha !== enCursoAqui.fecha || j.ronda?.turno !== enCursoAqui.turno)) j.ronda = enCursoAqui;
    // El servidor no pudo leer la ronda: se conserva la que ya había; no es que no haya ronda.
    if (j.rondaError && !j.ronda && E.base?.ronda && Number(E.base.ronda.sucursalId) === Number(j.sedeId)) j.ronda = E.base.ronda;
    E.base = j;
    E.sesionVencida = false;
    E.enLinea = true;
    if (!E.sede && j.sedeId) E.sede = j.sedeId;
    if (!E.sede && j.sedes?.length === 1) { E.sede = j.sedes[0].id; void cola.guardar(`sede:${UID}`, E.sede); void refrescarHoy(); }
    void cola.guardar(`hoy:${UID}`, j);
    rebase();
  } catch {
    E.enLinea = false;
  }
  E.cargando = false;
  refrescarPill();
  repintarSiEsSeguro();
  void drenar();
}
function repintarSiEsSeguro() {
  if (E.hoja) return;
  if (["hoy", "inicio", "pausa", "ayuda", "reportar"].includes(E.vista)) pintar({ conservar: true });
}

// ── Señal ───────────────────────────────────────────────────────────────────
function pillHtml() {
  const n = E.pend.length;
  if (E.sesionVencida) return `<button class="pill mal" data-a="sync">Sesión vencida${n ? ` · ${n} por enviar` : ""}</button>`;
  if (E.drenando) return `<button class="pill" data-a="sync">Enviando…</button>`;
  if (!E.enLinea) return `<button class="pill off" data-a="sync">Sin señal${n ? ` · ${n} por enviar` : ""}</button>`;
  if (n) return `<button class="pill off" data-a="sync">${n} por enviar</button>`;
  if (E.guardado) return `<button class="pill ok" data-a="sync">Guardado</button>`;
  return `<button class="pill" data-a="sync">Con señal</button>`;
}
function refrescarPill() { const s = $("#senal"); if (s) s.innerHTML = pillHtml(); }
let tAviso: ReturnType<typeof setTimeout> | undefined;
function aviso(t: string) {
  const a = $("#aviso");
  if (!a) return;
  a.textContent = t;
  a.hidden = false;
  clearTimeout(tAviso);
  tAviso = setTimeout(() => { a.hidden = true; }, 3200);
}

// ── Qué sigue ───────────────────────────────────────────────────────────────
const rondaFaltante = (r: Any) => (r ? r.puntos.findIndex((pt: Any) => !r.lecturas[pt.id]) : -1);
const primerPendiente = (o: Any) => o.pasos.findIndex((p: Any) => p.estado === "pendiente");
function siguienteOrden(lugar?: string | null) {
  const abiertas = (E.p?.ordenes ?? []).filter((o: Any) => o.estado === "abierta" && o.modo === "pasos");
  return abiertas.find((o: Any) => lugar && o.lugar?.ubicacion === lugar) ?? abiertas[0] ?? null;
}
const enCurso = () => (E.p?.ordenes ?? []).find((o: Any) => o.estado === "en_proceso" && o.modo === "pasos") ?? null;

function bloqueAhora(): { html: string; ordenId?: number } {
  const p = E.p;
  const emergencia = p.ordenes.find((o: Any) => o.tipo === "emergencia" && ["abierta", "en_proceso"].includes(o.estado));
  if (emergencia) return { ordenId: emergencia.id, html: `<span class="etq">Emergencia abierta</span><h2>${esc(limpiarTitulo(emergencia.titulo))}</h2><p>Se trabaja en la ficha completa, con sus tres tiempos.</p><a class="b1 claro" href="/ordenes/${emergencia.id}?completa=1" data-fuera>Abrir la ficha</a>` };
  const r = p.ronda;
  const rondaPendiente = !!r && r.estado !== "completada";
  // La ronda es lo primero del turno. Una orden que ya venía de antes espera; si el
  // técnico la empezó en este mismo turno, sigue con ella y la ronda queda a la vista.
  const inicioTurno = r ? Date.parse(`${r.fecha}T${r.turno}:00-06:00`) : 0;
  const activa = enCurso();
  const activaDeEsteTurno = !!activa?.iniciadaEn && Date.parse(activa.iniciadaEn) >= inicioTurno;
  const vasAqui = (o: Any) => {
    const hechos = o.pasos.filter((x: Any) => x.estado !== "pendiente").length;
    const devuelta = o.devuelta ? `<p>Te la devolvieron: ${esc(o.devuelta)}</p>` : "";
    const tambien = rondaPendiente ? `<button class="b2" data-a="ronda">También falta la ronda de las ${esc(r.turno)}</button>` : "";
    return { ordenId: o.id, html: `<span class="etq">Vas aquí</span><h2>${esc(tituloOrden(o))}</h2><p>${o.pasos.length && hechos >= o.pasos.length ? "Todos los pasos están anotados; falta enviarla." : `${o.pasos.length ? `Paso ${hechos + 1} de ${o.pasos.length}. ` : ""}Sigues justo donde quedaste.`}</p>${devuelta}<button class="b1 claro" data-a="ir" data-h="#orden-${o.id}">Seguir</button>${tambien}` };
  };
  if (activa && (!rondaPendiente || activaDeEsteTurno)) return vasAqui(activa);
  if (!E.sede) return { html: `<span class="etq">Antes de empezar</span><h2>¿En qué sede estás hoy?</h2><p>La ronda y los equipos dependen de la sede.</p><button class="b1 claro" data-a="sede">Elegir sede</button>` };
  if (r && r.estado !== "completada") {
    const hechas = Object.keys(r.lecturas).length;
    if (r.estado === "sin_iniciar" && !hechas) return { html: `<span class="etq">Lo primero del turno</span><h2>Ronda de las ${esc(r.turno)}</h2><p>${r.puntos.length} paradas${r.minutos ? ` · ${duracion(r.minutos)} estimado` : ""}</p><button class="b1 claro" data-a="ronda">Empezar la ronda</button>` };
    return { html: `<span class="etq">Vas aquí</span><h2>Ronda de las ${esc(r.turno)}</h2><p>${hechas} de ${r.puntos.length} paradas. Sigues justo donde quedaste.</p><button class="b1 claro" data-a="ronda">Seguir la ronda</button>` };
  }
  const sig = siguienteOrden();
  if (sig) {
    const etq = sig.tipo === "preventivo" ? "Siguiente preventivo" : sig.tipo === "correctivo" ? "Siguiente correctivo" : "Siguiente orden";
    const det = [subOrden(sig), sig.pasos.length ? `${sig.pasos.length} pasos` : "", sig.estimadoMin ? `${duracion(sig.estimadoMin)} estimado` : ""].filter(Boolean).join(" · ");
    return { ordenId: sig.id, html: `<span class="etq">${etq}</span><h2>${esc(tituloOrden(sig))}</h2><p>${esc(det)}</p><button class="b1 claro" data-a="empezar" data-id="${sig.id}">${ico.play}Empezar</button>` };
  }
  return { html: `<span class="etq">Lista de hoy</span><h2>No tienes trabajo pendiente</h2><p>Si vas a atender un equipo que no estaba programado, búscalo por su ubicación.</p><a class="b1 claro" href="#buscar" data-a="ir" data-h="#buscar">${ico.lupa}Buscar equipo</a>` };
}

function filaOrden(o: Any) {
  const vence = o.vencimiento && o.vencimiento.slice(0, 10) < hoySV();
  const estado = o.estado === "en_espera" ? `En pausa${o.motivoPausa ? `: ${esc(o.motivoPausa)}` : ""}` : o.estado === "en_proceso" ? "En curso" : o.devuelta ? "Devuelta" : o.vencimiento ? `<span class="${vence ? "vence" : ""}">${vence ? "Vencida" : "Vence"} ${fecha(o.vencimiento)}</span>` : "";
  const sub = [esc(o.activo?.codigo ?? ""), estado].filter(Boolean).join(" · ");
  const aFicha = o.modo === "ficha";
  const attrs = aFicha ? `href="/ordenes/${o.id}?completa=1" data-fuera` : `href="#orden-${o.id}" data-a="ir" data-h="#orden-${o.id}"`;
  return `<a class="fila sub" ${attrs}><span class="marca"></span><span class="txt"><strong>${esc(tituloOrden(o))}</strong><small>${sub}</small></span>${ico.flecha}</a>`;
}

function grupoHtml(clave: string, titulo: string, cuenta: string, filas: string, abierto: string | null) {
  const open = abierto === clave;
  return `<button class="fila" data-a="grupo" data-g="${esc(clave)}" aria-expanded="${open}"><span class="txt"><strong>${esc(titulo)}</strong></span><span class="cuenta">${esc(cuenta)}</span>${open ? ico.abajo : ico.flecha}</button>${open ? filas : ""}`;
}

function vHoy() {
  rodarTurno();
  const p = E.p;
  if (!p) {
    if (E.cargando) return `<div class="simple"><p>Cargando tu día…</p></div>`;
    return `<div class="simple"><span class="etq">Sin datos todavía</span><h1>Necesitas señal la primera vez</h1><p>Cuando el celular cargue tu día una vez, podrás seguir trabajando aunque se vaya la señal.</p><button class="b1" data-a="reintentar">Intentar otra vez</button></div>`;
  }
  const ahora = bloqueAhora();
  const grupos = new Map<string, Any[]>();
  for (const o of p.ordenes) {
    if (o.id === ahora.ordenId) continue;
    const clave = o.lugar?.ubicacion || o.lugar?.sede || "Sin ubicación";
    grupos.set(clave, [...(grupos.get(clave) ?? []), o]);
  }
  const primero = [...grupos.keys()][0] ?? null;
  const abierto = E.grupo === "__ninguno" ? null : E.grupo ?? (primero && window.innerHeight >= 700 ? primero : null);
  let filas = "";
  for (const [clave, lista] of grupos) filas += grupoHtml(clave, clave, `${lista.length} por hacer`, lista.map(filaOrden).join(""), abierto);
  if (p.locales?.length) filas += grupoHtml("locales", "Guardadas en tu celular", `${p.locales.length} por enviar`, p.locales.map((l: Any) => `<div class="fila sub"><span class="marca"></span><span class="txt"><strong>${esc(l.titulo)}</strong><small>Se envía sola cuando vuelva la señal</small></span></div>`).join(""), abierto);
  if (p.desviaciones?.length) {
    filas += grupoHtml("aop", "Desviaciones abiertas", `${p.desviaciones.length} con reloj`, p.desviaciones.map((d: Any) => `<a class="fila sub" href="/aop/${d.id}" data-fuera><span class="txt"><strong>${esc(d.codigo ?? "AOP")}${d.sala ? ` · ${esc(d.sala)}` : ""}</strong><small>${d.escalarAntesDe ? `Escalar antes de las ${hora(d.escalarAntesDe)}` : esc(d.titulo ?? "")}</small></span>${ico.flecha}</a>`).join(""), abierto);
  }
  if (p.tickets?.length) filas += grupoHtml("tickets", "Reportes asignados", `${p.tickets.length} por atender`, p.tickets.map((t: Any) => `<a class="fila sub" href="/tickets/${t.id}" data-fuera><span class="txt"><strong>${esc(t.asunto)}</strong><small>${esc([t.solicitante, t.sede].filter(Boolean).join(" · "))}</small></span>${ico.flecha}</a>`).join(""), abierto);
  if (p.libres?.length) filas += grupoHtml("libres", "Sin asignar en esta sede", `${p.libres.length} para tomar`, p.libres.map(filaOrden).join(""), abierto);
  if (p.porVerificar?.length) filas += grupoHtml("verificar", "Por verificar", `${p.porVerificar.length} te tocan`, p.porVerificar.map((o: Any) => `<a class="fila sub" href="/ordenes/${o.id}?completa=1" data-fuera><span class="txt"><strong>${esc(limpiarTitulo(o.titulo))}</strong><small>${esc(etiquetaOT(o))}</small></span>${ico.flecha}</a>`).join(""), abierto);
  if (p.hechasHoy?.length) filas += grupoHtml("hechas", "Terminadas hoy", String(p.hechasHoy.length), p.hechasHoy.map((o: Any) => `<div class="fila sub"><span class="marca si">${ico.check}</span><span class="txt"><strong>${esc(limpiarTitulo(o.titulo))}</strong><small>${o.completadaEn ? hora(o.completadaEn) : ""}</small></span></div>`).join(""), abierto);

  const nombreSede = p.sedes?.find((s: Any) => s.id === E.sede)?.nombre;
  const fechaLarga = new Date().toLocaleDateString("es-SV", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
  const turno = p.ronda?.turno ? ` · turno ${esc(p.ronda.turno)}` : "";
  const avisos = (E.sesionVencida ? `<div class="avisito"><span>Tu sesión venció.${E.pend.length ? ` ${E.pend.length} registros esperan.` : ""}</span><a class="link" href="/login?next=/campo">Entrar</a></div>` : "")
    + (E.rechazos.length ? `<div class="avisito"><span>${E.rechazos.length} registro${E.rechazos.length === 1 ? "" : "s"} sin aceptar</span><button class="link" data-a="verRechazos">Ver por qué</button></div>` : "");
  return `<div class="hoy-cab"><div><span class="etq">${esc(fechaLarga)}${turno}</span><h1>Hola, ${esc(primerNombre(p.usuario?.nombre ?? NOMBRE))}</h1>${nombreSede ? `<button class="sede-btn" data-a="sede">${esc(nombreSede)}${ico.abajo}</button>` : ""}</div><span id="senal">${pillHtml()}</span></div>`
    + avisos
    + `<div class="ahora">${ahora.html}</div>`
    + (filas ? `<div class="resto"><span class="etq">Después</span><div class="lista">${filas}</div></div>` : "");
}

// ── Una orden ───────────────────────────────────────────────────────────────
function abrirOrden(id: number) {
  // Aún no carga el día: el arranque vuelve a pasar por aquí cuando llegue.
  if (!E.p) { E.vista = "hoy"; pintar(); return; }
  const o = ordenDe(id);
  if (!o) {
    E.vista = "hoy";
    if (!E.enLinea) { aviso("Esa orden no está en tu celular. Necesita señal."); pintar(); return; }
    void traerOrden(id);
    return;
  }
  if (o.modo === "ficha" || o.estado === "abierta") { E.flujo = null; E.vista = "inicio"; E.params = { id }; pintar(); return; }
  if (o.estado === "en_espera") { E.flujo = null; E.vista = "pausa"; E.params = { id }; pintar(); return; }
  const i = primerPendiente(o);
  E.flujo = { tipo: "pm", ordenId: id, i: i < 0 ? 0 : i };
  E.vista = i < 0 || !o.pasos.length ? "fin" : "paso";
  mantenerPantalla();
  pintar();
}
async function traerOrden(id: number) {
  try {
    const r = await fetch(`/api/campo/ordenes?id=${id}`);
    if (!r.ok) { location.href = `/ordenes/${id}?completa=1`; return; }
    const { orden }: Any = await r.json();
    const lista = orden.asignadoA === UID ? "ordenes" : "libres";
    E.base?.[lista]?.push(orden);
    rebase();
    abrirOrden(id);
  } catch {
    E.enLinea = false;
    aviso("Esa orden no está en tu celular. Necesita señal.");
    pintar();
  }
}

function vInicio() {
  const o = ordenDe(E.params.id);
  if (!o) return vHoy();
  const dets = [o.tipo === "preventivo" ? "Preventivo" : o.tipo === "correctivo" ? "Correctivo" : o.tipo === "intervencion" ? "Intervención" : o.tipo === "emergencia" ? "Emergencia" : o.tipo, o.vencimiento ? `vence ${fecha(o.vencimiento)}` : ""].filter(Boolean).join(" · ");
  const mats = [...new Set(o.pasos.map((p: Any) => p.materiales).filter(Boolean))] as string[];
  const cuerpo = o.modo === "ficha"
    ? `<p class="ayuda">Esta orden lleva permisos y lecturas de liberación. Se trabaja en la ficha completa.</p><div class="empuja"><a class="b1" href="/ordenes/${o.id}?completa=1" data-fuera>Abrir la ficha</a></div>`
    : `${o.descripcion ? `<div class="dato"><span class="etq">Lo que pidieron</span><b>${esc(o.descripcion)}</b></div>` : ""}`
      + `<div class="dato"><span class="etq">Trabajo</span><b>${o.pasos.length ? `${o.pasos.length} pasos` : "Sin lista de pasos"}${o.estimadoMin ? ` · ${duracion(o.estimadoMin)} estimado` : ""}</b></div>`
      + (mats.length ? `<div class="dato"><span class="etq">Lleva contigo</span><b>${esc(mats.join(" · "))}</b></div>` : "")
      + `<div class="empuja"><button class="b1" data-a="empezar" data-id="${o.id}">${ico.play}Empezar</button><a class="b2" href="#hoy" data-a="ir" data-h="#hoy">Volver a Hoy</a></div>`;
  return `<div class="final"><span class="etq">${esc(dets)}</span><h1>${esc(tituloOrden(o))}</h1><p class="ayuda">${esc([o.activo?.codigo, o.lugar?.ubicacion, o.lugar?.sede].filter(Boolean).join(" · "))}</p>${cuerpo}</div>`;
}

function vPausa() {
  const o = ordenDe(E.params.id);
  if (!o) return vHoy();
  return `<div class="final"><span class="etq">En pausa desde las ${o.pausadaEn ? hora(o.pausadaEn) : ""}</span><h1>${esc(tituloOrden(o))}</h1>`
    + (o.motivoPausa ? `<div class="dato"><span class="etq">Motivo</span><b>${esc(o.motivoPausa)}</b></div>` : "")
    + `<div class="dato"><span class="etq">Tiempo de trabajo hasta ahora</span><b>${relojTxt(efectivoMs(o))}</b></div>`
    + `<p class="ayuda">El tiempo en pausa no cuenta como tiempo de trabajo.</p>`
    + `<div class="empuja"><button class="b1" data-a="reanudar" data-id="${o.id}">${ico.play}Reanudar</button><a class="b2" href="#hoy" data-a="ir" data-h="#hoy">Volver a Hoy</a></div></div>`;
}

function lecturaHtml(p: Any, previo: unknown) {
  const rango = rangoDe(p);
  const u = p.unidad ? ` en ${esc(p.unidad)}` : "";
  return `<label class="etq" for="lectura">Lectura${u}</label>`
    + `<div class="lect-caja"><input id="lectura" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${esc(previo ?? "")}"><span>${esc(p.unidad ?? "")}</span></div>`
    + ((rango || p.ultima) ? `<div class="lect-info">${rango ? `<span>Normal: <b>${esc(rango)}</b></span>` : ""}${p.ultima ? `<span>Última vez: <b>${esc(p.ultima)}${p.unidad ? ` ${esc(p.unidad)}` : ""}</b></span>` : ""}</div>` : "")
    + `<div class="lect-estado" id="lect-estado" aria-live="polite"></div>`;
}

/** La línea 1 del SOP: lo que dejó el turno anterior y lo que sigue abierto en esta sede. */
function bitacoraHtml(r: Any) {
  const e = r.entregaAnterior;
  if (!E.enLinea && !e) return `<p class="ayuda">Sin señal: la entrega del turno anterior y las desviaciones llegan cuando vuelva.</p>`;
  const abiertas = E.p?.desviaciones?.length ?? 0;
  const dejo = e ? `Dejó ${esc(e.firma ?? "el turno anterior")} a las ${hora(e.en)}: ${esc(String(e.notas ?? "sin novedades").slice(0, 200))}` : "Sin entrega registrada.";
  return `<p class="ayuda">${dejo} ${abiertas ? `${abiertas} desviación${abiertas === 1 ? "" : "es"} abierta${abiertas === 1 ? "" : "s"} en esta sede.` : "Sin desviaciones abiertas en esta sede."}</p>`;
}

function vPaso() {
  const f = E.flujo;
  if (!f) return vHoy();
  const esRonda = f.tipo === "ronda";
  const o = esRonda ? null : ordenDe(f.ordenId as number);
  const r = esRonda ? E.p?.ronda : null;
  if (esRonda ? !r : !o) { E.flujo = null; E.vista = "hoy"; aviso("Esta orden ya no está en tu lista."); return vHoy(); }
  const lista: Any[] = esRonda ? r.puntos : o.pasos;
  const p = lista[f.i];
  const n = lista.length;
  const previo = esRonda ? r.lecturas[p.id] : p;
  const hecho = (k: number) => (esRonda ? !!r.lecturas[lista[k].id] : lista[k].estado !== "pendiente");
  const segs = lista.map((_, k) => `<i class="${k === f.i ? "a" : hecho(k) ? "h" : ""}"></i>`).join("");
  const texto = String(p.texto ?? "").replace(/ · /g, ": ");
  const entrega = esRonda && p.linea === 1 ? bitacoraHtml(r) : "";
  const ayuda = esRonda ? [p.ayuda, p.esperado ? `Debe verse: ${p.esperado}` : ""].filter(Boolean).join(" ") : p.criterio ?? "";
  const lect = p.pideValor ? lecturaHtml(p, esRonda ? previo?.valor : previo?.valor) : "";
  const materiales = !esRonda && p.materiales ? `<p class="ayuda">Materiales: ${esc(p.materiales)}</p>` : "";
  const nota = previo?.nota ? `<p class="ayuda">Anotaste: ${esc(previo.nota)}</p>` : "";
  let pie: string;
  if (!esRonda) {
    pie = (p.pideValor ? `<button class="b1" id="btn-lect" data-a="lectura">Guardar lectura</button>` : `<button class="b1" data-a="hecho">${ico.check}Hecho</button>`)
      + (p.critico ? `<button class="b2" data-a="problema">Hay un problema</button>` : `<div class="dos"><button class="b2" data-a="na">No aplica</button><button class="b2" data-a="problema">Hay un problema</button></div>`);
  } else {
    pie = p.pideValor
      ? `<button class="b1" id="btn-lect" data-a="lectura">Guardar lectura</button><div class="dos"><button class="b2" data-a="noconf">Hay una alarma</button><button class="b2" data-a="noverif">No pude verificar</button></div>`
      : `<button class="b1" data-a="conforme">${ico.check}Conforme</button><div class="dos"><button class="b2" data-a="noconf">No conforme</button><button class="b2" data-a="noverif">No pude verificar</button></div>`;
  }
  const titulo = esRonda ? `Ronda de las ${r.turno}` : o.activo?.codigo ?? tituloOrden(o);
  const sub = esRonda ? (p.sistema === "otro" ? "" : SISTEMAS[p.sistema] ?? r.nombre) : o.activo ? o.activo.nombre : o.lugar?.ubicacion ?? "";
  const pausa = esRonda ? "" : `<button class="ic" data-a="pausar" aria-label="Pausar el trabajo">${ico.pausa}</button>`;
  return `<div class="paso"><div class="paso-cab"><button class="ic" data-a="salir" aria-label="Volver a Hoy">${ico.x}</button>`
    + `<div class="paso-tit"><strong>${esc(titulo)}</strong><span>${esc(sub)}</span></div>${pausa}`
    + `<div class="paso-der"><span class="reloj" id="reloj"></span><span id="senal">${pillHtml()}</span></div></div>`
    + `<div class="segs">${segs}</div>`
    + `<div class="paso-cuerpo" data-k="${f.i}"><div class="paso-meta"><span class="etq">${esRonda ? "Parada" : "Paso"} ${f.i + 1} de ${n}</span>`
    + `${p.critico ? '<span class="critico">CRÍTICO</span>' : ""}${!esRonda && p.minutos ? `<span class="min">≈ ${p.minutos} min</span>` : ""}</div>`
    + `<h1 class="${texto.length > 70 ? "largo" : ""}">${esc(texto)}</h1>${entrega}${ayuda ? `<p class="ayuda">${esc(ayuda)}</p>` : ""}${materiales}${lect}${nota}`
    + `${f.i > 0 ? `<button class="link" data-a="anterior" style="align-self:flex-start">Volver al paso anterior</button>` : ""}</div>`
    + `<div class="paso-pie">${pie}</div></div>`;
}

function evaluarLectura() {
  const l = $<HTMLInputElement>("#lectura");
  const s = $("#lect-estado");
  const b = $("#btn-lect");
  const f = E.flujo;
  if (!l || !s || !b || !f) return;
  const lista: Any[] = f.tipo === "ronda" ? E.p.ronda.puntos : ordenDe(f.ordenId as number).pasos;
  const p = lista[f.i];
  const v = num(l.value);
  const hayRango = p.min != null || p.max != null;
  if (v == null || !hayRango) { s.textContent = ""; s.className = "lect-estado"; b.textContent = "Guardar lectura"; return; }
  const mal = fueraDe(p, v);
  s.textContent = mal ? "Fuera de rango" : "Dentro de rango";
  s.className = `lect-estado ${mal ? "mal" : "bien"}`;
  b.textContent = mal ? "Registrar fuera de rango" : "Guardar lectura";
}

function avanzar() {
  const f = E.flujo;
  if (!f) return;
  E.hoja = null;
  if (f.tipo === "ronda") {
    const r = E.p.ronda;
    let sig = -1;
    for (let k = f.i + 1; k < r.puntos.length; k++) if (!r.lecturas[r.puntos[k].id]) { sig = k; break; }
    if (sig < 0) sig = rondaFaltante(r);
    if (sig < 0) E.vista = "fin"; else { f.i = sig; E.vista = "paso"; }
  } else {
    const o = ordenDe(f.ordenId as number);
    let sig = -1;
    for (let k = f.i + 1; k < o.pasos.length; k++) if (o.pasos[k].estado === "pendiente") { sig = k; break; }
    if (sig < 0) sig = primerPendiente(o);
    if (sig < 0) E.vista = "fin"; else { f.i = sig; E.vista = "paso"; }
  }
  soltarHistorialDeHoja();
  pintar();
}

function marcarPaso(estado: string, extra: Record<string, unknown> = {}) {
  const f = E.flujo as Flujo;
  const o = ordenDe(f.ordenId as number);
  const p = o.pasos[f.i];
  void despachar({ tipo: "orden.paso", ordenId: o.id, idx: f.i, texto: p.texto, estado, ...extra });
  zumbar();
  avanzar();
}
function marcarParada(resultado: string, extra: Record<string, unknown> = {}, at?: string) {
  const r = E.p.ronda;
  const f = E.flujo as Flujo;
  void despachar({ tipo: "ronda.lectura", rondaId: r.rondaId, sucursalId: r.sucursalId, fecha: r.fecha, turno: r.turno, puntoId: r.puntos[f.i].id, resultado, ...extra }, at);
  zumbar();
}

function guardarLectura() {
  const f = E.flujo as Flujo;
  const l = $<HTMLInputElement>("#lectura");
  if (!l) return;
  const v = num(l.value);
  if (f.tipo === "ronda") {
    const r = E.p.ronda;
    const pt = r.puntos[f.i];
    if (v == null) { aviso("Escribe la lectura para seguir."); l.focus(); return; }
    if (!fueraDe(pt, v)) { marcarParada("ok", { valor: v }); avanzar(); return; }
    abrirHoja({ tipo: "novedad", valor: v, at: new Date().toISOString(), opcional: true, foco: false, valorTxt: `Lectura ${v}${pt.unidad ? ` ${pt.unidad}` : ""} · normal ${rangoDe(pt)}` });
    return;
  }
  const p = ordenDe(f.ordenId as number).pasos[f.i];
  const crudo = l.value.trim();
  const hayRango = p.min != null || p.max != null;
  if (v == null && (hayRango || !crudo)) { aviso("Escribe la lectura para seguir."); l.focus(); return; }
  if (v == null || !fueraDe(p, v)) { marcarPaso("ok", { valor: v ?? crudo }); return; }
  abrirHoja({ tipo: "problema", valor: String(v), valorTxt: `Lectura ${v}${p.unidad ? ` ${p.unidad}` : ""} · normal ${rangoDe(p)}` });
}

function abrirHojaDeDesviacion(pt: Any, valorTxt: string, at: string, nota: string) {
  const doc = pt.aop ? E.p.ronda.docs?.[pt.aop] : null;
  if (!doc) {
    if (pt.pideOrden) { abrirHoja({ tipo: "pideOrden", valorTxt, nota }); return; }
    aviso("Anotado. Este punto todavía no tiene un AOP que lo rija."); avanzar(); return;
  }
  // El reloj de la parada manda sobre el del documento cuando la guía distingue condiciones.
  abrirHoja({ tipo: "aop", doc: { ...doc, actuarMin: pt.actuarMin ?? doc.actuarMin, escalarMin: pt.escalarMin ?? doc.escalarMin }, valorTxt, seguir: true, at, nota, pideOrden: !!pt.pideOrden });
}
/** «Actuar antes de las 08:12» desde la hora capturada; un plazo de un día o más se dice en horas. */
const limite = (at: string | undefined, m: number | null | undefined) => (m == null ? "Sin plazo" : !at || m >= 720 ? plazo(m) : hora(Date.parse(at) + m * 60000));
const origenRonda = () => {
  if (E.flujo?.tipo !== "ronda") return {};
  const r = E.p.ronda;
  return { fecha: r.fecha, turno: r.turno, puntoId: r.puntos[(E.flujo as Flujo).i].id };
};

// ── Fin ─────────────────────────────────────────────────────────────────────
function trabajosEscritos(o: Any) {
  const pasos = o.pasos;
  if (!pasos.length) return "";
  const limpio = limpiarTitulo(o.titulo).replace(/\s+-\s+\S+$/, "").trim() || "Mantenimiento";
  const ok = pasos.filter((p: Any) => p.estado === "ok").length;
  const na = pasos.filter((p: Any) => p.estado === "na").length;
  const nov = pasos.filter((p: Any) => p.estado === "desviacion").length;
  const lect = pasos.filter((p: Any) => p.valor).map((p: Any) => `${p.texto}: ${p.valor}${p.unidad ? ` ${p.unidad}` : ""}`);
  return `${limpio}: ${ok + nov} de ${pasos.length} puntos realizados${nov ? `, ${nov} con novedad` : " sin novedad"}${na ? `, ${na} no aplica` : ""}.${lect.length ? ` Lecturas: ${lect.join("; ")}.` : ""}`;
}
function fotoCampo(id: string, texto: string, categoria: string) {
  return `<label class="b2" for="${id}">${ico.camara}${esc(texto)}</label><input class="oculto" type="file" accept="image/*" capture="environment" id="${id}" data-foto="${categoria}"><div class="foto-res" id="foto-res"></div>`;
}
function vFinRonda() {
  const r = E.p.ronda;
  const lect = r.puntos.map((pt: Any) => ({ pt, l: r.lecturas[pt.id] })).filter((x: Any) => x.l);
  const nov = lect.filter((x: Any) => x.l.resultado === "no_verificado");
  const fuera = lect.filter((x: Any) => x.l.resultado === "fuera");
  const lecturas = lect.filter((x: Any) => x.l.valor != null).map((x: Any) => `${x.pt.texto}: ${x.l.valor}${x.pt.unidad ? ` ${x.pt.unidad}` : ""}`);
  // La entrega de turno ya viene escrita con lo que quedó abierto; el técnico solo la ajusta.
  const clave = `entrega:${r.fecha}:${r.turno}`;
  const nombres = (l: Any[]) => l.map((x: Any) => String(x.pt.texto).split(" · ")[0]).join(", ");
  const sugerida = [fuera.length ? `Quedan abiertas: ${nombres(fuera)}.` : "", nov.length ? `Sin verificar: ${nombres(nov)}.` : ""].filter(Boolean).join(" ");
  const entrega = E.notas[clave] ?? sugerida;
  const conReloj = fuera.filter((x: Any) => x.pt.aop).length;
  return `<div class="final"><span class="etq">Ronda de las ${esc(r.turno)}</span><h1>${lect.length - nov.length} de ${r.puntos.length} paradas verificadas</h1>`
    + `<div class="dato"><span class="etq">Desviaciones abiertas</span><b>${fuera.length ? `${conReloj ? `${conReloj} con su reloj corriendo. ` : `${fuera.length} sin reloj. `}${E.enLinea ? "Tu jefatura ya las ve." : "Tu jefatura las ve cuando vuelva la señal."}` : "Ninguna"}</b></div>`
    + (nov.length ? `<div class="dato"><span class="etq">Sin verificar</span><b>${nov.length}, con su razón escrita.</b></div>` : "")
    + (lecturas.length ? `<div class="dato solo-alto"><span class="etq">Lecturas</span><b>${esc(lecturas.slice(0, 4).join(" · "))}${lecturas.length > 4 ? ` y ${lecturas.length - 4} más` : ""}</b></div>` : "")
    + `<div class="dato"><span class="etq">Quién y cuándo</span><b>${esc(primerNombre(NOMBRE))} · ${r.iniciadaEn ? `${hora(r.iniciadaEn)} a ` : ""}${hora(Date.now())}</b></div>`
    + `<label class="etq" for="entrega">Novedades para quien entra</label><textarea id="entrega" data-nota="${esc(clave)}" placeholder="Si no hay, déjalo en blanco.">${esc(entrega)}</textarea><p class="err" id="err-entrega" hidden>Hay novedades abiertas: escribe qué le dejas a quien entra.</p>`
    + `<div class="empuja"><button class="b1" data-a="cerrarRonda">Firmar y cerrar la ronda</button><button class="link" data-a="anterior" style="justify-content:center">Volver a la última parada</button></div></div>`;
}
function vFin() {
  const f = E.flujo;
  if (!f) return vHoy();
  if (f.tipo === "ronda") return E.p?.ronda ? vFinRonda() : vHoy();
  const o = ordenDe(f.ordenId as number);
  if (!o) { E.flujo = null; E.vista = "hoy"; return vHoy(); }
  const n = o.pasos.length;
  const pendientes = o.pasos.filter((p: Any) => p.estado === "pendiente");
  if (pendientes.length) {
    return `<div class="final"><span class="etq">${esc(tituloOrden(o))}</span><h1>Faltan ${pendientes.length} paso${pendientes.length === 1 ? "" : "s"}</h1><div class="empuja"><button class="b1" data-a="irPaso" data-i="${primerPendiente(o)}">Ir al paso pendiente</button></div></div>`;
  }
  const criticos = o.pasos.map((p: Any, i: number) => ({ p, i })).filter(({ p }: Any) => p.estado === "desviacion" && p.critico);
  if (criticos.length) {
    return `<div class="final"><span class="etq">${esc(tituloOrden(o))}</span><h1>Un punto crítico quedó con problema</h1>`
      + `<p class="ayuda">Mientras siga así, la orden no se puede enviar a verificación. Corrígelo o déjala en espera y avisa a tu jefatura.</p>`
      + criticos.map(({ p, i }: Any) => `<div class="dato"><span class="etq">${esc(p.texto)}</span><b>${esc(p.nota ?? "")}</b><button class="link" data-a="irPaso" data-i="${i}">Corregir este paso</button></div>`).join("")
      + `<div class="empuja"><button class="b1" data-a="pausar">Dejar en espera</button><button class="b2" data-a="abrirCorrectivoDesdeFin">Abrir correctivo</button></div></div>`;
  }
  const clave = `fin:${o.id}`;
  const nota = E.notas[clave] ?? "";
  const causa = E.notas[`causa:${o.id}`] ?? o.causaRaiz ?? "";
  const texto = trabajosEscritos(o);
  const inicio = o.iniciadaEn ? hora(o.iniciadaEn) : "";
  const mostrarNota = !n || E.verNota || nota;
  return `<div class="final"><span class="etq">${esc([o.activo?.codigo, tituloOrden(o)].filter(Boolean).join(" · "))}</span>`
    + `<h1>${n ? `${n} de ${n} pasos anotados` : "¿Qué hiciste?"}</h1>`
    + (o.devuelta ? `<div class="dato"><span class="etq">Te la devolvieron</span><b>${esc(o.devuelta)}</b></div>` : "")
    + (texto ? `<div class="dato"><span class="etq">Trabajos realizados, escritos solos</span><b>${esc(texto)}</b></div>` : "")
    + `<div class="dato"><span class="etq">Quién y cuánto duró</span><b>${esc(primerNombre(NOMBRE))} · ${inicio} a <span id="fin-hora">${hora(Date.now())}</span> · <span id="reloj"></span> de trabajo</b></div>`
    + (mostrarNota
      ? `<label class="etq" for="nota-fin">${n ? "Algo más que anotar" : "Trabajos realizados"}</label><textarea id="nota-fin" data-nota="${clave}" placeholder="Usa el micrófono del teclado para dictarlo.">${esc(nota)}</textarea>`
      : `<button class="link" data-a="verNota" style="align-self:flex-start">Agregar una nota</button>`)
    + (o.pideCausaRaiz ? `<label class="etq" for="causa-fin">Causa raíz (mínimo ${o.minCausaRaiz ?? 20} letras)</label><textarea id="causa-fin" data-nota="causa:${o.id}">${esc(causa)}</textarea>` : "")
    + fotoCampo("foto-final", o.fotos ? `Otra foto (${o.fotos} guardada${o.fotos === 1 ? "" : "s"})` : "Foto final (opcional)", "despues")
    + `<p class="err" id="err-fin" hidden></p>`
    + `<div class="empuja"><button class="b1" data-a="enviar">Enviar a verificación</button>${n ? `<button class="link" data-a="anterior" style="justify-content:center">Revisar los pasos</button>` : `<a class="link" href="#hoy" data-a="ir" data-h="#hoy" style="justify-content:center">Volver a Hoy</a>`}</div></div>`;
}
function vListo() {
  const u = E.listo;
  if (!u) return vHoy();
  const sig = siguienteOrden(u.lugar);
  return `<div class="final"><span class="etq">${esc(u.titulo)}</span><h1>${u.sinEnviar ? "Guardado en tu celular" : "Enviado a verificación"}</h1>`
    + `<p class="ayuda">${u.sinEnviar ? "Se envía solo cuando vuelva la señal, con la hora en que lo hiciste. Puedes seguir." : "Otra persona lo verifica. Tú ya puedes seguir."}</p>`
    + `<div class="dato"><span class="etq">Tiempo registrado</span><b>${esc(u.inicio)} a ${esc(u.fin)} · ${esc(u.efectivo)} de trabajo${u.pausa ? ` · ${esc(u.pausa)} en pausa` : ""}</b></div>`
    + `<div class="empuja">${sig ? `<button class="b1" data-a="empezar" data-id="${sig.id}">${ico.play}Siguiente: ${esc(tituloOrden(sig))}</button>` : ""}<a class="b2" href="#hoy" data-a="ir" data-h="#hoy">Ver mi día</a></div></div>`;
}

// ── Buscar equipo: sede → ubicación → equipo ────────────────────────────────
async function traer(url: string, clave: string) {
  try {
    const r = await fetch(url);
    if (r.status === 401) { E.sesionVencida = true; throw new Error("Tu sesión venció. Entra de nuevo."); }
    const j: Any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "No se pudo cargar.");
    void cola.guardar(clave, j);
    E.enLinea = true;
    return { datos: j, copia: false };
  } catch (e: Any) {
    if (!(e instanceof TypeError)) throw e;
    E.enLinea = false;
    const copia = await cola.leer<Any>(clave);
    if (copia) return { datos: copia, copia: true };
    throw new Error("Buscar un equipo necesita señal la primera vez.");
  }
}
async function cargarUbicaciones() {
  const b = E.b;
  if (!E.sede) return;
  b.ubicaciones = null; b.error = "";
  pintarSiVista(["buscar", "reportarLugar"]);
  try {
    const r = await traer(`/api/campo/buscar?sede=${E.sede}`, `ub:${E.sede}`);
    b.ubicaciones = r.datos.ubicaciones; b.sinUbicacion = r.datos.sinUbicacion ?? 0; b.copia = r.copia;
  } catch (e: Any) { b.error = e.message; }
  pintarSiVista(["buscar", "reportarLugar"]);
}
async function cargarEquipos(ub: string) {
  const b = E.b;
  b.equipos = null; b.error = ""; b.ubId = ub;
  try {
    const r = await traer(`/api/campo/buscar?ubicacion=${ub}`, `eq:${ub}`);
    b.equipos = r.datos.equipos; b.copia = r.copia;
  } catch (e: Any) { b.error = e.message; }
  pintarSiVista(["equipos"]);
}
async function cargarFicha(id: number) {
  const b = E.b;
  b.ficha = null; b.error = "";
  try {
    const r = await traer(`/api/campo/equipo/${id}`, `ficha:${id}`);
    b.ficha = r.datos; b.copia = r.copia;
  } catch (e: Any) { b.error = e.message; }
  pintarSiVista(["equipo", "falla"]);
}
const pintarSiVista = (v: string[]) => { if (v.includes(E.vista) && !E.hoja) pintar({ conservar: true }); };
const filtroHtml = (n: number, texto: string) => (n > 6 ? `<label class="oculto" for="filtro">${esc(texto)}</label><input class="campo" id="filtro" type="search" placeholder="${esc(texto)}" autocomplete="off">` : "");
const estadoCarga = (lista: unknown) => (E.b.error ? `<p class="err">${esc(E.b.error)}</p><button class="b2" data-a="recargarBusqueda">Intentar otra vez</button>` : !lista ? `<p>Cargando…</p>` : "");
const avisoCopia = () => (E.b.copia ? `<p class="ayuda">Sin señal: esta es la lista guardada en tu celular.</p>` : "");

function vBuscar() {
  const modo = E.b.modo;
  const titulo = modo === "reportar" ? "Reportar una falla" : "Buscar equipo";
  const base = modo === "reportar" ? "#reportar/" : "#buscar/";
  const sedeTxt = E.p?.sedes?.find((s: Any) => s.id === E.sede)?.nombre;
  if (!E.sede) {
    return `<div class="simple"><span class="etq">${titulo}</span><h1>¿En qué sede está el equipo?</h1></div><div class="lista">`
      + (E.p?.sedes ?? []).map((s: Any) => `<button class="fila" data-a="elegirSede" data-id="${s.id}"><span class="txt"><strong>${esc(s.nombre)}</strong></span>${ico.flecha}</button>`).join("") + `</div>`;
  }
  const u = E.b.ubicaciones;
  let filas = "";
  if (u) {
    filas = u.map((x: Any) => `<a class="fila" href="${base}${x.id}" data-a="ir" data-h="${base}${x.id}" data-q="${esc(x.nombre.toLowerCase())}"><span class="txt"><strong>${esc(x.nombre)}</strong></span><span class="cuenta">${x.equipos} equipo${x.equipos === 1 ? "" : "s"}</span>${ico.flecha}</a>`).join("");
    if (E.b.sinUbicacion) filas += `<a class="fila" href="${base}sin" data-a="ir" data-h="${base}sin" data-q="sin ubicacion"><span class="txt"><strong>Equipos sin ubicación</strong><small>Todavía no se les asigna lugar</small></span><span class="cuenta">${E.b.sinUbicacion}</span>${ico.flecha}</a>`;
  }
  const vacio = u && !filas ? `<p class="ayuda">Esta sede todavía no tiene ubicaciones registradas. Pídele a tu jefatura que las cree.</p>` : "";
  return `<div class="simple"><span class="etq">${titulo}</span><h1>¿En qué ubicación está?</h1><button class="sede-btn" data-a="sede">${esc(sedeTxt ?? "Elegir sede")}${ico.abajo}</button>${estadoCarga(u)}${avisoCopia()}${vacio}${filtroHtml(u?.length ?? 0, "Filtrar ubicaciones")}</div>${filas ? `<div class="lista">${filas}</div>` : ""}`;
}
function vEquipos() {
  const modo = E.b.modo;
  const eq = E.b.equipos;
  const destino = modo === "reportar" ? "#falla/" : "#equipo/";
  const volver = modo === "reportar" ? "#reportar/lugar" : "#buscar";
  const hoy = hoySV();
  const filas = (eq ?? []).map((e: Any) => {
    const det = [e.codigo, e.proxima ? `${e.proxima < hoy ? "Vencido" : "Próximo"} ${fecha(e.proxima)}` : "", e.abiertas ? `${e.abiertas} abierta${e.abiertas === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
    return `<a class="fila" href="${destino}${e.id}" data-a="ir" data-h="${destino}${e.id}" data-q="${esc(`${e.nombre} ${e.codigo} ${e.marca ?? ""} ${e.modelo ?? ""}`.toLowerCase())}"><span class="txt"><strong>${esc(e.nombre)}</strong><small>${esc(det)}</small></span>${ico.flecha}</a>`;
  }).join("");
  const vacio = eq && !eq.length ? `<p class="ayuda">No hay equipos registrados en esta ubicación.</p>` : "";
  return `<div class="simple"><span class="etq">${modo === "reportar" ? "¿Qué equipo falló?" : "Selecciona el equipo"}</span><h1>${esc(E.b.ubNombre || "Equipos")}</h1><a class="link" href="${volver}" data-a="ir" data-h="${volver}">Cambiar de ubicación</a>${estadoCarga(eq)}${avisoCopia()}${vacio}${filtroHtml(eq?.length ?? 0, "Filtrar equipos")}</div>${filas ? `<div class="lista">${filas}</div>` : ""}`;
}
function cabEquipo(a: Any) {
  return `<span class="etq">${esc(a.codigo)}</span><h1>${esc(a.nombre)}</h1><p>${esc([[a.marca, a.modelo].filter(Boolean).join(" "), a.ubicacion, a.sede].filter(Boolean).join(" · "))}</p>`;
}
function vEquipo() {
  const fi = E.b.ficha;
  if (!fi) return `<div class="simple"><span class="etq">Equipo</span>${estadoCarga(null)}</div>`;
  const a = fi.activo;
  const hoy = hoySV();
  const abiertas = fi.abiertas.map((o: Any) => {
    const det = o.mia ? "Tuya" : o.libre ? "Sin asignar" : `Asignada a ${o.asignado ?? "otra persona"}`;
    const puede = o.mia || o.libre;
    return puede
      ? `<a class="fila" href="#orden-${o.id}" data-a="ir" data-h="#orden-${o.id}"><span class="txt"><strong>${esc(limpiarTitulo(o.titulo))}</strong><small>${esc(det)}</small></span>${ico.flecha}</a>`
      : `<div class="fila"><span class="txt"><strong>${esc(limpiarTitulo(o.titulo))}</strong><small>${esc(det)}</small></span></div>`;
  }).join("");
  const planes = fi.planes.map((p: Any) => {
    const det = [p.frecuencia, p.proxima ? `${p.proxima < hoy ? "vencido" : "próximo"} ${fecha(p.proxima)}` : "", p.pasos ? `${p.pasos} pasos` : "", p.estimadoMin ? duracion(p.estimadoMin) : ""].filter(Boolean).join(" · ");
    return `<button class="fila" data-a="confirmarPlan" data-id="${p.id}"><span class="txt"><strong>${esc(p.titulo)}</strong><small>${esc(det)}</small></span>${ico.flecha}</button>`;
  }).join("");
  return `<div class="simple">${cabEquipo(a)}${avisoCopia()}</div>`
    + (abiertas ? `<div class="resto"><span class="etq">Órdenes abiertas</span><div class="lista">${abiertas}</div></div>` : "")
    + (planes ? `<div class="resto"><span class="etq">Sus planes de mantenimiento</span><div class="lista">${planes}</div></div>` : "")
    + `<div class="bloque-cierre"><button class="${planes ? "b2" : "b1"}" data-a="noProgramado">Mantenimiento no programado</button><a class="b2" href="#falla/${a.id}" data-a="ir" data-h="#falla/${a.id}">Reportar una falla de este equipo</a></div>`;
}
function vFalla() {
  const fi = E.b.ficha;
  if (!fi) return `<div class="simple"><span class="etq">Reportar una falla</span>${estadoCarga(null)}</div>`;
  return `<div class="simple">${cabEquipo(fi.activo)}${avisoCopia()}</div><div class="bloque-cierre"><button class="b1 alerta" data-a="yaFallo">Ya falló</button><button class="b2" data-a="fueraDeRango">Funciona, pero un valor está fuera de rango</button><a class="link" href="#reportar" data-a="ir" data-h="#reportar" style="justify-content:center">Cancelar</a></div>`;
}
function vReportar() {
  const eops = E.p?.emergencias ?? [];
  const filas = eops.map((d: Any) => `<button class="fila" data-a="verEop" data-c="${esc(d.codigo)}"><span class="txt"><strong>${esc(d.titulo)}</strong><small>${esc(d.codigo)}</small></span>${ico.flecha}</button>`).join("");
  return `<div class="simple"><span class="etq">Reportar una falla</span><h1>¿Qué falló?</h1><a class="b1" href="#reportar/lugar" data-a="ir" data-h="#reportar/lugar">${ico.lupa}Un equipo</a><button class="b2" data-a="otraFalla">Otra cosa que no es un equipo</button></div>`
    + (filas ? `<div class="resto"><span class="etq">Emergencia de un sistema: abre el documento</span><div class="lista">${filas}</div></div>` : "");
}
function vAyuda() {
  const instalar = E.instalar ? `<button class="b2" data-a="instalar">Instalar en este celular</button>` : "";
  const enIphone = /iP(hone|ad|od)/.test(navigator.userAgent) && !(navigator as Any).standalone;
  return `<div class="simple"><span class="etq">Ayuda</span><h1>Cómo se usa, en un minuto</h1>`
    + `<ol class="acc"><li><span>Al entrar de turno, haz la ronda. Es lo primero que aparece.</span></li>`
    + `<li><span>Frente al equipo, toca Empezar. Eso abre el preventivo y arranca el cronómetro.</span></li>`
    + `<li><span>Toca Hecho al terminar cada paso. Solo escribes si hay un problema.</span></li>`
    + `<li><span>Si te interrumpen, toca Pausar. El tiempo en pausa no cuenta como trabajo.</span></li>`
    + `<li><span>Si se va la señal, sigue. Todo se guarda en el celular con su hora y se envía solo.</span></li>`
    + `<li><span>Para un equipo que no está en tu lista, usa Buscar equipo: sede, ubicación y equipo.</span></li>`
    + `<li><span>Si algo falla, Reportar falla te dice qué documento manda y qué hacer primero.</span></li></ol>`
    + instalar
    + (enIphone ? `<p>En iPhone, para tenerlo como aplicación: botón Compartir de Safari y luego Agregar a inicio.</p>` : "")
    + `<a class="b2" href="/perfil" data-fuera>Mi perfil y contraseña</a>`
    + (ROL !== "tecnico" ? `<a class="b2" href="/" data-fuera>Volver a la vista de jefatura</a>` : "")
    + `<button class="b2" data-a="salirSesion">Cerrar sesión</button></div>`;
}

// ── Hojas ───────────────────────────────────────────────────────────────────
function vHoja() {
  const h = E.hoja;
  const f = E.flujo;
  switch (h.tipo) {
    case "sede":
      return `<div class="hoja-caja"><span class="etq">Sede</span><h2>¿En qué sede estás hoy?</h2><div class="lista">${(E.p?.sedes ?? []).map((s: Any) => `<button class="fila" data-a="elegirSede" data-id="${s.id}"><span class="txt"><strong>${esc(s.nombre)}</strong></span>${s.id === E.sede ? ico.check : ico.flecha}</button>`).join("")}</div><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    case "sync": {
      const n = E.pend.length;
      const fotos = E.pend.filter((o) => o.tipo === "foto").length;
      return `<div class="hoja-caja"><span class="etq">Señal</span><h2>${n ? `${n} registro${n === 1 ? "" : "s"} por enviar` : "Todo está enviado"}</h2>`
        + `<p class="ayuda">${n ? `${fotos ? `Incluye ${fotos} foto${fotos === 1 ? "" : "s"}. ` : ""}Se envían solos cuando hay señal, con la hora en que los hiciste.` : "Lo que hagas se guarda primero en el celular y se envía de inmediato."}</p>`
        + (n ? `<button class="b1" data-a="enviarAhora">Enviar ahora</button>` : "")
        + (E.sesionVencida ? `<a class="b2" href="/login?next=/campo">Volver a entrar</a>` : "")
        + `<button class="link" data-a="cerrarHoja">Cerrar</button></div>`;
    }
    case "rechazos":
      return `<div class="hoja-caja"><span class="etq">Sin aceptar</span><h2>El servidor no aceptó estos registros</h2><p class="ayuda">Tu jefatura puede verlos. Si hace falta, repite el trabajo o pide ayuda.</p>`
        + `<div class="lista">${E.rechazos.slice(-12).map((r) => `<div class="fila"><span class="txt"><strong>${esc(r.que)}</strong><small>${esc(r.error)}</small></span></div>`).join("")}</div>`
        + `<button class="b1" data-a="limpiarRechazos">Entendido</button></div>`;
    case "pausar": {
      const motivos = ["Falta repuesto", "Esperando autorización", "El área está ocupada", "Me pasaron a otra urgencia"];
      return `<div class="hoja-caja"><span class="etq">Pausar el trabajo</span><h2>¿Por qué se detiene?</h2><div class="chips">${motivos.map((m) => `<button class="chip" data-a="motivoPausa" data-m="${esc(m)}">${esc(m)}</button>`).join("")}</div>`
        + `<label class="oculto" for="nota-pausa">Otro motivo</label><textarea id="nota-pausa" placeholder="Otro motivo"></textarea><p class="err" id="err-pausa" hidden>Toca un motivo o escríbelo.</p>`
        + `<button class="b1" data-a="confirmarPausa">Pausar</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "otraActiva": {
      const a = ordenDe(h.activaId);
      return `<div class="hoja-caja"><span class="etq">Ya tienes una orden en curso</span><h2>${esc(a ? tituloOrden(a) : "")}</h2><p class="ayuda">Para que el tiempo quede bien, solo una corre a la vez.</p>`
        + `<button class="b1" data-a="pausarYEmpezar" data-id="${h.id}" data-activa="${h.activaId}">Pausar esa y empezar esta</button>`
        + `<button class="b2" data-a="ir" data-h="#orden-${h.activaId}">Seguir con la que llevaba</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "problema": {
      const p = ordenDe(f?.ordenId as number)?.pasos[f?.i as number];
      return `<div class="hoja-caja"><span class="etq">${esc(p?.texto ?? "")}</span><h2>¿Qué encontraste?</h2>`
        + (h.valorTxt ? `<p class="err">${esc(h.valorTxt)}</p>` : "")
        + `<label class="oculto" for="nota-problema">Describe lo que encontraste</label><textarea id="nota-problema" placeholder="Usa el micrófono del teclado para dictarlo."></textarea>`
        + `<p class="err" id="err-problema" hidden>Describe en pocas palabras qué encontraste (al menos 10 letras).</p>`
        + fotoCampo("foto-problema", "Tomar foto", "general")
        + (p?.critico ? `<button class="b1" data-a="problemaDetener">Anotar y dejar en espera</button>` : `<button class="b1" data-a="problemaSeguir">Anotar y seguir</button>`)
        + `<button class="b2" data-a="problemaCorrectivo">El equipo no vuelve a servicio: abrir correctivo</button>`
        + `<button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "aop": {
      const d = h.doc;
      return `<div class="hoja-caja"><span class="etq">${esc(h.valorTxt || "Fuera de lo normal")}</span><h2>Se rige por <span class="codigo">${esc(d.codigo)}</span></h2><p class="ayuda">${esc(d.titulo)}</p>${d.aviso ? `<p class="ayuda">${esc(d.aviso)}</p>` : ""}`
        + `<div class="relojes"><div><span class="etq">Actuar antes de</span><b>${limite(h.at, d.actuarMin)}</b></div><div><span class="etq">Escalar antes de</span><b>${limite(h.at, d.escalarMin)}</b></div></div>`
        + (d.acciones?.length ? `<ol class="acc">${d.acciones.map((a: string) => `<li><span>${esc(a)}</span></li>`).join("")}</ol>` : "")
        + (h.seguir ? `<p class="ayuda solo-alto">${E.enLinea ? "La desviación ya quedó abierta y tu jefatura la ve con su reloj." : "Su reloj ya corre desde esta hora. Tu jefatura la ve cuando vuelva la señal."}</p>` : "")
        + (h.seguir
          ? `<button class="b1" data-a="aopSeguir">Seguir con la ronda</button>`
          : `<label class="etq" for="valor-desv">Valor medido (opcional)</label><div class="lect-caja mini"><input id="valor-desv" inputmode="decimal" autocomplete="off"></div><label class="oculto" for="nota-desv">Qué viste</label><textarea id="nota-desv" placeholder="Qué viste"></textarea><button class="b1" data-a="abrirDesviacion">Abrir la desviación</button>`)
        + (h.pideOrden ? `<button class="b2" data-a="correctivoDeParada">Abrir la orden correctiva</button>` : "")
        + (d.eop ? `<button class="b2" data-a="aEop">Ya falló: pasar a emergencia</button>` : "")
        + (h.seguir ? "" : `<button class="link" data-a="cerrarHoja">Cancelar</button>`)
        + `</div>`;
    }
    case "eop": {
      const d = h.doc;
      return `<div class="hoja-caja"><span class="etq" style="color:var(--rojo)">Emergencia · hazlo en este orden</span><h2>Se rige por <span class="codigo">${esc(d.codigo)}</span></h2><p class="ayuda">${esc(d.titulo)}</p>`
        + (d.acciones?.length ? `<ol class="acc">${d.acciones.map((a: string) => `<li><span>${esc(a)}</span></li>`).join("")}</ol>` : "")
        + `<button class="b1 alerta" data-a="abrirEmergencia">Abrir orden de emergencia</button>`
        + `<button class="link" data-a="cerrarEop">Cerrar</button></div>`;
    }
    case "novedad": {
      const pt = E.p?.ronda?.puntos[f?.i as number];
      return `<div class="hoja-caja"><span class="etq">${esc(h.valorTxt || pt?.texto || "")}</span><h2>${h.opcional ? "¿Dónde? Sala o zona" : "¿Qué viste?"}</h2><label class="oculto" for="nota-novedad">Qué viste</label><textarea id="nota-novedad" placeholder="${h.opcional ? "Por ejemplo: quirófano 2." : "Por ejemplo: alarma de presión baja en la zona 2."}"></textarea>`
        + `<p class="err" id="err-novedad" hidden>Escríbelo: queda en la ronda y le llega a tu jefatura.</p>`
        + `<button class="b1" data-a="novedadSeguir">Anotar y seguir</button><button class="link" data-a="cerrarHoja">${h.opcional ? "Corregir la lectura" : "Cancelar"}</button></div>`;
    }
    case "pideOrden": {
      return `<div class="hoja-caja"><span class="etq">${esc(h.valorTxt || "No conforme")}</span><h2>Esto pide una orden</h2><p class="ayuda">${esc(h.nota || "")}</p>`
        + `<button class="b1" data-a="correctivoDeParada">Abrir la orden y seguir</button><button class="link" data-a="aopSeguir">Seguir sin orden</button></div>`;
    }
    case "noverif": {
      const pt = E.p?.ronda?.puntos[f?.i as number];
      return `<div class="hoja-caja"><span class="etq">${esc(pt?.texto ?? "")}</span><h2>¿Por qué no se pudo verificar?</h2><label class="oculto" for="nota-noverif">Razón</label><textarea id="nota-noverif" placeholder="Por ejemplo: quirófano ocupado."></textarea>`
        + `<p class="err" id="err-noverif" hidden>La razón queda escrita en la ronda; sin ella no se puede seguir.</p>`
        + `<button class="b1" data-a="noverifSeguir">Anotar y seguir</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "plan": {
      return `<div class="hoja-caja"><span class="etq">${esc(E.b.ficha?.activo?.codigo ?? "")}</span><h2>${esc(h.plan.titulo)}</h2><p class="ayuda">Se abre la orden a tu nombre y arranca el cronómetro.</p><p class="err" id="err-crear" hidden></p>`
        + `<button class="b1" data-a="empezarPlan" data-id="${h.plan.id}">${ico.play}Empezar</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "noProg": {
      const pl = E.b.ficha?.plantillas ?? [];
      return `<div class="hoja-caja"><span class="etq">Mantenimiento no programado</span><h2>¿Qué le vas a hacer?</h2><label class="oculto" for="nota-noprog">Qué le vas a hacer</label><textarea id="nota-noprog" placeholder="Usa el micrófono del teclado para dictarlo."></textarea>`
        + (pl.length ? `<label class="etq" for="plantilla">Lista de pasos (opcional)</label><select class="campo" id="plantilla"><option value="">Sin lista de pasos</option>${pl.map((x: Any) => `<option value="${x.id}"${x.id === E.b.ficha?.plantillaSugerida ? " selected" : ""}>${esc(x.nombre)}</option>`).join("")}</select>` : "")
        + `<p class="err" id="err-crear" hidden></p><button class="b1" data-a="empezarNoProgramado">${ico.play}Empezar</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "falla": {
      const fi = E.b.ficha;
      const d = fi?.falla;
      const esEop = d && String(d.codigo).startsWith("EOP");
      // Fuera del área para la que se escribió el documento, lo normal es un correctivo.
      const correctivoPrimero = !esEop || d.fueraDeAlcance;
      const bEmergencia = esEop ? `<button class="${correctivoPrimero ? "b2" : "b1 alerta"}" data-a="fallaEmergencia">${correctivoPrimero ? "Es una emergencia: abrir orden" : "Abrir orden de emergencia"}</button>` : "";
      const bCorrectivo = `<button class="${correctivoPrimero ? "b1" : "b2"}" data-a="fallaCorrectivo">${correctivoPrimero ? "Abrir correctivo" : "No es emergencia: abrir correctivo"}</button>`;
      return `<div class="hoja-caja"><span class="etq">${esc(fi?.activo?.codigo ?? "")} · ya falló</span>`
        + (d ? `<h2>Se rige por <span class="codigo">${esc(d.codigo)}</span></h2><p class="ayuda">${esc(d.titulo)}</p>${d.aviso ? `<p class="ayuda">${esc(d.aviso)}</p>` : ""}${d.acciones?.length ? `<ol class="acc">${d.acciones.map((a: string) => `<li><span>${esc(a)}</span></li>`).join("")}</ol>` : ""}` : `<h2>Este equipo todavía no tiene un documento de emergencia</h2>`)
        + `<label class="oculto" for="nota-falla">Qué pasó</label><textarea id="nota-falla" placeholder="Qué pasó. Usa el micrófono del teclado."></textarea><p class="err" id="err-falla" hidden>Describe en pocas palabras qué pasó.</p>`
        + (correctivoPrimero ? bCorrectivo + bEmergencia : bEmergencia + bCorrectivo)
        + `<button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "otra":
      return `<div class="hoja-caja"><span class="etq">Otra falla</span><h2>¿Qué pasó y dónde?</h2><label class="oculto" for="nota-otra">Qué pasó y dónde</label><textarea id="nota-otra" placeholder="Por ejemplo: fuga en lavamanos, consultorio 4."></textarea><p class="err" id="err-otra" hidden>Describe en pocas palabras qué pasó y dónde.</p>`
        + `<button class="b1" data-a="otraEnviar">Abrir correctivo</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    case "salir":
      return `<div class="hoja-caja"><span class="etq">Cerrar sesión</span><h2>${E.pend.length ? `Tienes ${E.pend.length} registros sin enviar` : "¿Cerrar sesión?"}</h2>`
        + (E.pend.length ? `<p class="ayuda">Quedan guardados en este celular y se envían cuando vuelvas a entrar con tu usuario.</p>` : "")
        + `<button class="b1" data-a="salirConfirmado">Cerrar sesión</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
  }
  return "";
}

// ── Pintar ──────────────────────────────────────────────────────────────────
const VISTAS: Record<string, () => string> = {
  hoy: vHoy, inicio: vInicio, pausa: vPausa, paso: vPaso, fin: vFin, listo: vListo,
  buscar: vBuscar, reportarLugar: vBuscar, equipos: vEquipos, equipo: vEquipo, falla: vFalla, reportar: vReportar, ayuda: vAyuda,
};
const TAB_DE: Record<string, string> = { hoy: "hoy", inicio: "hoy", pausa: "hoy", listo: "hoy", buscar: "buscar", equipo: "buscar", reportar: "reportar", reportarLugar: "reportar", falla: "reportar", ayuda: "ayuda" };
function pintarTabs() {
  const T: [string, string, string, string][] = [["hoy", "Hoy", ico.casa, "#hoy"], ["buscar", "Buscar equipo", ico.lupa, "#buscar"], ["reportar", "Reportar falla", ico.falla, "#reportar"], ["ayuda", "Ayuda", ico.ayuda, "#ayuda"]];
  const actual = E.vista === "equipos" ? (E.b.modo === "reportar" ? "reportar" : "buscar") : TAB_DE[E.vista];
  const nav = $("#tabs");
  if (nav) nav.innerHTML = T.map(([k, l, i, h]) => `<a href="${h}" data-a="ir" data-h="${h}" class="${actual === k ? "activo" : ""}"${actual === k ? ' aria-current="page"' : ""}>${i}<span>${l}</span></a>`).join("");
}
function pintar(op: { conservar?: boolean } = {}) {
  const pantalla = $("#pantalla");
  if (!pantalla) return;
  const antes = pantalla.scrollTop;
  pantalla.innerHTML = (VISTAS[E.vista] ?? vHoy)();
  const sinTabs = E.vista === "paso" || E.vista === "fin";
  const nav = $("#tabs");
  if (nav) nav.hidden = sinTabs;
  if (!sinTabs) pintarTabs();
  pintarHoja();
  pantalla.scrollTop = op.conservar ? antes : 0;
  refrescarPill();
  actualizarReloj();
  const l = $<HTMLInputElement>("#lectura");
  if (l && !E.hoja) { evaluarLectura(); if (!l.value) l.focus({ preventScroll: true }); }
}
function pintarHoja() {
  const h = $("#hoja");
  if (!h) return;
  h.hidden = !E.hoja;
  h.innerHTML = E.hoja ? vHoja() : "";
}
function actualizarReloj() {
  const r = $("#reloj");
  if (!r) return;
  const f = E.flujo;
  if (!f) return;
  if (f.tipo === "ronda") {
    const ini = E.p?.ronda?.iniciadaEn;
    r.textContent = ini ? relojTxt(Date.now() - Date.parse(ini)) : "00:00";
  } else {
    const o = ordenDe(f.ordenId as number);
    if (o) r.textContent = relojTxt(efectivoMs(o));
  }
  const fh = $("#fin-hora");
  if (fh) fh.textContent = hora(Date.now());
}
setInterval(actualizarReloj, 1000);

// ── Pantalla encendida mientras se trabaja ──────────────────────────────────
function mantenerPantalla() {
  try {
    if ((navigator as Any).wakeLock && !E.lock) (navigator as Any).wakeLock.request("screen").then((l: Any) => { E.lock = l; l.addEventListener?.("release", () => { E.lock = null; }); }).catch(() => {});
  } catch {}
}
function soltarPantalla() { try { E.lock?.release(); } catch {} E.lock = null; }

// ── Navegación: el botón Atrás del celular siempre hace lo esperado ─────────
function ir(hash: string, reemplazar = false) {
  E.hoja = null;
  if (reemplazar || history.state?.hoja) history.replaceState({}, "", hash);
  else history.pushState({}, "", hash);
  ruta();
}
function abrirHoja(h: Any) {
  const ya = !!E.hoja;
  E.hoja = h;
  if (!ya) history.pushState({ hoja: true }, "", location.hash || "#hoy");
  pintarHoja();
  const t = document.querySelector<HTMLTextAreaElement>("#hoja textarea");
  if (t && h.foco !== false) t.focus({ preventScroll: true });
}
function cerrarHoja() {
  if (history.state?.hoja) { history.back(); return; }
  E.hoja = null;
  pintarHoja();
}
/** Una hoja que termina en otra pantalla no debe dejar una entrada que Atrás reabra. */
function soltarHistorialDeHoja() { if (history.state?.hoja) history.replaceState({}, "", location.hash || "#hoy"); }

function ruta() {
  const h = location.hash.replace(/^#/, "") || "hoy";
  let m: RegExpExecArray | null;
  E.hoja = null;
  if ((m = /^orden-(\d+)$/.exec(h))) { abrirOrden(Number(m[1])); return; }
  if (h === "ronda") { abrirRonda(); return; }
  if (h === "buscar" || h === "reportar/lugar") {
    E.b.modo = h === "buscar" ? "buscar" : "reportar";
    E.vista = h === "buscar" ? "buscar" : "reportarLugar";
    pintar();
    void cargarUbicaciones();
    return;
  }
  if ((m = /^(buscar|reportar)\/(\d+|sin)$/.exec(h))) {
    E.b.modo = m[1];
    E.vista = "equipos";
    const u = E.b.ubicaciones?.find((x: Any) => String(x.id) === m![2]);
    E.b.ubNombre = m[2] === "sin" ? "Equipos sin ubicación" : u?.nombre ?? "";
    E.b.equipos = null;
    pintar();
    void cargarEquipos(m[2]);
    return;
  }
  if ((m = /^(equipo|falla)\/(\d+)$/.exec(h))) {
    E.vista = m[1];
    E.b.modo = m[1] === "falla" ? "reportar" : "buscar";
    E.b.ficha = null;
    pintar();
    void cargarFicha(Number(m[2]));
    return;
  }
  E.flujo = E.flujo && ["paso", "fin"].includes(E.vista) ? null : E.flujo;
  E.vista = ["reportar", "ayuda"].includes(h) ? h : "hoy";
  if (E.vista === "hoy" && Date.now() - E.ultimoFetch > 60000) void refrescarHoy();
  pintar();
}
function abrirRonda() {
  rodarTurno(); // Sin señal y con la página recién recargada: nunca abrir el turno que ya pasó.
  const r = E.p?.ronda;
  if (!r) { E.vista = "hoy"; pintar(); return; }
  if (r.estado === "sin_iniciar") void despachar({ tipo: "ronda.iniciar", rondaId: r.rondaId, sucursalId: r.sucursalId, fecha: r.fecha, turno: r.turno });
  const i = rondaFaltante(r);
  E.flujo = { tipo: "ronda", i: i < 0 ? r.puntos.length - 1 : i };
  E.vista = i < 0 ? "fin" : "paso";
  mantenerPantalla();
  pintar();
}

// ── Crear una orden que no estaba en la lista ───────────────────────────────
async function crearOrden(cuerpoPost: Record<string, unknown>) {
  const at = new Date().toISOString();
  const err = $("#err-crear");
  if (err) err.hidden = true;
  try {
    const r = await fetch("/api/campo/ordenes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpoPost) });
    const j: Any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "No se pudo abrir la orden.");
    const o = j.orden;
    if (!E.base.ordenes.some((x: Any) => x.id === o.id)) E.base.ordenes.unshift(o);
    rebase();
    void cola.guardar(`hoy:${UID}`, E.base);
    const fresca = ordenDe(o.id);
    if (fresca.estado === "abierta") await despachar({ tipo: "orden.iniciar", ordenId: o.id }, at);
    aviso(`Cronómetro iniciado a las ${hora(at)}.`);
    ir(`#orden-${o.id}`, true);
  } catch (e: Any) {
    const msg = e instanceof TypeError ? "Abrir una orden nueva necesita señal. Si es urgente, usa Reportar falla: eso sí se guarda sin señal." : e.message;
    if (e instanceof TypeError) E.enLinea = false;
    if (err) { err.textContent = msg; err.hidden = false; } else aviso(msg);
  }
}

function abrirFalla(tipo: "emergencia.abrir" | "correctivo.abrir", datos: Record<string, unknown>, titulo: string) {
  void despachar({ tipo, titulo, ...datos });
  zumbar();
  E.hoja = null;
  aviso(`${tipo === "emergencia.abrir" ? `Emergencia anotada a las ${hora(Date.now())}.` : "Correctivo anotado."} ${queVeLaJefatura()}`);
}
/** Nunca decir que la jefatura ya lo ve si no hay señal. */
const queVeLaJefatura = () => (E.enLinea ? "Tu jefatura ya lo ve." : "Tu jefatura no lo ve hasta que vuelva la señal; si es urgente, avísale por radio.");
/** Un punto crítico con novedad, o un equipo que no vuelve a servicio, detienen la secuencia: los pasos que siguen ya no aplican. */
function detenerOrden(o: Any, nota: string, valor: unknown) {
  const f = E.flujo as Flujo;
  void despachar({ tipo: "orden.paso", ordenId: o.id, idx: f.i, texto: o.pasos[f.i].texto, estado: "desviacion", nota, ...(valor ? { valor } : {}) });
  void despachar({ tipo: "orden.pausar", ordenId: o.id, motivo: `Detenida: ${nota}`.slice(0, 300) });
  zumbar();
  soltarPantalla();
  E.flujo = null;
  E.hoja = null;
  soltarHistorialDeHoja();
  aviso(`Orden en espera. ${queVeLaJefatura()}`);
  ir("#hoy", true);
}

// ── Acciones ────────────────────────────────────────────────────────────────
const A: Record<string, (d: DOMStringMap, b: HTMLElement) => void> = {
  ir(d) { if (d.h) ir(d.h); },
  reintentar() { E.cargando = true; pintar(); void refrescarHoy(); },
  sync() { abrirHoja({ tipo: "sync" }); },
  enviarAhora() { E.sesionVencida = false; esperaMs = 5000; cerrarHoja(); void drenar(); },
  verRechazos() { abrirHoja({ tipo: "rechazos" }); },
  limpiarRechazos() { E.rechazos = []; void cola.guardar(`rechazos:${UID}`, []); cerrarHoja(); pintar({ conservar: true }); },
  grupo(d) { E.grupo = (E.grupo === d.g || (!E.grupo && d.g === [...document.querySelectorAll<HTMLElement>("[data-a=grupo][aria-expanded=true]")][0]?.dataset.g)) ? "__ninguno" : d.g ?? null; pintar({ conservar: true }); },
  sede() { abrirHoja({ tipo: "sede", foco: false }); },
  elegirSede(d) {
    E.sede = Number(d.id);
    void cola.guardar(`sede:${UID}`, E.sede);
    E.b.ubicaciones = null;
    E.hoja = null;
    soltarHistorialDeHoja();
    // La ronda de otra sede no se ofrece con el nombre de esta.
    if (E.base?.ronda && Number(E.base.ronda.sucursalId) !== E.sede) { E.base.ronda = null; rebase(); }
    if (E.vista === "buscar" || E.vista === "reportarLugar") void cargarUbicaciones();
    if (!navigator.onLine) aviso("Sin señal: la ronda y la lista de esa sede cargan cuando vuelva.");
    pintar();
    void refrescarHoy();
  },
  ronda() { ir("#ronda"); },
  empezar(d) {
    const id = Number(d.id);
    const activa = enCurso();
    if (activa && activa.id !== id) { abrirHoja({ tipo: "otraActiva", id, activaId: activa.id, foco: false }); return; }
    const o = ordenDe(id);
    if (!o) return;
    void despachar({ tipo: "orden.iniciar", ordenId: id });
    zumbar();
    aviso(`Cronómetro iniciado a las ${hora(Date.now())}.`);
    ir(`#orden-${id}`, location.hash === `#orden-${id}`);
  },
  pausarYEmpezar(d) {
    const id = Number(d.id);
    void despachar({ tipo: "orden.pausar", ordenId: Number(d.activa), motivo: "Pasó a otra orden" });
    void despachar({ tipo: "orden.iniciar", ordenId: id });
    aviso(`Cronómetro iniciado a las ${hora(Date.now())}.`);
    ir(`#orden-${id}`, true);
  },
  reanudar(d) {
    const id = Number(d.id);
    void despachar({ tipo: "orden.reanudar", ordenId: id });
    zumbar();
    abrirOrden(id);
  },
  salir() { soltarPantalla(); E.flujo = null; ir("#hoy"); },
  hecho() { marcarPaso("ok"); },
  conforme() { marcarParada("ok"); avanzar(); },
  na() { marcarPaso("na"); },
  anterior() {
    const f = E.flujo;
    if (!f) return;
    if (E.vista === "fin") {
      const n = f.tipo === "ronda" ? E.p.ronda.puntos.length : ordenDe(f.ordenId as number).pasos.length;
      f.i = n - 1; E.vista = "paso";
    } else if (f.i > 0) f.i--;
    pintar();
  },
  irPaso(d) { const f = E.flujo; if (!f) return; f.i = Number(d.i); E.vista = "paso"; pintar(); },
  lectura: guardarLectura,
  problema() { abrirHoja({ tipo: "problema" }); },
  problemaSeguir() {
    const t = $<HTMLTextAreaElement>("#nota-problema");
    const h = E.hoja;
    const nota = t?.value.trim() ?? "";
    const final = nota.length >= 10 ? nota : h.valorTxt ? (nota ? `${h.valorTxt}. ${nota}` : h.valorTxt) : "";
    if (!final) { const e = $("#err-problema"); if (e) e.hidden = false; t?.focus(); return; }
    marcarPaso("desviacion", { nota: final, ...(h.valor ? { valor: h.valor } : {}) });
  },
  problemaCorrectivo() {
    const t = $<HTMLTextAreaElement>("#nota-problema");
    const h = E.hoja;
    const nota = t?.value.trim() ?? "";
    const final = nota.length >= 10 ? nota : h.valorTxt ? (nota ? `${h.valorTxt}. ${nota}` : h.valorTxt) : "";
    if (!final) { const e = $("#err-problema"); if (e) e.hidden = false; t?.focus(); return; }
    const o = ordenDe(E.flujo?.ordenId as number);
    abrirFalla("correctivo.abrir", { activoId: o.activo?.id ?? null, ubicacionId: o.lugar?.ubicacionId ?? null, sucursalId: o.lugar?.sedeId ?? E.sede, rubro: o.rubro ?? "infraestructura", nota: final }, `Correctivo: ${tituloOrden(o)}`);
    detenerOrden(o, final, h.valor);
  },
  problemaDetener() {
    const t = $<HTMLTextAreaElement>("#nota-problema");
    const h = E.hoja;
    const nota = t?.value.trim() ?? "";
    const final = nota.length >= 10 ? nota : h.valorTxt ? (nota ? `${h.valorTxt}. ${nota}` : h.valorTxt) : "";
    if (!final) { const e = $("#err-problema"); if (e) e.hidden = false; t?.focus(); return; }
    detenerOrden(ordenDe(E.flujo?.ordenId as number), final, h.valor);
  },
  abrirCorrectivoDesdeFin() {
    const o = ordenDe(E.flujo?.ordenId as number);
    const crit = o.pasos.find((p: Any) => p.estado === "desviacion" && p.critico);
    abrirFalla("correctivo.abrir", { activoId: o.activo?.id ?? null, ubicacionId: o.lugar?.ubicacionId ?? null, sucursalId: o.lugar?.sedeId ?? E.sede, rubro: o.rubro ?? "infraestructura", nota: crit?.nota ?? "Punto crítico con novedad durante el preventivo." }, `Correctivo: ${tituloOrden(o)}`);
    pintar();
  },
  noconf() {
    const l = $<HTMLInputElement>("#lectura");
    abrirHoja({ tipo: "novedad", valor: l ? num(l.value) : null, at: new Date().toISOString() });
  },
  novedadSeguir() {
    const h = E.hoja;
    const t = $<HTMLTextAreaElement>("#nota-novedad");
    const nota = t?.value.trim() ?? "";
    if (!h.opcional && nota.length < 3) { const e = $("#err-novedad"); if (e) e.hidden = false; t?.focus(); return; }
    const pt = E.p.ronda.puntos[(E.flujo as Flujo).i];
    marcarParada("fuera", { ...(h.valor != null ? { valor: h.valor } : {}), ...(nota ? { nota } : {}) }, h.at);
    abrirHojaDeDesviacion(pt, h.valorTxt || (pt.pideValor ? "Hay una alarma" : "No conforme"), h.at, nota);
  },
  correctivoDeParada() {
    const r = E.p.ronda;
    const pt = r.puntos[(E.flujo as Flujo).i];
    const nota = [String(pt.texto).replace(/ · /g, ": "), E.hoja?.nota].filter(Boolean).join(". ");
    abrirFalla("correctivo.abrir", { sucursalId: r.sucursalId, rubro: pt.sistema === "hvac" || pt.sistema === "minisplit" ? "aires" : "infraestructura", nota, ...origenRonda() }, `Correctivo: ${pt.texto}`);
    avanzar();
  },
  noverif() { abrirHoja({ tipo: "noverif" }); },
  noverifSeguir() {
    const t = $<HTMLTextAreaElement>("#nota-noverif");
    const nota = t?.value.trim() ?? "";
    if (nota.length < 3) { const e = $("#err-noverif"); if (e) e.hidden = false; t?.focus(); return; }
    marcarParada("no_verificado", { nota });
    avanzar();
  },
  aopSeguir() { avanzar(); },
  aEop() {
    const d = E.hoja?.doc?.eop;
    if (d) abrirHoja({ tipo: "eop", doc: d, foco: false });
  },
  verEop(d) {
    const doc = (E.p?.emergencias ?? []).find((x: Any) => x.codigo === d.c);
    if (doc) abrirHoja({ tipo: "eop", doc, foco: false });
  },
  abrirEmergencia() {
    const d = E.hoja?.doc;
    const fi = E.b.ficha;
    const activo = E.vista === "falla" ? fi?.activo : null;
    abrirFalla("emergencia.abrir", { eop: d?.codigo, activoId: activo?.id ?? null, ubicacionId: activo?.ubicacionId ?? null, sucursalId: activo?.sedeId ?? E.sede, ...origenRonda() }, `Emergencia: ${d?.titulo ?? ""}`);
    if (E.flujo?.tipo === "ronda") { avanzar(); return; }
    soltarHistorialDeHoja();
    ir("#hoy", true);
  },
  cerrarEop() {
    if (E.flujo?.tipo === "ronda" && E.vista === "paso") { avanzar(); return; }
    cerrarHoja();
  },
  cerrarHoja() { cerrarHoja(); },
  pausar() { abrirHoja({ tipo: "pausar", foco: false }); },
  motivoPausa(d, b) {
    document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true");
    E.hoja.motivo = d.m;
  },
  confirmarPausa() {
    const t = $<HTMLTextAreaElement>("#nota-pausa");
    const motivo = t?.value.trim() || E.hoja?.motivo;
    if (!motivo) { const e = $("#err-pausa"); if (e) e.hidden = false; return; }
    const id = E.flujo?.ordenId as number;
    void despachar({ tipo: "orden.pausar", ordenId: id, motivo });
    soltarPantalla();
    E.flujo = null;
    aviso("Pausado. El tiempo de trabajo se detuvo.");
    ir("#hoy", true);
  },
  verNota() { E.verNota = true; pintar({ conservar: true }); },
  enviar() {
    const f = E.flujo as Flujo;
    const o = ordenDe(f.ordenId as number);
    const nota = (E.notas[`fin:${o.id}`] ?? "").trim();
    const causa = (E.notas[`causa:${o.id}`] ?? o.causaRaiz ?? "").trim();
    const err = $("#err-fin");
    const decir = (m: string) => { if (err) { err.textContent = m; err.hidden = false; } };
    if (!o.pasos.length && nota.length < 10) { decir("Describe lo que hiciste (al menos 10 letras)."); return; }
    if (o.pideCausaRaiz && causa.length < (o.minCausaRaiz ?? 20)) { decir(`Esta orden pide la causa raíz (al menos ${o.minCausaRaiz ?? 20} letras).`); return; }
    const ahora = new Date().toISOString();
    const pausa = o.pausadoMin ?? 0;
    const inicioIso = o.iniciadaEn ?? ahora;
    E.listo = { titulo: [o.activo?.codigo, tituloOrden(o)].filter(Boolean).join(" · "), lugar: o.lugar?.ubicacion, inicio: hora(inicioIso), fin: hora(ahora), efectivo: duracion((Date.parse(ahora) - Date.parse(inicioIso)) / 60000 - pausa), pausa: pausa ? duracion(pausa) : "", sinEnviar: !E.enLinea };
    void despachar({ tipo: "orden.terminar", ordenId: o.id, nota: nota || null, causaRaiz: causa || null }, ahora);
    zumbar();
    soltarPantalla();
    delete E.notas[`fin:${o.id}`];
    delete E.notas[`causa:${o.id}`];
    E.verNota = false;
    E.flujo = null;
    E.vista = "listo";
    history.replaceState({}, "", "#hoy");
    pintar();
  },
  cerrarRonda() {
    const r = E.p.ronda;
    const t = $<HTMLTextAreaElement>("#entrega");
    const notas = t?.value.trim() ?? "";
    const hayNovedad = Object.values(r.lecturas).some((l: Any) => l.resultado !== "ok");
    if (hayNovedad && notas.length < 3) { const e = $("#err-entrega"); if (e) e.hidden = false; t?.focus(); return; }
    void despachar({ tipo: "ronda.cerrar", rondaId: r.rondaId, sucursalId: r.sucursalId, fecha: r.fecha, turno: r.turno, firma: true, notas });
    delete E.notas[`entrega:${r.fecha}:${r.turno}`];
    zumbar();
    soltarPantalla();
    E.flujo = null;
    E.grupo = null;
    aviso("Ronda cerrada. Sigue tu lista.");
    ir("#hoy", true);
  },
  recargarBusqueda() {
    if (E.vista === "equipos" && E.b.ubId) void cargarEquipos(E.b.ubId);
    else if (E.vista === "equipo" || E.vista === "falla") ruta();
    else void cargarUbicaciones();
  },
  confirmarPlan(d) {
    const plan = E.b.ficha?.planes.find((p: Any) => p.id === Number(d.id));
    if (plan) abrirHoja({ tipo: "plan", plan, foco: false });
  },
  empezarPlan(d) { void crearOrden({ activoId: E.b.ficha.activo.id, planId: Number(d.id) }); },
  noProgramado() { abrirHoja({ tipo: "noProg" }); },
  empezarNoProgramado() {
    const t = $<HTMLTextAreaElement>("#nota-noprog");
    const descripcion = t?.value.trim() ?? "";
    const err = $("#err-crear");
    if (descripcion.length < 5) { if (err) { err.textContent = "Escribe en pocas palabras qué le vas a hacer."; err.hidden = false; } t?.focus(); return; }
    const pl = (document.getElementById("plantilla") as Any)?.value;
    void crearOrden({ activoId: E.b.ficha.activo.id, tipo: "preventivo", descripcion, plantillaId: pl ? Number(pl) : null });
  },
  yaFallo() { abrirHoja({ tipo: "falla" }); },
  fueraDeRango() {
    const d = E.b.ficha?.desviacion;
    if (!d) { aviso("Este equipo no tiene un AOP. Si no vuelve a la normalidad, repórtalo como falla."); abrirHoja({ tipo: "falla" }); return; }
    abrirHoja({ tipo: "aop", doc: { ...d, eop: E.b.ficha?.falla ?? null }, foco: false });
  },
  abrirDesviacion() {
    const d = E.hoja?.doc;
    const a = E.b.ficha?.activo;
    void despachar({ tipo: "aop.abrir", procedimientoId: d.id, activoId: a?.id ?? null, ubicacionId: a?.ubicacionId ?? null, sucursalId: a?.sedeId ?? E.sede, valor: $<HTMLInputElement>("#valor-desv")?.value ?? null, nota: $<HTMLTextAreaElement>("#nota-desv")?.value ?? "" });
    zumbar();
    aviso(`Desviación abierta. Actuar antes de ${plazo(d.actuarMin)}.`);
    soltarHistorialDeHoja();
    ir("#hoy", true);
  },
  fallaEmergencia() {
    const fi = E.b.ficha;
    const nota = $<HTMLTextAreaElement>("#nota-falla")?.value.trim() ?? "";
    abrirFalla("emergencia.abrir", { eop: fi.falla?.codigo, activoId: fi.activo.id, ubicacionId: fi.activo.ubicacionId, sucursalId: fi.activo.sedeId ?? E.sede, nota }, `Emergencia: ${fi.activo.nombre}`);
    soltarHistorialDeHoja();
    ir("#hoy", true);
  },
  fallaCorrectivo() {
    const fi = E.b.ficha;
    const t = $<HTMLTextAreaElement>("#nota-falla");
    const nota = t?.value.trim() ?? "";
    if (nota.length < 5) { const e = $("#err-falla"); if (e) e.hidden = false; t?.focus(); return; }
    abrirFalla("correctivo.abrir", { activoId: fi.activo.id, ubicacionId: fi.activo.ubicacionId, sucursalId: fi.activo.sedeId ?? E.sede, nota }, `Correctivo: ${fi.activo.nombre}`);
    soltarHistorialDeHoja();
    ir("#hoy", true);
  },
  otraFalla() { abrirHoja({ tipo: "otra" }); },
  otraEnviar() {
    const t = $<HTMLTextAreaElement>("#nota-otra");
    const nota = t?.value.trim() ?? "";
    if (nota.length < 5) { const e = $("#err-otra"); if (e) e.hidden = false; t?.focus(); return; }
    abrirFalla("correctivo.abrir", { sucursalId: E.sede, rubro: "infraestructura", nota }, `Correctivo: ${nota.slice(0, 60)}`);
    soltarHistorialDeHoja();
    ir("#hoy", true);
  },
  salirSesion() { abrirHoja({ tipo: "salir", foco: false }); },
  async salirConfirmado() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    try { navigator.serviceWorker?.controller?.postMessage({ tipo: "olvidar" }); } catch {}
    location.href = "/login";
  },
  instalar() { E.instalar?.prompt?.(); E.instalar = null; pintar({ conservar: true }); },
};

const movil = $("#movil") as HTMLElement;
let ultimoToque = -1000;
movil.addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement;
  const b = t.closest<HTMLElement>("[data-a]");
  if (b) {
    if (b.hasAttribute("disabled")) return;
    ev.preventDefault();
    // Un doble toque no debe caer en lo que se pintó debajo: un «Conforme» en una parada que nadie vio.
    if (ev.isTrusted && ev.timeStamp - ultimoToque < 400) return;
    if (ev.isTrusted) ultimoToque = ev.timeStamp;
    A[b.dataset.a as string]?.(b.dataset, b);
    return;
  }
  const fuera = t.closest<HTMLAnchorElement>("a[data-fuera]");
  if (fuera && !navigator.onLine) { ev.preventDefault(); aviso("Eso necesita señal. Tu trabajo aquí sigue guardándose."); return; }
  if (t === $("#hoja") && E.hoja && E.hoja.tipo !== "aop" && E.hoja.tipo !== "eop" && E.hoja.tipo !== "pideOrden") cerrarHoja();
});
movil.addEventListener("input", (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.id === "lectura") evaluarLectura();
  if (t.dataset.nota) E.notas[t.dataset.nota] = t.value;
  if (t.id === "filtro") {
    const q = t.value.trim().toLowerCase();
    document.querySelectorAll<HTMLElement>(".lista [data-q]").forEach((f) => { f.style.display = !q || (f.dataset.q ?? "").includes(q) ? "" : "none"; });
  }
});
movil.addEventListener("keydown", (ev) => {
  const t = ev.target as HTMLElement;
  if (t.id === "lectura" && ev.key === "Enter") { ev.preventDefault(); guardarLectura(); }
});
movil.addEventListener("change", async (ev) => {
  const t = ev.target as HTMLInputElement;
  if (!t.matches("[data-foto]") || !t.files?.[0]) return;
  const r = $("#foto-res");
  if (!r) return;
  r.classList.add("si");
  r.textContent = "Reduciendo la foto…";
  try {
    const c = await comprimir(t.files[0]);
    const ordenId = E.flujo?.ordenId;
    if (!ordenId) throw new Error("sin orden");
    await despachar({ tipo: "foto", ordenId, categoria: t.dataset.foto, blob: c.blob, nombre: `foto-${Date.now()}.jpg` });
    r.innerHTML = `<img alt="Foto guardada" src="${c.url}"><span>Tu foto de <b>${peso(c.antes)}</b> quedó en <b>${peso(c.despues)}</b>. Se envía por detrás; puedes seguir.</span>`;
  } catch {
    r.textContent = "No se pudo leer esa imagen. Prueba tomarla otra vez.";
  }
  t.value = "";
});
window.addEventListener("popstate", () => {
  if (E.hoja && !history.state?.hoja) { E.hoja = null; pintarHoja(); return; }
  ruta();
});
window.addEventListener("online", () => { E.enLinea = true; esperaMs = 5000; refrescarPill(); void drenar(); void refrescarHoy(); });
window.addEventListener("offline", () => { E.enLinea = false; refrescarPill(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (E.flujo) mantenerPantalla();
  if (rodarTurno()) repintarSiEsSeguro();
  void drenar();
  if (Date.now() - E.ultimoFetch > 60000) void refrescarHoy();
});
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  if (rodarTurno()) repintarSiEsSeguro();
  void drenar();
}, 30000);
window.addEventListener("beforeinstallprompt", (ev) => { ev.preventDefault(); E.instalar = ev; });

// El teclado no debe tapar el botón de guardar: en iPhone la página no se encoge sola.
const vv = window.visualViewport;
if (vv) {
  const ajustar = () => { document.documentElement.style.setProperty("--alto", `${vv.height}px`); if (document.documentElement.scrollTop) document.documentElement.scrollTop = 0; };
  vv.addEventListener("resize", ajustar);
  ajustar();
}

// ── Arranque ────────────────────────────────────────────────────────────────
(async () => {
  E.pend = await cola.deUsuario(UID);
  E.ultimoSeq = E.pend.at(-1)?.seq ?? 0;
  E.rechazos = (await cola.leer<Any[]>(`rechazos:${UID}`)) ?? [];
  E.sede = (await cola.leer<number>(`sede:${UID}`)) ?? null;
  const copia = await cola.leer<Any>(`hoy:${UID}`);
  if (copia) {
    E.base = copia;
    if (!E.sede) E.sede = copia.sedeId ?? null;
    rebase();
    E.cargando = false;
  }
  ruta();
  await refrescarHoy();
  // Con el paquete fresco, si se entró directo a una orden o a la ronda, se abre bien.
  if (/^#(orden-\d+|ronda)$/.test(location.hash) && E.vista === "hoy" && !E.hoja) ruta();
  void drenar();
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.serviceWorker.ready.then((reg) => {
      setTimeout(() => {
        const urls = performance.getEntriesByType("resource").map((r) => r.name).filter((u) => /\/(_astro|fonts|icons|brand)\//.test(u));
        reg.active?.postMessage({ tipo: "guardar", urls: ["/campo", ...urls] });
      }, 2500);
    }).catch(() => {});
  });
}
