// Modo técnico. El celular trabaja primero y sincroniza después: cada toque se
// aplica aquí, se guarda en el teléfono con su hora real y se envía en orden.
// Si se va la señal no cambia nada para el técnico.
//
// El técnico no ve tiempos de medición: ni cuándo empezó, ni cuánto lleva, ni
// cuánto estima la lista. Se registran igual, con la hora real de cada toque, y
// los lee la jefatura. Sí ve los plazos que le dicen qué hacer: «Vence…»,
// «Actuar antes de», «Escalar antes de» y el turno de la ronda.
//
// Lo que escribe queda en el celular mientras lo escribe (el borrador): si
// recarga, cierra la app o se va la señal, vuelve a la misma pantalla, a la
// misma hoja y al mismo texto.
import * as cola from "./cola";
import type { Op } from "./cola";
import { comprimir, peso } from "./foto";
import { laHora, turnoActual, type TurnoInfo } from "../lib/turnos";
import { etiquetaOT } from "../lib/orden-codigo";
import { leerNumero, numeroAlInicio, textoDeNumero, valorDe } from "../lib/numero";

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
  // El borrador: lo escrito, las fotos ya tomadas y los opcionales saltados, por orden u hoja.
  notas: {} as Record<string, string>,
  fotos: {} as Record<string, number>,
  saltos: {} as Record<string, number[]>,
  // Dónde estaba el técnico antes de recargar o cerrar la app.
  restaurar: null as Any,
  hojaPendiente: null as Any,
  verNota: false,
  b: { ubicaciones: null as Any, sinUbicacion: 0, equipos: null as Any, ubId: null as string | null, ubNombre: "", ficha: null as Any, copia: false, error: "", modo: "buscar" },
  lock: null as Any,
  ultimoSeq: 0,
  ultimoFetch: 0,
  instalar: null as Any,
};

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const hora = (iso: string | number | Date) => new Date(iso).toLocaleTimeString("es-SV", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
const hoySV = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
const fecha = (iso: string | null | undefined) => {
  if (!iso) return "";
  const s = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(Date.parse(iso) - 6 * 3_600_000).toISOString().slice(0, 10);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
};
const plazo = (m: number | null | undefined) => (m == null ? "Sin plazo" : m >= 60 ? `${Math.round((m / 60) * 10) / 10} h` : `${m} min`);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
const zumbar = () => { try { navigator.vibrate?.(12); } catch {} };
const primerNombre = (n: string) => n.split(/\s+/)[0] || n;
const corto = (s: unknown, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
/** «Vence hoy 14:30» o «Vence 08/11/2026 14:30». Es un plazo, no un tiempo de medición: el técnico sí lo ve. */
function vencePlazo(iso: string | null | undefined): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso < hoySV() ? "Venció" : "Vence"} ${iso === hoySV() ? "hoy" : fecha(iso)}`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const sv = new Date(ms - 6 * 3_600_000).toISOString();
  return `${ms < Date.now() ? "Venció" : "Vence"} ${sv.slice(0, 10) === hoySV() ? "hoy" : fecha(iso)} ${sv.slice(11, 16)}`;
}
/** «la 01:43», o «la 01:43 del 09/11/2026» si no es de hoy: un plazo de otro día dice su fecha. */
const horaDePlazo = (iso: string) => `${laHora(hora(iso))}${new Date(Date.parse(iso) - 6 * 3_600_000).toISOString().slice(0, 10) === hoySV() ? "" : ` del ${fecha(iso)}`}`;
/**
 * Las acciones del EOP que este celular muestra, tal como las guarda el
 * servidor: si la emergencia no tenía pasos, siembra exactamente estas, aunque
 * sean ninguna. Si la orden ya tiene pasos, el servidor las ignora.
 */
const accionesMostradas = (o: Any) => (o?.modo === "emergencia"
  ? { acciones: (o.pasos ?? []).map((p: Any) => String(p.texto ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, 10) }
  : {});
/** Lo que el técnico escribió para esta operación. Si el servidor la rechaza, vuelve a su borrador. */
const conTexto = (notas: Record<string, unknown>, saltos?: Record<string, number[]>) => {
  const limpias = Object.fromEntries(Object.entries(notas).map(([k, v]) => [k, String(v ?? "").trim()]).filter(([, v]) => v));
  return Object.keys(limpias).length || saltos ? { borrador: { notas: limpias, ...(saltos ? { saltos } : {}) } } : {};
};

/**
 * Un valor guardado, escrito para volver a leerse igual: un número va con textoDeNumero (9.875 queda
 * «9.8750», no «9.875», que se leería de dos formas). Así rellena un campo y así se escribe en un texto.
 */
const comoTexto = (v: unknown) => (typeof v === "number" ? textoDeNumero(v) : String(v ?? ""));
const rangoDe = (p: Any) => {
  const u = p.unidad ? ` ${p.unidad}` : "";
  if (p.min != null && p.max != null) return `${comoTexto(p.min)} a ${comoTexto(p.max)}${u}`;
  if (p.min != null) return `mínimo ${comoTexto(p.min)}${u}`;
  if (p.max != null) return `máximo ${comoTexto(p.max)}${u}`;
  return "";
};
const fueraDe = (p: Any, v: number) => (p.min != null && v < p.min) || (p.max != null && v > p.max);
/**
 * Un número escrito a mano se lee con src/lib/numero.ts, igual que en la ficha y
 * en el servidor: coma o punto decimal, y el separador de miles no se adivina.
 * «1,200» vuelve como ambiguo, con su frase, y no se guarda ni se envía.
 * Una parada de la ronda y el valor de un paso son solo número (leerNumero); una
 * lectura de liberación puede traer su unidad al lado, «13 A» (numeroAlInicio).
 */
const numeroDe = (s: unknown): number | null => valorDe(numeroAlInicio(s));
/** El mismo texto que devuelve el servidor: MENSAJE_PASO_SIN_NUMERO de src/lib/ordenes.ts (la prueba los compara). */
const MENSAJE_PASO_SIN_NUMERO = "Este paso tiene rango: anota el número que marcó el instrumento (por ejemplo 14,5).";
const conformeDe = (l: Any, valor: unknown): boolean | null => { const v = numeroDe(valor); return v == null || (l.min == null && l.max == null) ? null : !fueraDe(l, v); };
const SISTEMAS: Record<string, string> = { electrico: "Sistema eléctrico", hvac: "Climatización crítica", minisplit: "Minisplit", gases: "Gases medicinales", agua: "Agua", incendios: "Incendios", ascensores: "Ascensores", otro: "Otros" };
const limpiarTitulo = (t: string) => String(t ?? "").replace(/^\[[^\]]+\]\s*/, "");
/** Una emergencia se nombra por su documento; las demás, por su equipo. */
const tituloOrden = (o: Any) => (o.modo === "emergencia" ? o.eop?.titulo || limpiarTitulo(o.titulo) : o.activo?.nombre || limpiarTitulo(o.titulo));
const subOrden = (o: Any) => [o.activo?.codigo, o.lugar?.ubicacion].filter(Boolean).join(" · ");
const lugarDe = (o: Any) => [o.lugar?.ubicacion, o.lugar?.sede].filter(Boolean).join(" · ");
const ordenDe = (id: number) => E.p?.ordenes.find((o: Any) => o.id === id) ?? E.p?.libres?.find((o: Any) => o.id === id) ?? null;
// Estas crean una orden nueva en el servidor: en la copia del día no hay nada que aplicarles.
const CREAN_ORDEN = ["emergencia.abrir", "correctivo.abrir"];

// ── Lo que cada operación cambia en pantalla ────────────────────────────────
/** Una orden libre pasa a ser de quien empieza a trabajarla. */
function tomar(p: Any, o: Any) {
  if (o.asignadoA) return;
  o.asignadoA = UID;
  p.libres = (p.libres ?? []).filter((x: Any) => x.id !== o.id);
  if (!p.ordenes.some((x: Any) => x.id === o.id)) p.ordenes.unshift(o);
}
function aplicarLocal(p: Any, op: Op) {
  if (!p) return;
  const o = op.ordenId ? p.ordenes?.find((x: Any) => x.id === op.ordenId) ?? p.libres?.find((x: Any) => x.id === op.ordenId) : null;
  switch (op.tipo) {
    case "orden.iniciar":
      if (!o) break;
      if (!o.iniciadaEn) o.iniciadaEn = op.at;
      o.pausadaEn = null;
      o.estado = "en_proceso";
      tomar(p, o);
      break;
    case "orden.pausar":
      if (o) { o.estado = "en_espera"; o.pausadaEn = op.at; o.motivoPausa = op.motivo; }
      break;
    case "orden.reanudar":
      if (o) { o.pausadaEn = null; o.estado = "en_proceso"; o.motivoPausa = null; }
      break;
    case "orden.paso": {
      const paso = o?.pasos?.[op.idx as number];
      if (paso) {
        paso.estado = op.estado;
        if (op.valor !== undefined && op.valor !== null) paso.valor = comoTexto(op.valor);
        if (typeof op.nota === "string") paso.nota = op.nota;
      }
      break;
    }
    case "orden.terminar":
      if (o) {
        p.ordenes = p.ordenes.filter((x: Any) => x.id !== o.id);
        p.libres = (p.libres ?? []).filter((x: Any) => x.id !== o.id);
        p.hechasHoy = [{ id: o.id, codigo: o.codigo, titulo: o.titulo, estado: "completada", completadaEn: op.at }, ...(p.hechasHoy ?? []).filter((x: Any) => x.id !== o.id)];
      }
      break;
    case "emergencia.hito":
      if (o) { o.hitos = { ...(o.hitos ?? {}), [String(op.hito)]: true }; tomar(p, o); }
      break;
    case "mop.prerrequisito": {
      const pr = o?.prerrequisitos?.find((x: Any) => x.id === op.prerrequisitoId);
      if (pr) { pr.cumplido = true; pr.referencia = String(op.referencia ?? "").trim(); }
      if (o) tomar(p, o);
      break;
    }
    case "mop.liberacion": {
      const l = o?.liberaciones?.find((x: Any) => x.id === op.liberacionId);
      if (l) {
        const t = String(op.valor ?? "").trim();
        const n = leerNumero(t);
        l.valor = n.tipo === "numero" ? n.valor : t;
        l.medida = !!t;
        l.conforme = conformeDe(l, t);
      }
      break;
    }
    case "mop.reversa":
      if (o) o.reversa = { ...(o.reversa ?? {}), ejecutada: true };
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
const inicioDe = (r: Any) => Date.parse(`${r.fecha}T${r.turno}:00-06:00`);
/**
 * Los turnos que rigen en ese momento. Un cambio de turnos que la jefatura ya
 * hizo pero que todavía no entró viene en «turnosProximos»: rige desde su
 * «desde»; antes, los de «turnos». Sin señal también.
 */
function turnosVigentes(r: Any, ms = Date.now()): string[] {
  const prox = r?.turnosProximos;
  const desde = prox?.desde ? Date.parse(prox.desde) : NaN;
  return Array.isArray(prox?.turnos) && prox.turnos.length && Number.isFinite(desde) && ms >= desde ? prox.turnos : r?.turnos ?? [];
}
/**
 * El turno que corre en ese momento. Un turno de «omite» no se abre: empezaría
 * menos de 2 horas antes del primer turno de la lista nueva, y el que corría
 * sigue hasta ahí. Entonces corre el que corría justo antes de su inicio.
 */
function turnoQueCorre(r: Any, ms = Date.now()): { t: TurnoInfo; turnos: string[] } {
  const omite = new Set((Array.isArray(r?.omite) ? r.omite : []).map((x: Any) => `${x?.fecha} ${x?.turno}`));
  for (let k = 0; ; k++) {
    const turnos = turnosVigentes(r, ms);
    const t = turnoActual(turnos, new Date(ms));
    if (!omite.has(`${t.fecha} ${t.turno}`) || k >= 6) return { t, turnos };
    ms = inicioDe(t) - 1;
  }
}
/** Desde qué turno la sede ya no hace ronda, según la última copia del día (NaN si sigue haciéndola). */
const sinRondaDesde = (r: Any) => (r?.noHaceRondaDesde ? Date.parse(r.noHaceRondaDesde) : NaN);
const yaNoHaceRonda = (r: Any, ms = Date.now()) => ms >= sinRondaDesde(r);
const rondaEmpezada = (r: Any) => r.estado === "en_curso" || Object.keys(r.lecturas ?? {}).length > 0;
/** La ronda que se puede trabajar. Desde que la sede ya no hace ronda, solo la que ya empezó y no se cerró. */
const rondaQueSigue = (r: Any) => (r && yaNoHaceRonda(r) && (r.estado === "completada" || !rondaEmpezada(r)) ? null : r ?? null);
const horaSV = (ms: number) => new Date(ms - 6 * 3_600_000).toISOString().slice(11, 16);
const fraseSinRonda = (r: Any) => (yaNoHaceRonda(r) ? `Desde el turno de ${laHora(horaSV(sinRondaDesde(r)))} esta sede no hace ronda.` : "");
let sinRondaVista = false;
/**
 * Sin señal al cambiar de turno: la misma lista, una ronda nueva. A media ronda se termina con su
 * turno, pero no para siempre. Desde el turno en que la sede ya no hace ronda no se abre una nueva.
 * Dice si Hoy cambió.
 */
function rodarTurno(): boolean {
  const r = E.base?.ronda;
  if (!r?.turnos?.length) return false;
  const sinRonda = yaNoHaceRonda(r);
  const cruzo = sinRonda !== sinRondaVista;
  sinRondaVista = sinRonda;
  if (E.flujo?.tipo === "ronda") {
    if (Date.now() - inicioDe(r) < 16 * 3_600_000) return cruzo;
    soltarPantalla();
    E.flujo = null;
    aviso("Esa ronda ya venció. Lo que anotaste quedó guardado.");
    ir("#hoy", true);
  }
  const { t, turnos } = turnoQueCorre(r);
  // Solo hacia adelante: un turno que ya pasó no vuelve a abrirse.
  if ((t.fecha === r.fecha && t.turno === r.turno) || inicioDe(t) < inicioDe(r)) return cruzo;
  // La sede ya no hace ronda en ese turno: no se abre una nueva; la que ya empezó sigue.
  if (inicioDe(t) >= sinRondaDesde(r)) return cruzo;
  // Si el cambio de turnos ya entró, la lista nueva queda como la de siempre.
  const cambio = turnos !== r.turnos ? { turnos, turnosProximos: null } : {};
  E.base.ronda = { ...r, ...cambio, fecha: t.fecha, turno: t.turno, etiqueta: t.etiqueta, estado: "sin_iniciar", ejecucionId: null, iniciadaEn: null, lecturas: {}, entregaAnterior: null };
  void cola.guardar(`hoy:${UID}`, E.base); // Si el sistema recarga la página, sigue en el turno nuevo.
  rebase();
  return true;
}
function rebase() {
  if (!E.base) { E.p = null; return; }
  E.p = JSON.parse(JSON.stringify(E.base));
  for (const op of E.pend) aplicarLocal(E.p, op);
}

// ── El borrador ─────────────────────────────────────────────────────────────
// Lo escrito (notas de las hojas, «qué encontraste», referencias, lecturas a
// medio escribir, entrega de turno), las fotos ya tomadas y la pantalla con su
// hoja. Se guarda mientras se escribe, por usuario y por orden u hoja. Al enviar
// o al cancelar, se borra.
const BORRADOR = `borrador:${UID}`;
const VIGENCIA_PANTALLA_MS = 12 * 3_600_000;
let borradorListo = false; // Hasta leer el guardado, no se escribe encima.
let tBorrador: ReturnType<typeof setTimeout> | undefined;
function guardarBorrador(ya = false) {
  if (!borradorListo) return;
  clearTimeout(tBorrador);
  if (ya) escribirBorrador();
  else tBorrador = setTimeout(escribirBorrador, 400);
}
function escribirBorrador() {
  clearTimeout(tBorrador);
  tBorrador = undefined;
  if (!borradorListo) return;
  const r = E.p?.ronda;
  const pantalla = { hash: location.hash || "#hoy", vista: E.vista, flujo: E.flujo, hoja: E.hoja, ronda: r ? `${r.fecha}:${r.turno}` : null };
  void cola.guardar(BORRADOR, { notas: E.notas, fotos: E.fotos, saltos: E.saltos, pantalla, en: Date.now() });
}
/** La app se va a segundo plano o a otra página: lo pendiente se escribe ya. */
const asegurarBorrador = () => { if (tBorrador) escribirBorrador(); };
function olvidar(prueba: (clave: string) => boolean) {
  for (const k of Object.keys(E.notas)) if (prueba(k)) delete E.notas[k];
  for (const k of Object.keys(E.fotos)) if (prueba(k)) delete E.fotos[k];
  guardarBorrador();
}
/**
 * Lo escrito en la hoja abierta ya se envió o se canceló. Al cancelar, sus fotos que no han salido
 * tampoco se envían. Al enviarla, sus fotos ya son de lo que se anotó: si la hoja se vuelve a abrir
 * en el mismo paso y se cancela, esas no se tocan.
 */
function olvidarHoja(cancelar = false) {
  const claves = new Set<string>();
  document.querySelectorAll<HTMLElement>("#hoja [data-nota], #hoja [data-clave]").forEach((el) => { const k = el.dataset.nota ?? el.dataset.clave; if (k) claves.add(k); });
  terminarHojas((k) => claves.has(k), cancelar ? "cancelada" : "enviada");
  if (cancelar) descartarFotos(claves);
  else soltarFotos(claves);
  olvidar((k) => claves.has(k));
}
/** Las fotos de una hoja enviada dejan de ser de la hoja, también en la cola guardada: así siguen después de recargar. */
function soltarFotos(claves: Set<string>) {
  for (const op of E.pend) {
    if (op.tipo !== "foto" || !op.clave || !claves.has(op.clave)) continue;
    delete op.clave;
    void cola.poner(op);
  }
}
/** La foto que se está subiendo en este momento: esa ya no se puede retirar. */
let fotoEnVuelo: number | null = null;
/**
 * Una foto tarda en reducirse. Mientras tanto ya es de la hoja donde se tomó: si esa hoja se envía, la
 * foto es de lo anotado; si se cancela, no se envía. Una hoja vive desde su primera foto hasta que se
 * envía o se cancela; la que se abre después en el mismo paso es otra.
 */
type HojaViva = { fin: "" | "enviada" | "cancelada" };
const hojasVivas = new Map<string, HojaViva>();
function hojaViva(clave: string): HojaViva {
  let h = hojasVivas.get(clave);
  if (!h) hojasVivas.set(clave, (h = { fin: "" }));
  return h;
}
function terminarHojas(prueba: (clave: string) => boolean, fin: "enviada" | "cancelada") {
  for (const [k, h] of hojasVivas) if (prueba(k)) { h.fin = fin; hojasVivas.delete(k); }
}
/**
 * El lugar en la cola de las fotos que todavía se reducen: lo que se hace después sale después de ellas.
 * Si una no termina en LIMITE_FOTO_MS, la cola sigue sin esperarla.
 */
const apartadas = new Set<number>();
const LIMITE_FOTO_MS = 30000;
const esperaUnaFoto = (op: Op) => apartadas.size > 0 && op.seq > Math.min(...apartadas);
/** «Cancelar» una hoja: sus fotos que todavía no salieron se quitan de la cola, para que la hoja diga lo que de verdad se envía. */
function descartarFotos(claves: Set<string>) {
  const tomadas = [...claves].reduce((n, k) => n + (E.fotos[k] ?? 0), 0);
  const quitar = E.pend.filter((op) => op.tipo === "foto" && claves.has(op.clave ?? "") && op.seq !== fotoEnVuelo);
  if (quitar.length) {
    const seqs = new Set(quitar.map((op) => op.seq));
    E.pend = E.pend.filter((op) => !seqs.has(op.seq));
    for (const op of quitar) void cola.quitar(op.seq);
    refrescarPill();
  }
  const salieron = tomadas - quitar.length;
  if (salieron > 0) aviso(salieron === 1 ? "Esa foto ya se había enviado: queda en la orden." : `${salieron} fotos ya se habían enviado: quedan en la orden.`);
}
const DE_ORDEN = /^(fin|problema|nopudo|lect|ref|lib|reversa|pausa):(\d+)(?::|$)/;
/** La orden se envió: nada de lo que se escribió en ella sigue en el celular. */
function olvidarDeOrden(id: number) {
  delete E.saltos[`pre:${id}`];
  delete E.saltos[`lib:${id}`];
  const deEsta = (k: string) => DE_ORDEN.exec(k)?.[2] === String(id);
  terminarHojas(deEsta, "enviada");
  olvidar(deEsta);
}

// ── Enviar ──────────────────────────────────────────────────────────────────
const nuevoSeq = () => (E.ultimoSeq = Math.max(E.ultimoSeq + 1, Date.now()));
async function despachar(parcial: Partial<Op> & { tipo: string }, at?: string) {
  const op: Op = { seq: nuevoSeq(), uid: UID, opId: uuid(), at: at ?? new Date().toISOString(), ...parcial };
  await meter(op);
  void drenar();
  return op;
}
/** La operación entra a la cola en su lugar, por su número, y se aplica en pantalla. */
async function meter(op: Op) {
  // De qué orden es y qué se hizo, con el nombre que tiene ahora: si después la orden deja de ser del
  // técnico y el servidor no acepta el registro, «Ver por qué» la sigue nombrando igual.
  if (op.ordenId) op.rotulo = { que: describirOp(op), accion: queHizo(op) };
  const i = E.pend.findIndex((x) => x.seq > op.seq);
  if (i < 0) E.pend.push(op); else E.pend.splice(i, 0, op);
  aplicarLocal(E.p, op);
  refrescarPill();
  if (E.pend.length === 1) void cola.pedirPersistencia();
  await cola.poner(op);
}

// Un rechazo puede llegar cuando la orden ya salió de la lista de trabajo (al terminarla, por
// ejemplo): por eso se busca también en lo terminado y en la última copia del servidor. Primero
// la orden completa, que trae su documento y su equipo; si no, lo terminado.
const ordenParaNombrar = (id: number) => {
  const en = (claves: string[]) => [E.base, E.p].flatMap((p: Any) => claves.flatMap((k) => p?.[k] ?? [])).find((o: Any) => o.id === id);
  return en(["ordenes", "libres"]) ?? en(["hechasHoy", "porVerificar"]);
};

/** De qué es el registro: la orden con su código y su nombre, para saber cuál abrir. */
const describirOp = (op: Any) => {
  if (op.tipo?.startsWith("ronda.")) return "Ronda";
  if (op.tipo === "emergencia.abrir") return corto(op.titulo || "Emergencia nueva", 70);
  if (op.tipo === "correctivo.abrir") return corto(op.titulo || "Correctivo nuevo", 70);
  if (op.tipo === "aop.abrir") return "Desviación";
  if (op.ordenId) {
    const o = ordenParaNombrar(op.ordenId);
    return o ? `${etiquetaOT(o)} · ${corto(o.modo ? tituloOrden(o) : limpiarTitulo(o.titulo), 60)}` : etiquetaOT({ id: op.ordenId });
  }
  return op.tipo?.startsWith("orden.") ? "Orden" : "Registro";
};
const QUE_HIZO: Record<string, string> = {
  "orden.iniciar": "Empezar", "orden.pausar": "Pausar", "orden.reanudar": "Reanudar", "orden.terminar": "Enviar a verificación",
  "mop.prerrequisito": "Permiso", "mop.liberacion": "Lectura de liberación", "mop.reversa": "Plan de reversa", foto: "Foto",
  "emergencia.abrir": "Abrir la emergencia", "correctivo.abrir": "Abrir el correctivo", "aop.abrir": "Abrir la desviación",
  "ronda.iniciar": "Empezar la ronda", "ronda.lectura": "Parada", "ronda.cerrar": "Cerrar la ronda",
};
/** Qué se intentó registrar. */
const queHizo = (op: Any) => {
  if (op.tipo === "orden.paso") return `${ordenParaNombrar(op.ordenId)?.modo === "emergencia" ? "Acción" : "Paso"} ${Number(op.idx) + 1}`;
  if (op.tipo === "emergencia.hito") return op.hito === "llegada" ? "Llegada al sitio" : op.hito === "mitigacion" ? "Controlado" : "Restablecido";
  return QUE_HIZO[op.tipo] ?? "Registro";
};
/**
 * Un registro que el servidor no aceptó devuelve al borrador lo que el técnico
 * escribió en él: lo encuentra en su orden u hoja, lo corrige y lo vuelve a
 * enviar. Si ya escribió algo nuevo ahí, se queda lo nuevo; lo de antes sigue a
 * la vista en «Ver por qué».
 */
function devolverAlBorrador(op: Op): string {
  const b = op.borrador;
  if (!b) return "";
  let principal = "";
  for (const [clave, texto] of Object.entries(b.notas ?? {})) {
    if (!texto) continue;
    principal ||= texto;
    if (!String(E.notas[clave] ?? "").trim()) E.notas[clave] = texto;
  }
  for (const [clave, ids] of Object.entries(b.saltos ?? {})) E.saltos[clave] = [...new Set([...(E.saltos[clave] ?? []), ...ids])];
  guardarBorrador(true);
  return principal;
}

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
  let baseCambio = false;
  // Lo que el servidor ya aceptó queda también en la copia guardada del día: si la página se
  // recarga sin señal antes de traer el paquete nuevo, no reaparece como pendiente. A media
  // ronda, tras un cambio de turno, el paquete nuevo tampoco lo trae.
  const quitarOp = async (op: Op, aceptada: boolean) => {
    E.pend = E.pend.filter((x) => x.seq !== op.seq);
    if (aceptada && E.base && !CREAN_ORDEN.includes(op.tipo)) { aplicarLocal(E.base, op); baseCambio = true; }
    await cola.quitar(op.seq);
  };
  let huboTexto = false;
  const nuevos: Any[] = [];
  const rechazar = (op: Op, error?: string) => {
    huboRechazo = true;
    const texto = devolverAlBorrador(op);
    if (texto) huboTexto = true;
    const x = { que: op.rotulo?.que ?? describirOp(op), accion: op.rotulo?.accion ?? queHizo(op), error: error ?? "No se pudo guardar.", at: op.at, ordenId: op.ordenId ?? null, ...(texto ? { texto } : {}) };
    E.rechazos.push(x);
    nuevos.push(x);
  };
  try {
    while (E.pend.length) {
      const primero = E.pend[0];
      // Una foto que todavía se reduce va antes: lo que sigue la espera.
      if (esperaUnaFoto(primero)) break;
      if (primero.tipo === "foto") {
        fotoEnVuelo = primero.seq;
        const r = await enviarFoto(primero).finally(() => { fotoEnVuelo = null; });
        if (r.status === 401) { E.sesionVencida = true; break; }
        if (r.status >= 500) { fallo = true; break; }
        if (!r.ok) rechazar(primero, r.error);
        await quitarOp(primero, r.ok);
      } else {
        const lote: Op[] = [];
        for (const op of E.pend) { if (op.tipo === "foto" || lote.length >= 20 || esperaUnaFoto(op)) break; lote.push(op); }
        const res = await fetch("/api/campo/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reloj: new Date().toISOString(), ops: lote.map(({ blob, seq, uid, borrador, rotulo, ...resto }) => resto) }) });
        if (res.status === 401) { E.sesionVencida = true; break; }
        if (!res.ok) { fallo = true; break; }
        const j: Any = await res.json();
        for (const r of j.resultados ?? []) {
          const op = lote.find((x) => x.opId === r.opId);
          if (!op) continue;
          if (!r.ok) rechazar(op, r.error);
          await quitarOp(op, !!r.ok);
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
  if (baseCambio) void cola.guardar(`hoy:${UID}`, E.base);
  if (huboRechazo) {
    void cola.guardar(`rechazos:${UID}`, E.rechazos);
    aviso(huboTexto ? "El servidor no aceptó un registro. Lo que escribiste volvió a su orden: revísalo en Hoy." : "El servidor no aceptó un registro. Revísalo en Hoy.");
    void explicarRechazos(nuevos);
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

/**
 * Por qué ya no se puede trabajar la orden de un registro que el servidor no aceptó: se le pregunta al
 * servidor, con señal. Si no está a nombre del técnico, se reasignó; si se canceló, se canceló; si ya
 * se envió, se cerró o ya no existe, ya no se puede trabajar en el celular. Sin respuesta, se pregunta
 * otra vez al abrir «Ver por qué».
 */
async function explicarRechazos(registros: Any[]) {
  const ids = [...new Set(registros.filter((x) => x.ordenId && !x.motivo).map((x) => Number(x.ordenId)))].slice(0, 5);
  let cambio = false;
  for (const id of ids) {
    const r = await pedirOrden(id, LIMITE_ORDEN_MS);
    const deEsta = E.rechazos.filter((x) => Number(x.ordenId) === id && !x.motivo);
    const motivo = motivoDe(r, deEsta);
    if (!motivo) continue;
    // Sigue en curso: queda en el celular, para abrirla desde «Ver por qué».
    if (r.tipo === "orden" && motivo === "en_curso") ponerEnBase(r.orden);
    for (const x of deEsta) x.motivo = motivo;
    cambio ||= deEsta.length > 0;
  }
  if (!cambio) return;
  void cola.guardar(`rechazos:${UID}`, E.rechazos);
  if (E.hoja?.tipo === "rechazos") pintarHoja();
}
/** Por qué ya no se trabaja la orden, según lo que respondió el servidor. Vacío si no respondió. */
function motivoDe(r: Pedido, registros: Any[]): string {
  if (r.tipo === "orden") return EN_CURSO.includes(r.orden.estado) ? "en_curso" : r.orden.estado === "cancelada" ? "cancelada" : "otro";
  if (r.tipo === "no" && r.status === 404) return registros.some((x) => /ya no existe/.test(x.error ?? "")) ? "otro" : "reasignada";
  return "";
}
/**
 * Las órdenes que «Ver por qué» dejó en el celular por seguir en curso y que el día ya no trae se piden otra vez
 * cada vez que baja el día. Si ya no están en curso (la jefatura la canceló, por ejemplo), el motivo cambia como
 * en «Ver por qué» y la copia se quita, salvo la que el técnico tiene abierta; si siguen, queda la copia nueva.
 * Sin respuesta, se quedan como estaban.
 */
async function revisarEnCurso(ids: number[]) {
  let cambio = false;
  for (const id of ids.slice(0, 5)) {
    const r = await pedirOrden(id, LIMITE_ORDEN_MS);
    const deEsta = E.rechazos.filter((x) => Number(x.ordenId) === id && x.motivo === "en_curso");
    const motivo = motivoDe(r, deEsta);
    if (!motivo || !deEsta.length) continue;
    if (r.tipo === "orden" && motivo === "en_curso") { ponerEnBase(r.orden); continue; }
    for (const x of deEsta) x.motivo = motivo;
    if (location.hash !== `#orden-${id}`) quitarDeBase(id);
    cambio = true;
  }
  if (!cambio) return;
  void cola.guardar(`rechazos:${UID}`, E.rechazos);
  if (E.hoja?.tipo === "rechazos") pintarHoja();
  else repintarSiEsSeguro();
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
    const sinAceptar = enCursoSinAceptar(j);
    for (const o of sinAceptar) (j[o.asignadoA === UID ? "ordenes" : "libres"] ??= []).push(o);
    E.base = j;
    E.sesionVencida = false;
    E.enLinea = true;
    if (!E.sede && j.sedeId) E.sede = j.sedeId;
    if (!E.sede && j.sedes?.length === 1) { E.sede = j.sedes[0].id; void cola.guardar(`sede:${UID}`, E.sede); void refrescarHoy(); }
    void cola.guardar(`hoy:${UID}`, j);
    rebase();
    // La jefatura pudo cancelarla después de «Ver por qué»: se pregunta otra vez.
    if (sinAceptar.length) void revisarEnCurso(sinAceptar.map((o: Any) => o.id));
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
/** Quita el aviso si todavía dice eso: «Abriendo la orden…» no se queda encima de la orden ya abierta. */
function quitarAviso(t: string) {
  const a = $("#aviso");
  if (!a || a.hidden || a.textContent !== t) return;
  clearTimeout(tAviso);
  a.hidden = true;
}

// ── Qué sigue ───────────────────────────────────────────────────────────────
const rondaFaltante = (r: Any) => (r ? r.puntos.findIndex((pt: Any) => !r.lecturas[pt.id]) : -1);
const primerPendiente = (o: Any) => o.pasos.findIndex((p: Any) => p.estado === "pendiente");
const saltado = (clave: string, id: number) => (E.saltos[clave] ?? []).includes(id);
/** Un permiso está listo si se cumplió; uno opcional, también si se saltó. */
const preHecho = (o: Any, k: number) => { const p = o.prerrequisitos[k]; return !!p.cumplido || (!p.obligatorio && saltado(`pre:${o.id}`, p.id)); };
const faltanObligatorios = (o: Any) => (o.prerrequisitos ?? []).some((p: Any) => p.obligatorio && !p.cumplido);
const conRango = (l: Any) => l.min != null || l.max != null;
/**
 * Un paso que pide lectura y no la tiene, como lo juzga el servidor al enviar a verificación: con rango, sin
 * su número (K8); sin rango, sin nada escrito. Un paso que no aplica no se mide.
 */
const pasoSinLectura = (p: Any) => !!p.pideValor && p.estado !== "na" && (conRango(p) ? valorDe(leerNumero(p.valor)) == null : leerNumero(p.valor).tipo === "vacio");
/** Una lectura con mínimo o máximo solo cuenta como medida si trae el número del instrumento: igual que el servidor. */
const medidaConNumero = (l: Any) => !!l.medida && (!conRango(l) || l.conforme != null);
/** Una lectura de liberación queda resuelta si se midió en rango. Una opcional, también fuera de rango o saltada. */
const libHecha = (o: Any, k: number) => {
  const l = o.liberaciones[k];
  if (!l.obligatoria) return !!l.medida || saltado(`lib:${o.id}`, l.id);
  return medidaConNumero(l) && l.conforme !== false;
};

/**
 * La pantalla que le toca a una orden: lo primero que falta, en el orden en que
 * se trabaja. Emergencia: llegar, sus acciones, controlado, restablecido, cierre.
 * Intervención: permisos, empezar, pasos, lecturas de liberación, cierre.
 */
function pantallaDe(o: Any): { vista: string; i: number } {
  if (o.estado === "en_espera") return { vista: "pausa", i: 0 };
  if (o.estado === "abierta" || (o.modo === "emergencia" && !o.hitos?.llegada)) return { vista: "inicio", i: 0 };
  const paso = primerPendiente(o);
  if (paso >= 0) return { vista: "paso", i: paso };
  if (o.modo === "emergencia") {
    if (!o.hitos?.mitigacion) return { vista: "controlado", i: 0 };
    if (!o.hitos?.restablecimiento) return { vista: "normalidad", i: 0 };
  }
  if (o.modo === "intervencion" && !o.reversa?.ejecutada) {
    const k = (o.liberaciones ?? []).findIndex((_: Any, j: number) => !libHecha(o, j));
    if (k >= 0) return { vista: "liberacion", i: k };
  }
  return { vista: "fin", i: 0 };
}
function siguienteOrden(lugar?: string | null) {
  const abiertas = (E.p?.ordenes ?? []).filter((o: Any) => o.estado === "abierta" && o.modo !== "emergencia");
  return abiertas.find((o: Any) => lugar && o.lugar?.ubicacion === lugar) ?? abiertas[0] ?? null;
}
/** La orden que el técnico tiene entre manos, sin contar una emergencia. */
const enCurso = () => (E.p?.ordenes ?? []).find((o: Any) => o.estado === "en_proceso" && o.modo !== "emergencia") ?? null;
const activaCualquiera = () => (E.p?.ordenes ?? []).find((o: Any) => o.estado === "en_proceso") ?? null;

/** Dónde va una orden en curso, sin tiempos. */
function dondeVas(o: Any) {
  if (o.modo === "pasos") {
    const hechos = o.pasos.filter((x: Any) => x.estado !== "pendiente").length;
    return o.pasos.length && hechos >= o.pasos.length ? "Todos los pasos están anotados; falta enviarla." : `${o.pasos.length ? `Paso ${hechos + 1} de ${o.pasos.length}. ` : ""}Sigues justo donde quedaste.`;
  }
  const s = pantallaDe(o);
  if (s.vista === "paso") return `${o.modo === "emergencia" ? "Acción" : "Paso"} ${s.i + 1} de ${o.pasos.length}. Sigues justo donde quedaste.`;
  if (s.vista === "liberacion") return `Lectura de liberación ${s.i + 1} de ${o.liberaciones.length}. Sigues justo donde quedaste.`;
  if (s.vista === "controlado") return "Falta confirmar que está controlado.";
  if (s.vista === "normalidad") return "Falta confirmar que volvió a la normalidad.";
  if (s.vista === "fin") return "Todo está anotado; falta enviarla.";
  return "Sigues justo donde quedaste.";
}

/**
 * Entre varias emergencias, «Ahora» lleva la que el técnico está atendiendo (empezada y sin pausa); si no
 * atiende ninguna, la que vence primero entre las que nadie atiende; si todas están en pausa, la pausada
 * que vence primero. En cada grupo va primero la que vence antes (la que no tiene vencimiento, primero,
 * como las ordena el servidor) y después la más antigua. Las demás siguen en ese orden: dos con su línea
 * debajo y el resto en la lista, con su grupo abierto si nadie la atiende.
 */
const EN_CURSO = ["abierta", "en_proceso", "en_espera"];
const rangoEmergencia = (o: Any) => (o.estado === "en_espera" ? 2 : o.estado === "en_proceso" && o.hitos?.llegada ? 0 : 1);
/** Cuándo vence, para ordenar. Una fecha sola vence al final de ese día. */
const venceEn = (o: Any) => {
  const v = o.vencimiento;
  const ms = v ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59-06:00` : v) : NaN;
  return Number.isFinite(ms) ? ms : -Infinity;
};
const antesVence = (a: Any, b: Any) => { const x = venceEn(a), y = venceEn(b); return x === y ? 0 : x < y ? -1 : 1; };
const emergenciasAbiertas = (p: Any): Any[] => (p.ordenes ?? [])
  .filter((o: Any) => o.tipo === "emergencia" && EN_CURSO.includes(o.estado))
  .sort((a: Any, b: Any) => rangoEmergencia(a) - rangoEmergencia(b) || antesVence(a, b) || a.id - b.id);
const sinAtender = (o: Any) => o.tipo === "emergencia" && EN_CURSO.includes(o.estado) && rangoEmergencia(o) === 1;
/** La marca de un grupo con emergencias que nadie atiende: su clave y cuáles son. Sin ninguna, vacía. */
const marcaDeGrupo = (clave: string, lista: Any[]) => { const ids = lista.filter(sinAtender).map((o: Any) => o.id); return ids.length ? `${clave}|${ids.join(",")}` : ""; };
/** Los grupos con una emergencia sin atender que el técnico cerró, con las que tenían: si llega otra, se abre otra vez. */
const cerradosConEmergencia = new Set<string>();
/** El grupo que empieza abierto, además de los que tienen una emergencia sin atender. */
let grupoPorDefecto: string | null = null;
const LINEAS_EMERGENCIA = 2;
/** Una frase que sigue de otra termina con su punto: si no lo trae, se le pone. Vacía queda vacía. */
const conPunto = (t: string) => { const s = t.trim(); return !s || /[.!?…]$/.test(s) ? s : `${s}.`; };
function lineasDeEmergencias(otras: Any[]): string {
  const lineas = otras.slice(0, LINEAS_EMERGENCIA).map((o) => {
    const rango = rangoEmergencia(o);
    const [que, accion] = rango === 2 ? ["Emergencia en pausa", "Seguir"] : rango === 0 ? ["Otra emergencia en curso", "Seguir"] : ["Otra emergencia sin atender", "Atender"];
    return `<a class="otra" href="#orden-${o.id}" data-a="ir" data-h="#orden-${o.id}">${que}: <b>${esc(corto(tituloOrden(o), 40))}</b> · <span class="accion">${accion}</span></a>`;
  }).join("");
  const mas = otras.length - LINEAS_EMERGENCIA;
  return lineas + (mas > 0 ? `<p class="otra-mas">y ${mas} más en Hoy</p>` : "");
}
function bloqueAhora(): { html: string; ordenId?: number; enAhora: number[]; lleno?: boolean } {
  const p = E.p;
  // Desde el turno en que la sede ya no hace ronda, solo sigue la que ya empezó.
  const r = rondaQueSigue(p.ronda);
  const rondaPendiente = !!r && r.estado !== "completada";
  const sinRonda = fraseSinRonda(p.ronda);
  // Una emergencia va antes que todo, también en pausa. Si el técnico dijo «Todavía no», sigue aquí.
  const emergencias = emergenciasAbiertas(p);
  const emergencia = emergencias[0];
  if (emergencia) {
    const otras = emergencias.slice(1);
    const enPausa = emergencia.estado === "en_espera";
    const empezo = enPausa || (emergencia.estado === "en_proceso" && !!emergencia.hitos?.llegada);
    const etq = ["Emergencia", vencePlazo(emergencia.vencimiento)].filter(Boolean).join(" · ");
    const det = [emergencia.eop?.codigo, emergencia.lugar?.ubicacion ?? emergencia.lugar?.sede].filter(Boolean).join(" · ");
    const donde = enPausa ? `En pausa${emergencia.motivoPausa ? `: ${emergencia.motivoPausa}` : ""}` : empezo ? dondeVas(emergencia) : "";
    // Con «Te la devolvieron», dónde va y por qué se la devolvieron van en un solo párrafo, sin «Sigues justo donde
    // quedaste»; con otras emergencias debajo, en dos líneas como máximo. Así «Ahora» lleno cabe en 360×640.
    // «En pausa: Me pasaron a otra urgencia» se cierra con punto antes de «Te la devolvieron».
    const conDevuelta = emergencia.devuelta ? [conPunto(donde.replace(/ Sigues justo donde quedaste\.$/, "")), `Te la devolvieron: ${emergencia.devuelta}`].filter(Boolean).join(" ") : donde;
    const parrafo = conDevuelta ? `<p class="recorte${emergencia.devuelta && otras.length ? " dos" : ""}">${esc(conDevuelta)}</p>` : "";
    // Con la emergencia ya empezada, la ronda del turno no se pierde de vista.
    const tambien = empezo && rondaPendiente ? `<button class="b2" data-a="ronda">También falta la ronda de ${esc(laHora(r.turno))}</button>` : "";
    return {
      ordenId: emergencia.id,
      enAhora: [emergencia, ...otras.slice(0, LINEAS_EMERGENCIA)].map((o: Any) => o.id),
      // Con otras emergencias debajo, «Ahora» va lleno: en una pantalla baja se compacta para caber sin desplazar.
      lleno: otras.length > 0,
      html: `<span class="etq urgente">${esc(etq)}</span><h2${otras.length ? ' class="recorte dos"' : ""}>${esc(tituloOrden(emergencia))}</h2>${det ? `<p>${esc(det)}</p>` : ""}${parrafo}<button class="b1 claro" data-a="ir" data-h="#orden-${emergencia.id}">${empezo ? "Seguir" : "Atender la emergencia"}</button>${lineasDeEmergencias(otras)}${tambien}`,
    };
  }
  // La ronda es lo primero del turno. Una orden que ya venía de antes espera; si el
  // técnico la empezó en este mismo turno, sigue con ella y la ronda queda a la vista.
  const inicioTurno = r ? inicioDe(r) : 0;
  const activa = enCurso();
  const activaDeEsteTurno = !!activa?.iniciadaEn && Date.parse(activa.iniciadaEn) >= inicioTurno;
  if (activa && (!rondaPendiente || activaDeEsteTurno)) {
    const devuelta = activa.devuelta ? `<p>Te la devolvieron: ${esc(activa.devuelta)}</p>` : "";
    const tambien = rondaPendiente ? `<button class="b2" data-a="ronda">También falta la ronda de ${esc(laHora(r.turno))}</button>` : "";
    return { ordenId: activa.id, enAhora: [activa.id], html: `<span class="etq">Vas aquí</span><h2>${esc(tituloOrden(activa))}</h2><p>${esc(dondeVas(activa))}</p>${devuelta}<button class="b1 claro" data-a="ir" data-h="#orden-${activa.id}">Seguir</button>${tambien}` };
  }
  if (!E.sede) return { enAhora: [], html: `<span class="etq">Antes de empezar</span><h2>¿En qué sede estás hoy?</h2><p>La ronda y los equipos dependen de la sede.</p><button class="b1 claro" data-a="sede">Elegir sede</button>` };
  // En lugar de la ronda que ya no se hace, la frase; la que ya empezó sigue con la frase debajo.
  const frase = sinRonda ? `<p class="sin-ronda">${esc(sinRonda)}</p>` : "";
  if (r && r.estado !== "completada") {
    const hechas = Object.keys(r.lecturas).length;
    if (r.estado === "sin_iniciar" && !hechas) return { enAhora: [], html: `<span class="etq">Lo primero del turno</span><h2>Ronda de ${esc(laHora(r.turno))}</h2><p>${r.puntos.length} paradas</p><button class="b1 claro" data-a="ronda">Empezar la ronda</button>` };
    return { enAhora: [], html: `<span class="etq">Vas aquí</span><h2>Ronda de ${esc(laHora(r.turno))}</h2><p>${hechas} de ${r.puntos.length} paradas. Sigues justo donde quedaste.</p>${frase}<button class="b1 claro" data-a="ronda">Seguir la ronda</button>` };
  }
  const sig = siguienteOrden();
  if (sig) {
    const etq = sig.tipo === "preventivo" ? "Siguiente preventivo" : sig.tipo === "correctivo" ? "Siguiente correctivo" : sig.tipo === "intervencion" ? "Siguiente intervención" : "Siguiente orden";
    // Una intervención no empieza sin sus permisos: el botón lleva a ellos.
    const permisos = sig.modo === "intervencion" ? (sig.prerrequisitos ?? []).filter((x: Any) => x.obligatorio && !x.cumplido).length : 0;
    const det = [subOrden(sig), sig.pasos.length ? `${sig.pasos.length} pasos` : "", permisos ? `${permisos} permiso${permisos === 1 ? "" : "s"} antes de empezar` : ""].filter(Boolean).join(" · ");
    const boton = permisos
      ? `<button class="b1 claro" data-a="ir" data-h="#orden-${sig.id}">Ver los permisos</button>`
      : `<button class="b1 claro" data-a="empezar" data-id="${sig.id}">${ico.play}Empezar</button>`;
    return { ordenId: sig.id, enAhora: [sig.id], html: `${frase}<span class="etq">${etq}</span><h2>${esc(tituloOrden(sig))}</h2><p>${esc(det)}</p>${boton}` };
  }
  return { enAhora: [], html: `${frase}<span class="etq">Lista de hoy</span><h2>No tienes trabajo pendiente</h2><p>Si vas a atender un equipo que no estaba programado, búscalo por su ubicación.</p><a class="b1 claro" href="#buscar" data-a="ir" data-h="#buscar">${ico.lupa}Buscar equipo</a>` };
}

function filaOrden(o: Any) {
  const vence = o.vencimiento && o.vencimiento.slice(0, 10) < hoySV();
  const estado = o.estado === "en_espera" ? `En pausa${o.motivoPausa ? `: ${esc(o.motivoPausa)}` : ""}` : o.estado === "en_proceso" ? "En curso" : o.devuelta ? "Devuelta" : o.vencimiento ? `<span class="${vence ? "vence" : ""}">${vence ? "Vencida" : "Vence"} ${fecha(o.vencimiento)}</span>` : "";
  const tipo = o.modo === "emergencia" ? "Emergencia" : o.modo === "intervencion" ? "Intervención" : "";
  const sub = [tipo, esc(o.activo?.codigo ?? ""), estado].filter(Boolean).join(" · ");
  // Toda orden se trabaja aquí, una cosa por pantalla: ninguna manda a la ficha completa.
  return `<a class="fila sub" href="#orden-${o.id}" data-a="ir" data-h="#orden-${o.id}"><span class="marca"></span><span class="txt"><strong>${esc(tituloOrden(o))}</strong><small>${sub}</small></span>${ico.flecha}</a>`;
}

function grupoHtml(clave: string, titulo: string, cuenta: string, filas: string, abierto: string | null, marca = "") {
  const open = marca ? !cerradosConEmergencia.has(marca) : abierto === clave;
  return `<button class="fila" data-a="grupo" data-g="${esc(clave)}"${marca ? ` data-e="${esc(marca)}"` : ""} aria-expanded="${open}"><span class="txt"><strong>${esc(titulo)}</strong></span><span class="cuenta">${esc(cuenta)}</span>${open ? ico.abajo : ico.flecha}</button>${open ? filas : ""}`;
}

function vHoy() {
  rodarTurno();
  const p = E.p;
  if (!p) {
    if (E.cargando) return `<div class="simple"><p>Cargando tu día…</p></div>`;
    return `<div class="simple"><span class="etq">Sin datos todavía</span><h1>Necesitas señal la primera vez</h1><p>Cuando el celular cargue tu día una vez, podrás seguir trabajando aunque se vaya la señal.</p><button class="b1" data-a="reintentar">Intentar otra vez</button></div>`;
  }
  const ahora = bloqueAhora();
  const enAhora = new Set(ahora.enAhora);
  const grupos = new Map<string, Any[]>();
  // Lo que ya está en «Ahora» no se repite. Las emergencias que no cupieron ahí encabezan la lista, en el orden de «Ahora».
  const emergencias = emergenciasAbiertas(p);
  for (const o of [...emergencias, ...p.ordenes.filter((x: Any) => !emergencias.includes(x))]) {
    if (enAhora.has(o.id)) continue;
    const clave = o.lugar?.ubicacion || o.lugar?.sede || "Sin ubicación";
    grupos.set(clave, [...(grupos.get(clave) ?? []), o]);
  }
  const primero = [...grupos.keys()][0] ?? null;
  // Todo grupo con una emergencia que nadie atiende se ve abierto, también en una pantalla baja.
  const marcas = new Map([...grupos].map(([clave, l]) => [clave, marcaDeGrupo(clave, l)]));
  const marcaLibres = marcaDeGrupo("libres", p.libres ?? []);
  // Otra emergencia de la lista (en pausa, por ejemplo) también deja su grupo abierto; si no, en una pantalla alta, el primero.
  const esEmergencia = (o: Any) => o.tipo === "emergencia";
  const conEmergencia = [...grupos].find(([clave, l]) => !marcas.get(clave) && l.some(esEmergencia))?.[0] ?? null;
  const hayEmergencia = !!marcaLibres || [...grupos.values()].some((l) => l.some(esEmergencia));
  grupoPorDefecto = conEmergencia ?? (!hayEmergencia && primero && window.innerHeight >= 700 ? primero : null);
  const abierto = E.grupo === "__ninguno" ? null : E.grupo ?? grupoPorDefecto;
  let filas = "";
  for (const [clave, lista] of grupos) filas += grupoHtml(clave, clave, `${lista.length} por hacer`, lista.map(filaOrden).join(""), abierto, marcas.get(clave));
  if (p.locales?.length) filas += grupoHtml("locales", "Guardadas en tu celular", `${p.locales.length} por enviar`, p.locales.map((l: Any) => `<div class="fila sub"><span class="marca"></span><span class="txt"><strong>${esc(l.titulo)}</strong><small>Se envía sola cuando vuelva la señal</small></span></div>`).join(""), abierto);
  if (p.desviaciones?.length) {
    filas += grupoHtml("aop", "Desviaciones abiertas", `${p.desviaciones.length} con reloj`, p.desviaciones.map((d: Any) => `<a class="fila sub" href="/aop/${d.id}" data-fuera><span class="txt"><strong>${esc(d.codigo ?? "AOP")}${d.sala ? ` · ${esc(d.sala)}` : ""}</strong><small>${d.escalarAntesDe ? `Escalar antes de ${horaDePlazo(d.escalarAntesDe)}` : esc(d.titulo ?? "")}</small></span>${ico.flecha}</a>`).join(""), abierto);
  }
  if (p.tickets?.length) filas += grupoHtml("tickets", "Reportes asignados", `${p.tickets.length} por atender`, p.tickets.map((t: Any) => `<a class="fila sub" href="/tickets/${t.id}" data-fuera><span class="txt"><strong>${esc(t.asunto)}</strong><small>${esc([t.solicitante, t.sede].filter(Boolean).join(" · "))}</small></span>${ico.flecha}</a>`).join(""), abierto);
  if (p.libres?.length) filas += grupoHtml("libres", "Sin asignar en esta sede", `${p.libres.length} para tomar`, p.libres.map(filaOrden).join(""), abierto, marcaLibres);
  if (p.porVerificar?.length) filas += grupoHtml("verificar", "Por verificar", `${p.porVerificar.length} te tocan`, p.porVerificar.map((o: Any) => `<a class="fila sub" href="/ordenes/${o.id}?completa=1" data-fuera><span class="txt"><strong>${esc(limpiarTitulo(o.titulo))}</strong><small>${esc(etiquetaOT(o))}</small></span>${ico.flecha}</a>`).join(""), abierto);
  if (p.hechasHoy?.length) filas += grupoHtml("hechas", "Terminadas hoy", String(p.hechasHoy.length), p.hechasHoy.map((o: Any) => `<div class="fila sub"><span class="marca si">${ico.check}</span><span class="txt"><strong>${esc(limpiarTitulo(o.titulo))}</strong><small>${esc(etiquetaOT(o))}</small></span></div>`).join(""), abierto);

  const nombreSede = p.sedes?.find((s: Any) => s.id === E.sede)?.nombre;
  const fechaLarga = new Date().toLocaleDateString("es-SV", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
  // Desde el turno en que la sede ya no hace ronda, el turno de la copia ya no es el que corre.
  const turno = p.ronda?.turno && !yaNoHaceRonda(p.ronda) ? ` · turno ${esc(p.ronda.turno)}` : "";
  const avisos = (E.sesionVencida ? `<div class="avisito"><span>Tu sesión venció.${E.pend.length ? ` ${E.pend.length} registros esperan.` : ""}</span><a class="link" href="/login?next=/campo">Entrar</a></div>` : "")
    + (E.rechazos.length ? `<div class="avisito"><span>${E.rechazos.length} registro${E.rechazos.length === 1 ? "" : "s"} sin aceptar</span><button class="link" data-a="verRechazos">Ver por qué</button></div>` : "");
  // Con un aviso arriba y «Ahora» lleno, en una pantalla baja el saludo deja su lugar (campo.css): todo «Ahora» queda a la vista.
  return `<div class="hoy-cab${avisos && ahora.lleno ? " compacta" : ""}"><div><span class="etq">${esc(fechaLarga)}${turno}</span><h1>Hola, ${esc(primerNombre(p.usuario?.nombre ?? NOMBRE))}</h1>${nombreSede ? `<button class="sede-btn" data-a="sede">${esc(nombreSede)}${ico.abajo}</button>` : ""}</div><span id="senal">${pillHtml()}</span></div>`
    + avisos
    + `<div class="ahora${ahora.lleno ? " lleno" : ""}">${ahora.html}</div>`
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
    aviso(ABRIENDO);
    void traerOrden(id);
    return;
  }
  // Una copia guardada por la versión anterior no dice cómo se trabaja la orden: se pide de nuevo, una vez.
  if (o.modo === "ficha") {
    E.vista = "hoy";
    if (E.enLinea && !refrescadas.has(id)) { refrescadas.add(id); aviso(ABRIENDO); void traerOrden(id); return; }
    aviso("Esta orden necesita señal para abrirse. Tu trabajo aquí sigue guardándose.");
    history.replaceState({}, "", "#hoy");
    pintar();
    return;
  }
  // Una emergencia que llegó sin su documento ni sus acciones se abre enseguida con lo que hay, y se
  // pide de nuevo por detrás, una vez: el servidor la resuelve por su equipo. Sin señal, o si tampoco
  // las trae, se trabaja así.
  if (o.modo === "emergencia" && !o.eop?.codigo && !o.pasos?.length && E.enLinea && !refrescadas.has(id)) completarPorDetras(id);
  if (!EN_CURSO.includes(o.estado)) {
    E.restaurar = null;
    aviso("Esa orden ya se envió a verificación.");
    history.replaceState({}, "", "#hoy");
    E.vista = "hoy";
    pintar();
    return;
  }
  let s = pantallaDe(o);
  // Al volver a la app: la misma pantalla y la misma hoja, si todavía tienen sentido.
  const previo = tomarRestauracion();
  E.restaurar = null;
  // K17 y K19 · Desde «Ver por qué», el paso que cambió en la ficha, como está guardado. En pausa, después de reanudar.
  const alPaso = irAlPaso?.hash === `#orden-${id}` ? irAlPaso.i : null;
  if (s.vista !== "pausa") irAlPaso = null;
  if (alPaso !== null && s.vista !== "pausa" && pantallaValida(o, "paso", alPaso)) s = { vista: "paso", i: alPaso };
  else {
    if (previo?.flujo?.tipo === "pm" && previo.flujo.ordenId === id && s.vista !== "pausa" && pantallaValida(o, previo.vista, previo.flujo.i)) s = { vista: previo.vista, i: previo.flujo.i };
    if (previo?.hoja && previo.vista === s.vista && (previo.flujo?.i ?? 0) === s.i) E.hojaPendiente = previo.hoja;
  }
  irAPantalla(o, s);
}
/** Una pantalla guardada sigue valiendo si la orden todavía está en ese punto. */
function pantallaValida(o: Any, vista: string, i: number) {
  const dentro = (l: Any[] | undefined) => Number.isInteger(i) && i >= 0 && i < (l?.length ?? 0);
  if (vista === "permiso") return o.estado === "abierta" && dentro(o.prerrequisitos);
  if (o.estado !== "en_proceso" || (o.modo === "emergencia" && !o.hitos?.llegada)) return false;
  if (vista === "paso") return dentro(o.pasos);
  if (vista === "liberacion") return !o.reversa?.ejecutada && dentro(o.liberaciones);
  if (vista === "controlado") return o.modo === "emergencia" && !o.hitos?.mitigacion;
  if (vista === "normalidad") return o.modo === "emergencia" && !!o.hitos?.mitigacion && !o.hitos?.restablecimiento;
  return vista === "fin";
}
function irAPantalla(o: Any, s: { vista: string; i: number }) {
  E.params = { id: o.id };
  E.flujo = s.vista === "inicio" || s.vista === "pausa" ? null : { tipo: "pm", ordenId: o.id, i: s.i };
  E.vista = s.vista;
  if (E.flujo) mantenerPantalla();
  pintar();
}
/** Después de un toque: lo que sigue en la orden. */
function seguirOrden(id: number) {
  E.hoja = null;
  soltarHistorialDeHoja();
  const o = ordenDe(id);
  if (!o) { E.flujo = null; ir("#hoy", true); return; }
  irAPantalla(o, pantallaDe(o));
}
/** Las órdenes que ya se pidieron de nuevo en esta sesión: cada una, una sola vez. */
const refrescadas = new Set<number>();
/** Lo que se espera a una orden que se pide por detrás, con su copia ya abierta. */
const LIMITE_POR_DETRAS_MS = 4000;
/** Lo que se espera a una orden que no está en el celular. */
const LIMITE_ORDEN_MS = 12000;
const ABRIENDO = "Abriendo la orden…";
type Pedido = { tipo: "orden"; orden: Any } | { tipo: "sesion" } | { tipo: "no"; status: number } | { tipo: "red" } | { tipo: "tarde" };
/** Pide una orden al servidor, con un límite: con la señal lenta, el celular no se queda esperando. */
async function pedirOrden(id: number, limiteMs: number): Promise<Pedido> {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tarde = new Promise<Pedido>((res) => { reloj = setTimeout(() => { ctl?.abort(); res({ tipo: "tarde" }); }, limiteMs); });
  const pedido = (async (): Promise<Pedido> => {
    try {
      const r = await fetch(`/api/campo/ordenes?id=${id}`, ctl ? { signal: ctl.signal } : {});
      if (r.status === 401) return { tipo: "sesion" };
      if (!r.ok) return { tipo: "no", status: r.status };
      const j: Any = await r.json();
      return j?.orden ? { tipo: "orden", orden: j.orden } : { tipo: "no", status: 404 };
    } catch {
      return { tipo: "red" };
    }
  })();
  try { return await Promise.race([pedido, tarde]); } finally { clearTimeout(reloj); }
}
/**
 * Las órdenes de la copia del día que siguen en curso según «Ver por qué» y que el paquete nuevo ya no trae (la
 * jefatura la dejó sin asignar, por ejemplo): siguen en el celular, para abrirlas desde ahí, hasta «Entendido».
 */
function enCursoSinAceptar(nuevo: Any): Any[] {
  const ids = new Set(E.rechazos.filter((x) => x.motivo === "en_curso").map((x) => Number(x.ordenId)));
  if (!ids.size) return [];
  const trae = new Set([...(nuevo.ordenes ?? []), ...(nuevo.libres ?? [])].map((o: Any) => o.id));
  return [...(E.base?.ordenes ?? []), ...(E.base?.libres ?? [])].filter((o: Any) => ids.has(o.id) && !trae.has(o.id));
}
/** La orden que llegó del servidor queda en la copia del día, en la lista que le toca, y se guarda. */
function ponerEnBase(orden: Any) {
  if (!E.base) return;
  for (const k of ["ordenes", "libres"]) E.base[k] = (E.base[k] ?? []).filter((x: Any) => x.id !== orden.id);
  E.base[orden.asignadoA === UID ? "ordenes" : "libres"]?.push(orden);
  void cola.guardar(`hoy:${UID}`, E.base);
  rebase();
}
/** La orden que ya no se trabaja sale de la copia del día, y se guarda. */
function quitarDeBase(id: number) {
  if (!E.base) return;
  for (const k of ["ordenes", "libres"]) E.base[k] = (E.base[k] ?? []).filter((x: Any) => x.id !== id);
  void cola.guardar(`hoy:${UID}`, E.base);
  rebase();
}
/**
 * Una emergencia que llegó sin su documento ya está abierta con lo que había; se pide de nuevo por
 * detrás. Si llega a tiempo y el técnico sigue en su inicio sin haberla empezado, se repinta con su
 * documento. La que ya empezó se queda como la empezó: el servidor guarda las acciones que él vio.
 */
function completarPorDetras(id: number) {
  refrescadas.add(id);
  void pedirOrden(id, LIMITE_POR_DETRAS_MS).then((r) => {
    if (r.tipo === "red") E.enLinea = false;
    if (r.tipo === "sesion") { E.sesionVencida = true; refrescarPill(); }
    if (r.tipo !== "orden" || !EN_CURSO.includes(r.orden.estado)) return;
    const o = ordenDe(id);
    if (!o || o.estado === "en_espera" || o.hitos?.llegada || E.pend.some((op) => op.ordenId === id)) return;
    ponerEnBase(r.orden);
    if (E.vista === "inicio" && E.params?.id === id && !E.hoja && location.hash === `#orden-${id}`) pintar();
  });
}
/**
 * Pide una orden que no está en el celular, o que la copia vieja no sabe trabajar. Mientras llega, el
 * técnico puede irse a otra cosa: solo se abre si sigue esperándola, en su dirección.
 */
async function traerOrden(id: number) {
  const r = await pedirOrden(id, LIMITE_ORDEN_MS);
  quitarAviso(ABRIENDO);
  const espera = location.hash === `#orden-${id}` && E.vista === "hoy" && !E.hoja;
  if (r.tipo === "orden" && EN_CURSO.includes(r.orden.estado)) {
    ponerEnBase(r.orden);
    if (espera) abrirOrden(id);
    return;
  }
  if (r.tipo === "red") E.enLinea = false;
  if (r.tipo === "sesion") E.sesionVencida = true;
  if (!espera) { refrescarPill(); return; }
  // Ninguna orden se trabaja fuera del celular: si no se puede abrir, se dice aquí.
  if (r.tipo !== "sesion") {
    aviso(r.tipo === "orden" ? "Esa orden ya se envió a verificación."
      : r.tipo === "red" ? "Esa orden no está en tu celular. Necesita señal."
      : r.tipo === "tarde" ? "La orden no llegó: la señal está lenta. Intenta otra vez."
      : r.status === 404 ? "Esa orden ya no está disponible para ti." : "No se pudo abrir esa orden. Intenta otra vez.");
  }
  history.replaceState({}, "", "#hoy");
  pintar();
}

/**
 * Una pantalla de una sola cosa, sin scroll de página: un texto muy largo se
 * recorta o se desplaza dentro de su caja, y el botón principal queda fijo
 * abajo, al alcance del pulgar.
 */
const marco = (cuerpo: string, pie: string) => `<div class="marco"><div class="final marco-cuerpo">${cuerpo}</div><div class="paso-pie">${pie}</div></div>`;
const volverAHoy = `<a class="b2" href="#hoy" data-a="ir" data-h="#hoy">Volver a Hoy</a>`;
/** Un dato con su etiqueta. Lo largo se recorta a tres líneas; al tocarlo se ve entero, dentro de su caja. */
const dato = (etq: string, valor: string, clase = "") => `<div class="dato${clase ? ` ${clase}` : ""}"><span class="etq">${esc(etq)}</span><b class="recorte" data-a="verTodo">${esc(valor)}</b></div>`;

function vInicio() {
  const o = ordenDe(E.params.id);
  if (!o) return vHoy();
  if (o.modo === "emergencia") return vInicioEmergencia(o);
  if (o.modo === "intervencion") return vInicioIntervencion(o);
  const dets = [o.tipo === "preventivo" ? "Preventivo" : o.tipo === "correctivo" ? "Correctivo" : o.tipo, o.vencimiento ? `vence ${fecha(o.vencimiento)}` : ""].filter(Boolean).join(" · ");
  const mats = [...new Set(o.pasos.map((p: Any) => p.materiales).filter(Boolean))] as string[];
  return marco(`<span class="etq">${esc(dets)}</span><h1 class="recorte">${esc(tituloOrden(o))}</h1><p class="ayuda">${esc([o.activo?.codigo, o.lugar?.ubicacion, o.lugar?.sede].filter(Boolean).join(" · "))}</p>`
    + (o.descripcion ? dato("Lo que pidieron", o.descripcion) : "")
    + dato("Trabajo", o.pasos.length ? `${o.pasos.length} pasos` : "Sin lista de pasos")
    + (mats.length ? dato("Lleva contigo", mats.join(" · ")) : ""),
    `<button class="b1" data-a="empezar" data-id="${o.id}">${ico.play}Empezar</button>${volverAHoy}`);
}
/** La emergencia empieza cuando el técnico llega: ese toque fija la hora de llegada. Arriba, su plazo. */
function vInicioEmergencia(o: Any) {
  const llego = !!o.hitos?.llegada;
  const lugar = lugarDe(o);
  const equipo = o.activo ? [o.activo.codigo, o.activo.nombre].filter(Boolean).join(" · ") : "";
  const etq = ["Emergencia", vencePlazo(o.vencimiento)].filter(Boolean).join(" · ");
  return marco(`<span class="etq urgente">${esc(etq)}</span>`
    + (o.eop?.codigo ? `<span class="cod">${esc(o.eop.codigo)}</span>` : "")
    + `<h1 class="recorte">${esc(tituloOrden(o))}</h1>`
    + (lugar ? dato("Lugar", lugar) : "")
    + (equipo ? dato("Equipo", equipo) : "")
    + (o.descripcion ? dato("Lo que reportaron", o.descripcion) : "")
    + (o.devuelta ? dato("Te la devolvieron", o.devuelta) : ""),
    `<button class="b1" data-a="llegue" data-id="${o.id}">${llego ? `${ico.play}Seguir` : "Ya estoy en el sitio"}</button>${volverAHoy}`);
}
/**
 * Antes de empezar, los permisos: cuántos van y uno solo a la vista, el que
 * sigue, con su texto. Cada uno se registra en su pantalla. «Empezar» aparece
 * cuando los obligatorios están cumplidos.
 */
function vInicioIntervencion(o: Any) {
  const pre: Any[] = o.prerrequisitos ?? [];
  const faltan = faltanObligatorios(o);
  const k = pre.findIndex((_: Any, j: number) => !preHecho(o, j));
  const sig = k >= 0 ? pre[k] : null;
  const n = pre.length;
  const cumplidos = pre.filter((p: Any) => p.cumplido).length;
  const saltados = pre.filter((p: Any) => !p.cumplido && !p.obligatorio && saltado(`pre:${o.id}`, p.id)).length;
  const avance = `${cumplidos} de ${n} permiso${n === 1 ? "" : "s"} cumplido${n === 1 ? "" : "s"}${saltados ? ` · ${saltados} opcional${saltados === 1 ? "" : "es"} saltado${saltados === 1 ? "" : "s"}` : ""}`;
  const dets = ["Intervención", o.vencimiento ? `vence ${fecha(o.vencimiento)}` : ""].filter(Boolean).join(" · ");
  const permisos = n
    ? `<div class="permisos"><span class="etq">Antes de empezar, los permisos</span>${segmentos(n, k, (j) => preHecho(o, j), "linea")}<p class="avance">${esc(avance)}</p>`
      + (sig
        ? `<button class="perm" data-a="verPermiso" data-i="${k}"><span class="txt"><strong class="recorte">${esc(sig.texto)}</strong><small>${sig.obligatorio ? "Sigue este. Es obligatorio." : "Sigue este. Es opcional."}</small></span>${ico.flecha}</button>`
        : `<button class="link" data-a="verPermiso" data-i="0" style="align-self:flex-start">Revisar los permisos</button>`)
      + `</div>`
    : "";
  const boton = faltan
    ? `<button class="b1" data-a="verPermiso" data-i="${k < 0 ? 0 : k}">${cumplidos ? "Seguir con los permisos" : "Registrar los permisos"}</button>`
    : `<button class="b1" data-a="empezar" data-id="${o.id}">${ico.play}Empezar</button>`;
  return marco(`<span class="etq">${esc(dets)}</span><h1 class="recorte">${esc(tituloOrden(o))}</h1><p class="ayuda">${esc([o.activo?.codigo, o.lugar?.ubicacion, o.lugar?.sede].filter(Boolean).join(" · "))}</p>`
    + (o.descripcion ? dato("Lo que pidieron", o.descripcion, "solo-alto") : "")
    + (o.devuelta ? dato("Te la devolvieron", o.devuelta) : "")
    + permisos,
    `${boton}${volverAHoy}`);
}

function vPausa() {
  const o = ordenDe(E.params.id);
  if (!o) return vHoy();
  return marco(`<span class="etq">En pausa</span><h1 class="recorte">${esc(tituloOrden(o))}</h1>`
    + (o.motivoPausa ? dato("Motivo", o.motivoPausa) : ""),
    `<button class="b1" data-a="reanudar" data-id="${o.id}">${ico.play}Reanudar</button>${volverAHoy}`);
}

/** El campo de una lectura. Lo que se escribió a medias vuelve a estar ahí. */
function lecturaHtml(p: Any, previo: unknown, clave: string, normal = rangoDe(p), libre = false) {
  const u = p.unidad ? ` en ${esc(p.unidad)}` : "";
  return `<label class="etq" for="lectura">Lectura${u}</label>`
    + `<div class="lect-caja${libre ? " texto" : ""}"><input id="lectura" data-nota="${esc(clave)}" inputmode="${libre ? "text" : "decimal"}" autocomplete="off" enterkeyhint="done" value="${esc(E.notas[clave] ?? (previo == null ? "" : comoTexto(previo)))}"><span>${esc(p.unidad ?? "")}</span></div>`
    + ((normal || p.ultima) ? `<div class="lect-info">${normal ? `<span>Normal: <b>${esc(normal)}</b></span>` : ""}${p.ultima ? `<span>Última vez: <b>${esc(p.ultima)}${p.unidad ? ` ${esc(p.unidad)}` : ""}</b></span>` : ""}</div>` : "")
    + `<div class="lect-estado" id="lect-estado" aria-live="polite"></div>`;
}

/** La línea 1 del SOP: lo que dejó el turno anterior y lo que sigue abierto en esta sede. */
function bitacoraHtml(r: Any) {
  const e = r.entregaAnterior;
  if (!E.enLinea && !e) return `<p class="ayuda">Sin señal: la entrega del turno anterior y las desviaciones llegan cuando vuelva.</p>`;
  const abiertas = E.p?.desviaciones?.length ?? 0;
  const dejo = e ? `Dejó ${esc(e.firma ?? "el turno anterior")}${e.turno ? ` (turno de ${esc(laHora(e.turno))})` : ""}: ${esc(String(e.notas ?? "sin novedades").slice(0, 200))}` : "Sin entrega registrada.";
  return `<p class="ayuda">${dejo} ${abiertas ? `${abiertas} desviación${abiertas === 1 ? "" : "es"} abierta${abiertas === 1 ? "" : "s"} en esta sede.` : "Sin desviaciones abiertas en esta sede."}</p>`;
}

/** La cabecera de una orden en el trabajo: salir, de qué se trata, pausar y la señal. Sin reloj. */
function cabOrden(o: Any) {
  const titulo = o.modo === "emergencia" ? o.eop?.codigo || "Emergencia" : o.activo?.codigo ?? tituloOrden(o);
  const sub = o.modo === "emergencia" ? tituloOrden(o) : o.activo ? o.activo.nombre : o.lugar?.ubicacion ?? "";
  const pausa = o.estado === "en_proceso" ? `<button class="ic" data-a="pausar" aria-label="Pausar el trabajo">${ico.pausa}</button>` : "";
  return `<div class="paso-cab"><button class="ic" data-a="salir" aria-label="Volver a Hoy">${ico.x}</button><div class="paso-tit"><strong>${esc(titulo)}</strong><span>${esc(sub)}</span></div>${pausa}<span id="senal">${pillHtml()}</span></div>`;
}
const cabRonda = (r: Any, p: Any) => `<div class="paso-cab"><button class="ic" data-a="salir" aria-label="Volver a Hoy">${ico.x}</button><div class="paso-tit"><strong>${esc(`Ronda de ${laHora(r.turno)}`)}</strong><span>${esc(p.sistema === "otro" ? "" : SISTEMAS[p.sistema] ?? r.nombre)}</span></div><span id="senal">${pillHtml()}</span></div>`;
const segmentos = (n: number, actual: number, hecho: (k: number) => boolean, clase = "") => `<div class="segs${clase ? ` ${clase}` : ""}">${Array.from({ length: n }, (_, k) => `<i class="${k === actual ? "a" : hecho(k) ? "h" : ""}"></i>`).join("")}</div>`;
/** «Volver al…» de cada pantalla del trabajo, si hay a dónde volver. */
function enlaceAtras(o: Any, vista: string, i: number) {
  const atras = pantallaAnterior(o, vista, i);
  if (!atras) return "";
  const texto = atras.vista === "permiso" ? "Volver al permiso anterior" : atras.vista === "liberacion" ? "Volver a la lectura anterior" : o.modo === "emergencia" ? "Volver a la acción anterior" : "Volver al paso anterior";
  return `<button class="link" data-a="anterior" style="align-self:flex-start">${texto}</button>`;
}

function vPaso() {
  const f = E.flujo;
  if (!f) return vHoy();
  const esRonda = f.tipo === "ronda";
  const o = esRonda ? null : ordenDe(f.ordenId as number);
  const r = esRonda ? E.p?.ronda : null;
  const lista: Any[] = esRonda ? r?.puntos : o?.pasos;
  const p = lista?.[f.i];
  if (!p) { E.flujo = null; E.vista = "hoy"; aviso("Esta orden ya no está en tu lista."); return vHoy(); }
  const n = lista.length;
  const esEop = !esRonda && o.modo === "emergencia";
  const previo = esRonda ? r.lecturas[p.id] : p;
  const texto = String(p.texto ?? "").replace(/ · /g, ": ");
  const entrega = esRonda && p.linea === 1 ? bitacoraHtml(r) : "";
  const ayuda = esRonda ? [p.ayuda, p.esperado ? `Debe verse: ${p.esperado}` : ""].filter(Boolean).join(" ") : p.criterio ?? "";
  const claveLect = esRonda ? `rlect:${r.fecha}:${r.turno}:${p.id}` : `lect:${o.id}:${f.i}`;
  const lect = p.pideValor ? lecturaHtml(p, previo?.valor, claveLect) : "";
  const materiales = !esRonda && p.materiales ? `<p class="ayuda">Materiales: ${esc(p.materiales)}</p>` : "";
  const nota = esRonda ? (previo?.nota ? `<p class="ayuda">Anotaste: ${esc(previo.nota)}</p>` : "") : comoEstaElPaso(o, p, claveLect);
  let pie: string;
  if (esEop) {
    // Las acciones del EOP no son críticas: se hacen o no se pudieron, y se sigue.
    pie = `<button class="b1" data-a="hecho">${ico.check}Hecho</button><button class="b2" data-a="nopudo">No se pudo</button>`;
  } else if (!esRonda) {
    pie = (p.pideValor ? `<button class="b1" id="btn-lect" data-a="lectura">Guardar lectura</button>` : `<button class="b1" data-a="hecho">${ico.check}Hecho</button>`)
      + (p.critico ? `<button class="b2" data-a="problema">Hay un problema</button>` : `<div class="dos"><button class="b2" data-a="na">No aplica</button><button class="b2" data-a="problema">Hay un problema</button></div>`);
  } else {
    pie = p.pideValor
      ? `<button class="b1" id="btn-lect" data-a="lectura">Guardar lectura</button><div class="dos"><button class="b2" data-a="noconf">Hay una alarma</button><button class="b2" data-a="noverif">No pude verificar</button></div>`
      : `<button class="b1" data-a="conforme">${ico.check}Conforme</button><div class="dos"><button class="b2" data-a="noconf">No conforme</button><button class="b2" data-a="noverif">No pude verificar</button></div>`;
  }
  const hecho = (k: number) => (esRonda ? !!r.lecturas[lista[k].id] : lista[k].estado !== "pendiente");
  const atras = esRonda ? (f.i > 0 ? `<button class="link" data-a="anterior" style="align-self:flex-start">Volver al paso anterior</button>` : "") : enlaceAtras(o, "paso", f.i);
  return `<div class="paso">${esRonda ? cabRonda(r, p) : cabOrden(o)}${segmentos(n, f.i, hecho)}`
    + `<div class="paso-cuerpo" data-k="${f.i}"><div class="paso-meta"><span class="etq${esEop ? " urgente" : ""}">${esRonda ? "Parada" : esEop ? "Acción" : "Paso"} ${f.i + 1} de ${n}</span>${p.critico ? '<span class="critico">CRÍTICO</span>' : ""}</div>`
    + `<h1 class="${texto.length > 70 ? "largo" : ""}">${esc(texto)}</h1>${entrega}${ayuda ? `<p class="ayuda">${esc(ayuda)}</p>` : ""}${materiales}${lect}${nota}${atras}</div>`
    + `<div class="paso-pie">${pie}</div></div>`;
}

const ESTADO_DEL_PASO: Record<string, string> = { ok: "Hecho", na: "No aplica", desviacion: "Hay un problema" };
/**
 * Un paso ya marcado dice cómo está guardado: su estado (en una emergencia, «No se pudo») y su nota, que pudo
 * escribir la jefatura: por eso no dice «Anotaste». Si el campo trae otra lectura escrita, también la guardada.
 */
function comoEstaElPaso(o: Any, p: Any, claveLect: string): string {
  const emergencia = o.modo === "emergencia";
  const noPudo = emergencia && p.estado === "desviacion";
  const crudo = String(p.nota ?? "").trim();
  const nota = noPudo ? crudo.replace(/^no se pudo\s*:?\s*/i, "") : crudo;
  if (p.estado === "pendiente") return nota ? `<p class="ayuda recorte marcado" data-a="verTodo">Nota: ${esc(nota)}</p>` : "";
  const estado = noPudo ? "No se pudo" : ESTADO_DEL_PASO[p.estado] ?? "";
  const escrito = String(E.notas[claveLect] ?? "").trim();
  const guardada = p.pideValor && comoTexto(p.valor) && escrito && !mismaLectura(escrito, p.valor) ? `, con ${comoTexto(p.valor)}${p.unidad ? ` ${p.unidad}` : ""}` : "";
  return `<p class="ayuda recorte marcado" data-a="verTodo">${emergencia ? "Ya está marcada" : "Ya está marcado"}: <b>${esc(estado)}</b>${esc(guardada)}.${nota ? ` Nota: ${esc(nota)}` : ""}</p>`;
}
/** Dos lecturas iguales: por su número si alguna se lee como uno; si no, el texto recortado. */
const mismaLectura = (a: unknown, b: unknown) => {
  const x = valorDe(leerNumero(a)), y = valorDe(leerNumero(b));
  return x != null || y != null ? x === y : String(a ?? "").trim() === String(b ?? "").trim();
};

/** Las dos preguntas de la emergencia. Cada «Sí» fija su hora con el toque. */
function vPregunta(o: Any, pregunta: string, ayuda: string, si: string, accionSi: string, accionNo: string) {
  return `<div class="paso">${cabOrden(o)}<div class="paso-cuerpo"><div class="paso-meta"><span class="etq urgente">Emergencia</span></div>`
    + `<h1>${esc(pregunta)}</h1><p class="ayuda">${esc(ayuda)}</p>${E.vista === "controlado" ? enlaceAtras(o, "controlado", 0) : ""}</div>`
    + `<div class="paso-pie"><button class="b1" data-a="${accionSi}">${esc(si)}</button><button class="b2" data-a="${accionNo}">Todavía no</button></div></div>`;
}
const ordenDelFlujo = () => (E.flujo?.tipo === "pm" ? ordenDe(E.flujo.ordenId as number) : null);
function vControlado() {
  const o = ordenDelFlujo();
  if (!o) { E.flujo = null; E.vista = "hoy"; return vHoy(); }
  return vPregunta(o, "¿Ya está controlado?", "Toca Sí cuando la situación ya no empeora, aunque todavía falte reparar.", `Sí: ${o.eop?.etiquetaMitigacion || "Situación controlada"}`, "controlado", "todaviaNoControlado");
}
function vNormalidad() {
  const o = ordenDelFlujo();
  if (!o) { E.flujo = null; E.vista = "hoy"; return vHoy(); }
  return vPregunta(o, "¿Volvió a la normalidad?", "Toca Sí cuando el servicio funciona como antes de la falla.", "Sí, restablecido", "restablecido", "todaviaNoNormal");
}

/** Un permiso por pantalla: qué es, qué anotar y la referencia que lo vuelve verificable. */
function vPermiso() {
  const f = E.flujo as Flujo;
  const o = ordenDelFlujo();
  const lista: Any[] = o?.prerrequisitos ?? [];
  const p = lista[f?.i];
  if (!o || !p) { E.flujo = null; E.vista = "hoy"; return vHoy(); }
  const clave = `ref:${o.id}:${p.id}`;
  return `<div class="paso">${cabOrden(o)}${segmentos(lista.length, f.i, (k) => !!lista[k].cumplido)}`
    + `<div class="paso-cuerpo" data-k="${f.i}"><div class="paso-meta"><span class="etq">Antes de empezar, los permisos · ${f.i + 1} de ${lista.length}</span><span class="tag${p.obligatorio ? " obl" : ""}">${p.obligatorio ? "Obligatorio" : "Opcional"}</span></div>`
    + `<h1 class="${String(p.texto).length > 70 ? "largo" : ""}">${esc(p.texto)}</h1>`
    + (p.pista ? `<p class="ayuda">Anota: ${esc(p.pista)}.</p>` : "")
    + `<label class="etq" for="referencia">Referencia</label><input class="campo" id="referencia" data-nota="${esc(clave)}" autocomplete="off" enterkeyhint="done" value="${esc(E.notas[clave] ?? p.referencia ?? "")}">`
    + `<p class="err" id="err-ref" hidden>Escribe la referencia (al menos 2 caracteres).</p>`
    + (p.cumplido ? `<p class="ayuda">Ya quedó cumplido. Si cambias la referencia, toca Cumplido otra vez.</p>` : "")
    + `${enlaceAtras(o, "permiso", f.i)}</div>`
    + `<div class="paso-pie"><button class="b1" data-a="cumplido">${ico.check}Cumplido</button>${p.obligatorio ? "" : `<button class="b2" data-a="saltar">Saltar</button>`}</div></div>`;
}

/** Cada lectura de liberación en su pantalla: qué se mide, lo normal y el campo. */
function vLiberacion() {
  const f = E.flujo as Flujo;
  const o = ordenDelFlujo();
  const lista: Any[] = o?.liberaciones ?? [];
  const l = lista[f?.i];
  if (!o || !l) { E.flujo = null; E.vista = "hoy"; return vHoy(); }
  const libre = !conRango(l);
  const normal = l.esperado || rangoDe(l);
  const sinNumero = l.medida && !medidaConNumero(l);
  const anotada = l.medida ? `<p class="ayuda recorte">Anotaste: ${esc(comoTexto(l.valor))}${typeof l.valor === "number" && l.unidad ? ` ${esc(l.unidad)}` : ""}${l.conforme === false ? ", fuera de rango" : sinNumero ? ", sin número: anota el que marcó el instrumento" : ""}.</p>` : "";
  return `<div class="paso">${cabOrden(o)}${segmentos(lista.length, f.i, (k) => libHecha(o, k))}`
    + `<div class="paso-cuerpo" data-k="${f.i}"><div class="paso-meta"><span class="etq">Lectura de liberación ${f.i + 1} de ${lista.length}</span><span class="tag${l.obligatoria ? " obl" : ""}">${l.obligatoria ? "Obligatoria" : "Opcional"}</span></div>`
    + `<h1 class="${String(l.etiqueta).length > 70 ? "largo" : ""}">${esc(l.etiqueta)}</h1>`
    + lecturaHtml({ ...l, ultima: null }, "", `lib:${o.id}:${l.id}`, normal, libre)
    + anotada
    + `${enlaceAtras(o, "liberacion", f.i)}</div>`
    + `<div class="paso-pie"><button class="b1" id="btn-lect" data-a="lecturaLib">Guardar lectura</button>${l.obligatoria ? "" : `<button class="b2" data-a="saltarLib">Saltar</button>`}</div></div>`;
}

function itemConLectura(): Any {
  const f = E.flujo;
  if (!f) return null;
  if (f.tipo === "ronda") return E.p?.ronda?.puntos[f.i] ?? null;
  const o = ordenDe(f.ordenId as number);
  return (E.vista === "liberacion" ? o?.liberaciones?.[f.i] : o?.pasos[f.i]) ?? null;
}
/**
 * Lo escrito en el campo de la lectura. Un número ambiguo cuenta en una parada, en el valor de un
 * paso y en una liberación con rango: en una liberación sin rango lo escrito es texto, como lo guarda
 * el servidor.
 */
function leerLectura(texto: string, p: Any) {
  const liberacion = E.vista === "liberacion";
  const leido = liberacion ? numeroAlInicio(texto) : leerNumero(texto);
  const ambiguo = leido.tipo === "ambiguo" && (!liberacion || conRango(p)) ? leido.mensaje : null;
  return { valor: valorDe(leido), ambiguo };
}
/** «¿1200 o 1,2?»: el aviso va donde se pide el número del instrumento, y la lectura no se guarda. */
function pedirNumero(mensaje: string, campo?: HTMLInputElement) {
  const s = $("#lect-estado");
  if (s) { s.textContent = mensaje; s.className = "lect-estado falta"; }
  const b = $("#btn-lect");
  if (b) b.textContent = "Guardar lectura";
  campo?.focus();
}
/**
 * Antes de enviar a verificación: el paso que pide su lectura y no la tiene. Se va a ese paso y se dice qué
 * falta, con la frase de siempre: sin nada escrito, la de la lectura que falta; con un texto, la del número.
 */
function pedirLecturaDePaso(o: Any, i: number) {
  const leido = leerNumero(o.pasos[i].valor);
  irAPantalla(o, { vista: "paso", i });
  const campo = $<HTMLInputElement>("#lectura") ?? undefined;
  if (leido.tipo === "vacio") { aviso("Escribe la lectura para seguir."); campo?.focus(); return; }
  pedirNumero(leido.tipo === "ambiguo" ? leido.mensaje : MENSAJE_PASO_SIN_NUMERO, campo);
}
function evaluarLectura() {
  const l = $<HTMLInputElement>("#lectura");
  const s = $("#lect-estado");
  const b = $("#btn-lect");
  const p = itemConLectura();
  if (!l || !s || !b || !p) return;
  const liberacion = E.vista === "liberacion";
  const { valor: v, ambiguo } = leerLectura(l.value, p);
  // Un número que se puede leer de dos formas no se juzga contra el rango: se pide sin separador.
  if (ambiguo) { pedirNumero(ambiguo); return; }
  const hayRango = p.min != null || p.max != null;
  if (v == null || !hayRango) { s.textContent = ""; s.className = "lect-estado"; b.textContent = "Guardar lectura"; return; }
  const mal = fueraDe(p, v);
  s.textContent = mal ? "Fuera de rango" : "Dentro de rango";
  s.className = `lect-estado ${mal ? "mal" : "bien"}`;
  b.textContent = mal && !liberacion ? "Registrar fuera de rango" : "Guardar lectura";
}

function avanzar() {
  const f = E.flujo;
  if (!f) return;
  E.hoja = null;
  soltarHistorialDeHoja();
  if (f.tipo === "ronda") {
    const r = E.p.ronda;
    let sig = -1;
    for (let k = f.i + 1; k < r.puntos.length; k++) if (!r.lecturas[r.puntos[k].id]) { sig = k; break; }
    if (sig < 0) sig = rondaFaltante(r);
    if (sig < 0) E.vista = "fin"; else { f.i = sig; E.vista = "paso"; }
    pintar();
    return;
  }
  const o = ordenDe(f.ordenId as number);
  if (!o) { E.flujo = null; ir("#hoy", true); return; }
  let sig = -1;
  for (let k = f.i + 1; k < o.pasos.length; k++) if (o.pasos[k].estado === "pendiente") { sig = k; break; }
  if (sig < 0) sig = primerPendiente(o);
  // Sin pasos pendientes sigue lo que toque: la pregunta de la emergencia, las lecturas de liberación o el cierre.
  irAPantalla(o, sig >= 0 ? { vista: "paso", i: sig } : pantallaDe(o));
}

/** Marca el paso en pantalla. `textos`: lo que el técnico escribió, por su clave de borrador, para devolvérselo si el servidor no lo acepta. */
function marcarPaso(estado: string, extra: Record<string, unknown> = {}, textos: Record<string, unknown> = {}) {
  const f = E.flujo as Flujo;
  const o = ordenDe(f.ordenId as number);
  const p = o.pasos[f.i];
  void despachar({ tipo: "orden.paso", ordenId: o.id, idx: f.i, texto: p.texto, estado, ...extra, ...antesDe(p), ...accionesMostradas(o), ...conTexto(textos) });
  olvidar((k) => k === `lect:${o.id}:${f.i}`);
  zumbar();
  avanzar();
}
/**
 * K17 · El paso como se ve justo antes de marcarlo: la copia del día más lo que falta enviar. Con eso el
 * servidor sabe si la ficha lo cambió mientras tanto; entonces no pisa ese cambio y no acepta la marca.
 */
const antesDe = (p: Any) => ({ antes: { estado: p.estado, valor: p.valor ?? null, nota: p.nota ?? null } });
function marcarParada(resultado: string, extra: Record<string, unknown> = {}, at?: string) {
  const r = E.p.ronda;
  const f = E.flujo as Flujo;
  const pt = r.puntos[f.i];
  void despachar({ tipo: "ronda.lectura", rondaId: r.rondaId, sucursalId: r.sucursalId, fecha: r.fecha, turno: r.turno, puntoId: pt.id, resultado, ...extra }, at);
  olvidar((k) => k === `rlect:${r.fecha}:${r.turno}:${pt.id}`);
  zumbar();
}
function marcarHito(hito: "mitigacion" | "restablecimiento") {
  const o = ordenDelFlujo();
  if (!o) return;
  void despachar({ tipo: "emergencia.hito", ordenId: o.id, hito });
  zumbar();
  seguirOrden(o.id);
}

function guardarLectura() {
  const f = E.flujo as Flujo;
  const l = $<HTMLInputElement>("#lectura");
  const p0 = itemConLectura();
  if (!l || !p0) return;
  // «1,200» puede ser mil doscientos o uno coma dos: no se guarda ni se envía hasta escribirlo sin separador.
  const { valor: v, ambiguo } = leerLectura(l.value, p0);
  if (ambiguo) { pedirNumero(ambiguo, l); return; }
  if (f.tipo === "ronda") {
    const r = E.p.ronda;
    const pt = r.puntos[f.i];
    if (v == null) { aviso("Escribe la lectura para seguir."); l.focus(); return; }
    if (!fueraDe(pt, v)) { marcarParada("ok", { valor: v }); avanzar(); return; }
    abrirHoja({ tipo: "novedad", valor: v, at: new Date().toISOString(), opcional: true, foco: false, valorTxt: `Lectura ${comoTexto(v)}${pt.unidad ? ` ${pt.unidad}` : ""} · normal ${rangoDe(pt)}` });
    return;
  }
  const o = ordenDe(f.ordenId as number);
  const p = o.pasos[f.i];
  const crudo = l.value.trim();
  if (!crudo) { aviso("Escribe la lectura para seguir."); l.focus(); return; }
  // Con mínimo o máximo, lo escrito es el número del instrumento: «14,5 A» u «ok» no se guarda ni se envía.
  if (v == null && conRango(p)) { pedirNumero(MENSAJE_PASO_SIN_NUMERO, l); return; }
  // Un paso que ya quedó con «Hay un problema» y sin su lectura la recibe y sigue con su problema y su nota.
  const estado = p.estado === "desviacion" && pasoSinLectura(p) ? "desviacion" : "ok";
  if (v == null || !fueraDe(p, v)) { marcarPaso(estado, { valor: v ?? crudo }, { [`lect:${o.id}:${f.i}`]: crudo }); return; }
  // La lectura viaja como número: escrita otra vez como texto, «12,3450» quedaría «12.345», que se lee de dos formas.
  abrirHoja({ tipo: "problema", valor: v, valorTxt: `Lectura ${comoTexto(v)}${p.unidad ? ` ${p.unidad}` : ""} · normal ${rangoDe(p)}` });
}

/** Después de un permiso: el siguiente que falte; con todos listos, la pantalla de Empezar. */
function siguientePermiso(o: Any, desde: number) {
  const lista: Any[] = o.prerrequisitos ?? [];
  for (let k = desde + 1; k < lista.length; k++) if (!preHecho(o, k)) { irAPantalla(o, { vista: "permiso", i: k }); return; }
  const k = lista.findIndex((_: Any, j: number) => !preHecho(o, j));
  irAPantalla(o, k >= 0 ? { vista: "permiso", i: k } : { vista: "inicio", i: 0 });
}
/** Después de una lectura: la siguiente que falte; si no, lo que toque. */
function siguienteLiberacion(o: Any, desde: number) {
  const lista: Any[] = o.liberaciones ?? [];
  if (!o.reversa?.ejecutada) for (let k = desde + 1; k < lista.length; k++) if (!libHecha(o, k)) { irAPantalla(o, { vista: "liberacion", i: k }); return; }
  irAPantalla(o, pantallaDe(o));
}
/** A dónde lleva «Volver». Una hora ya registrada no se deshace: la corrige la jefatura en la ficha. */
function pantallaAnterior(o: Any, vista: string, i: number): { vista: string; i: number } | null {
  const ultimoPaso = o.pasos.length - 1;
  const ultimaLectura = (o.liberaciones?.length ?? 0) - 1;
  switch (vista) {
    case "permiso": return i > 0 ? { vista: "permiso", i: i - 1 } : null;
    case "paso": return i > 0 ? { vista: "paso", i: i - 1 } : null;
    case "liberacion": return i > 0 ? { vista: "liberacion", i: i - 1 } : ultimoPaso >= 0 ? { vista: "paso", i: ultimoPaso } : null;
    case "controlado": return ultimoPaso >= 0 ? { vista: "paso", i: ultimoPaso } : null;
    case "fin":
      if (o.modo === "intervencion" && ultimaLectura >= 0 && !o.reversa?.ejecutada) return { vista: "liberacion", i: ultimaLectura };
      return o.modo === "emergencia" && !o.hitos?.restablecimiento ? null : ultimoPaso >= 0 ? { vista: "paso", i: ultimoPaso } : null;
  }
  return null;
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
/** «Actuar antes de las 08:12», «antes de la 01:30», desde la hora capturada; un plazo de un día o más se dice en horas. */
const limite = (at: string | undefined, m: number | null | undefined) => (m == null ? "Sin plazo" : !at || m >= 720 ? plazo(m) : laHora(hora(Date.parse(at) + m * 60000)));
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
  // En una emergencia, cada acción del EOP se hizo o no se pudo: igual que lo escribe el servidor.
  if (o.modo === "emergencia") return `${limpio}: ${ok} de ${pasos.length} acciones hechas${na ? `, ${na} no aplica` : ""}${nov ? `; ${nov} ${nov === 1 ? "no se pudo" : "no se pudieron"}` : ""}.${lect.length ? ` Lecturas: ${lect.join("; ")}.` : ""}`;
  return `${limpio}: ${ok + nov} de ${pasos.length} puntos realizados${nov ? `, ${nov} con novedad` : " sin novedad"}${na ? `, ${na} no aplica` : ""}.${lect.length ? ` Lecturas: ${lect.join("; ")}.` : ""}`;
}
/** Tomar una foto. Si en esta pantalla u hoja ya se tomó, se dice así: «1 foto lista». */
function fotoCampo(id: string, clave: string, categoria: string, texto: string) {
  const n = E.fotos[clave] ?? 0;
  const lista = n ? `<span><b>${n === 1 ? "1 foto lista" : `${n} fotos listas`}.</b> Se envía${n === 1 ? "" : "n"} por detrás; puedes seguir.</span>` : "";
  return `<label class="b2" for="${id}">${ico.camara}${esc(n ? "Otra foto" : texto)}</label><input class="oculto" type="file" accept="image/*" capture="environment" id="${id}" data-foto="${categoria}" data-clave="${esc(clave)}"><div class="foto-res${n ? " si" : ""}" id="foto-res">${lista}</div>`;
}
function vFinRonda() {
  const r = E.p.ronda;
  const lect = r.puntos.map((pt: Any) => ({ pt, l: r.lecturas[pt.id] })).filter((x: Any) => x.l);
  const nov = lect.filter((x: Any) => x.l.resultado === "no_verificado");
  const fuera = lect.filter((x: Any) => x.l.resultado === "fuera");
  const lecturas = lect.filter((x: Any) => x.l.valor != null).map((x: Any) => `${x.pt.texto}: ${comoTexto(x.l.valor)}${x.pt.unidad ? ` ${x.pt.unidad}` : ""}`);
  // La entrega de turno ya viene escrita con lo que quedó abierto; el técnico solo la ajusta.
  const clave = `entrega:${r.fecha}:${r.turno}`;
  const nombres = (l: Any[]) => l.map((x: Any) => String(x.pt.texto).split(" · ")[0]).join(", ");
  const sugerida = [fuera.length ? `Quedan abiertas: ${nombres(fuera)}.` : "", nov.length ? `Sin verificar: ${nombres(nov)}.` : ""].filter(Boolean).join(" ");
  const entrega = E.notas[clave] ?? sugerida;
  const conReloj = fuera.filter((x: Any) => x.pt.aop).length;
  return `<div class="final"><span class="etq">Ronda de ${esc(laHora(r.turno))}</span><h1>${lect.length - nov.length} de ${r.puntos.length} paradas verificadas</h1>`
    + `<div class="dato"><span class="etq">Desviaciones abiertas</span><b>${fuera.length ? `${conReloj ? `${conReloj} con su reloj corriendo. ` : `${fuera.length} sin reloj. `}${E.enLinea ? "Tu jefatura ya las ve." : "Tu jefatura las ve cuando vuelva la señal."}` : "Ninguna"}</b></div>`
    + (nov.length ? `<div class="dato"><span class="etq">Sin verificar</span><b>${nov.length}, con su razón escrita.</b></div>` : "")
    + (lecturas.length ? `<div class="dato solo-alto"><span class="etq">Lecturas</span><b>${esc(lecturas.slice(0, 4).join(" · "))}${lecturas.length > 4 ? ` y ${lecturas.length - 4} más` : ""}</b></div>` : "")
    + `<div class="dato"><span class="etq">Firma</span><b>${esc(primerNombre(NOMBRE))}</b></div>`
    + `<label class="etq" for="entrega">Novedades para quien entra</label><textarea id="entrega" data-nota="${esc(clave)}" placeholder="Si no hay, déjalo en blanco.">${esc(entrega)}</textarea><p class="err" id="err-entrega" hidden>Hay novedades abiertas: escribe qué le dejas a quien entra.</p>`
    + `<div class="empuja"><button class="b1" data-a="cerrarRonda">Firmar y cerrar la ronda</button><button class="link" data-a="anterior" style="justify-content:center">Volver a la última parada</button></div></div>`;
}
function vFin() {
  const f = E.flujo;
  if (!f) return vHoy();
  if (f.tipo === "ronda") return E.p?.ronda ? vFinRonda() : vHoy();
  const o = ordenDe(f.ordenId as number);
  if (!o) { E.flujo = null; E.vista = "hoy"; return vHoy(); }
  if (o.modo !== "pasos") return vFinTrabajo(o);
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
  const texto = trabajosEscritos(o);
  const mostrarNota = !n || E.verNota || nota;
  return `<div class="final"><span class="etq">${esc([o.activo?.codigo, tituloOrden(o)].filter(Boolean).join(" · "))}</span>`
    + `<h1>${n ? `${n} de ${n} pasos anotados` : "¿Qué hiciste?"}</h1>`
    + (o.devuelta ? `<div class="dato"><span class="etq">Te la devolvieron</span><b>${esc(o.devuelta)}</b></div>` : "")
    + (texto ? `<div class="dato"><span class="etq">Trabajos realizados, escritos solos</span><b>${esc(texto)}</b></div>` : "")
    + (mostrarNota
      ? `<label class="etq" for="nota-fin">${n ? "Algo más que anotar" : "Trabajos realizados"}</label><textarea id="nota-fin" data-nota="${clave}" placeholder="Usa el micrófono del teclado para dictarlo.">${esc(nota)}</textarea>`
      : `<button class="link" data-a="verNota" style="align-self:flex-start">Agregar una nota</button>`)
    + fotoCampo("foto-final", clave, "despues", "Foto final (opcional)")
    + `<p class="err" id="err-fin" hidden></p>`
    + `<div class="empuja"><button class="b1" data-a="enviar">Enviar a verificación</button>${n ? `<button class="link" data-a="anterior" style="justify-content:center">Revisar los pasos</button>` : `<a class="link" href="#hoy" data-a="ir" data-h="#hoy" style="justify-content:center">Volver a Hoy</a>`}</div></div>`;
}
/** El cierre de una emergencia o de una intervención: qué encontró y qué hizo. La causa raíz la escribe la jefatura. */
function vFinTrabajo(o: Any) {
  // Si falta algo (un paso, un toque, una lectura), se va primero a eso.
  const falta = pantallaDe(o);
  if (falta.vista !== "fin") {
    E.vista = falta.vista;
    E.params = { id: o.id };
    E.flujo = falta.vista === "inicio" || falta.vista === "pausa" ? null : { tipo: "pm", ordenId: o.id, i: falta.i };
    return (VISTAS[falta.vista] ?? vHoy)();
  }
  const clave = `fin:${o.id}`;
  const emergencia = o.modo === "emergencia";
  const texto = trabajosEscritos(o);
  const atras = pantallaAnterior(o, "fin", 0);
  const volver = atras
    ? `<button class="link" data-a="anterior" style="justify-content:center">${atras.vista === "liberacion" ? "Revisar las lecturas" : emergencia ? "Revisar las acciones" : "Revisar los pasos"}</button>`
    : `<a class="link" href="#hoy" data-a="ir" data-h="#hoy" style="justify-content:center">Volver a Hoy</a>`;
  return marco(`<span class="etq${emergencia ? " urgente" : ""}">${esc([emergencia ? "Emergencia" : "Intervención", emergencia ? o.eop?.codigo : o.activo?.codigo].filter(Boolean).join(" · "))}</span>`
    + `<h1>¿Qué encontraste y qué hiciste?</h1>`
    + (o.devuelta ? dato("Te la devolvieron", o.devuelta) : "")
    + (texto ? dato("Ya quedó anotado", texto, "solo-alto") : "")
    + (emergencia ? "" : resumenLecturas(o))
    + (o.reversa?.ejecutada ? dato("Plan de reversa", "Ejecutado: no hace falta liberar el sistema.") : "")
    + `<label class="oculto" for="nota-fin">Qué encontraste y qué hiciste</label><textarea id="nota-fin" data-nota="${clave}" placeholder="Usa el micrófono del teclado para dictarlo.">${esc(E.notas[clave] ?? "")}</textarea>`
    + fotoCampo("foto-final", clave, "despues", "Foto (opcional)")
    + (emergencia ? `<p class="ayuda">La causa raíz la escribe tu jefatura.</p>` : "")
    + `<p class="err" id="err-fin" hidden></p>`,
    `<button class="b1" data-a="enviar">Enviar a verificación</button>${volver}`);
}
/** Las lecturas de liberación en una línea: cuántas se anotaron y cuántas quedaron fuera de rango. Cada una se revisa en su pantalla. */
function resumenLecturas(o: Any) {
  const libs: Any[] = o.liberaciones ?? [];
  if (!libs.length) return "";
  const anotadas = libs.filter((l) => l.medida);
  const fuera = anotadas.filter((l) => l.conforme === false).length;
  const sin = libs.length - anotadas.length;
  const n = anotadas.length;
  return dato("Lecturas de liberación", [`${n} lectura${n === 1 ? "" : "s"} anotada${n === 1 ? "" : "s"}`, fuera ? `${fuera} fuera de rango` : "", sin ? `${sin} sin anotar` : ""].filter(Boolean).join(" · "));
}
function vListo() {
  const u = E.listo;
  if (!u) return vHoy();
  const sig = siguienteOrden(u.lugar);
  return `<div class="final"><span class="etq">${esc(u.titulo)}</span><h1>${u.sinEnviar ? "Guardado en tu celular" : "Enviado a verificación"}</h1>`
    + `<p class="ayuda">${u.sinEnviar ? "Se envía solo cuando vuelva la señal. Puedes seguir." : "Otra persona lo verifica. Tú ya puedes seguir."}</p>`
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
    const det = [p.frecuencia, p.proxima ? `${p.proxima < hoy ? "vencido" : "próximo"} ${fecha(p.proxima)}` : "", p.pasos ? `${p.pasos} pasos` : ""].filter(Boolean).join(" · ");
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
    + `<li><span>Frente al equipo, toca Empezar. Solo escribes si hay un problema.</span></li>`
    + `<li><span>Si te interrumpen, toca Pausar y elige el motivo.</span></li>`
    + `<li><span>En una emergencia, toca Ya estoy en el sitio al llegar y sigue las acciones en orden.</span></li>`
    + `<li><span>Si se va la señal, sigue: todo queda en el celular y se envía solo.</span></li>`
    + `<li><span>Para un equipo que no está en tu lista, usa Buscar equipo: sede, ubicación y equipo.</span></li>`
    + `<li><span>Si algo falla, Reportar falla te dice qué documento manda y qué hacer primero.</span></li></ol>`
    + instalar
    + (enIphone ? `<p>En iPhone, para tenerlo como aplicación: botón Compartir de Safari y luego Agregar a inicio.</p>` : "")
    + `<a class="b2" href="/perfil" data-fuera>Mi perfil y contraseña</a>`
    + (ROL !== "tecnico" ? `<a class="b2" href="/" data-fuera>Volver a la vista de jefatura</a>` : "")
    + `<button class="b2" data-a="salirSesion">Cerrar sesión</button></div>`;
}

// ── Hojas ───────────────────────────────────────────────────────────────────
// Cada campo de texto lleva su clave de borrador (data-nota): por orden y paso, por parada o por equipo.
const textoHoja = (id: string, clave: string, etiqueta: string, placeholder: string) =>
  `<label class="oculto" for="${id}">${esc(etiqueta)}</label><textarea id="${id}" data-nota="${esc(clave)}" placeholder="${esc(placeholder)}">${esc(E.notas[clave] ?? "")}</textarea>`;
function vHoja() {
  const h = E.hoja;
  const f = E.flujo;
  const o = f?.tipo === "pm" ? ordenDe(f.ordenId as number) : null;
  const r = E.p?.ronda;
  const pt = f?.tipo === "ronda" ? r?.puntos[f.i] : null;
  const deParada = (que: string) => `${que}:${r?.fecha}:${r?.turno}:${pt?.id}`;
  switch (h.tipo) {
    case "sede":
      return `<div class="hoja-caja"><span class="etq">Sede</span><h2>¿En qué sede estás hoy?</h2><div class="lista">${(E.p?.sedes ?? []).map((s: Any) => `<button class="fila" data-a="elegirSede" data-id="${s.id}"><span class="txt"><strong>${esc(s.nombre)}</strong></span>${s.id === E.sede ? ico.check : ico.flecha}</button>`).join("")}</div><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    case "sync": {
      const n = E.pend.length;
      const fotos = E.pend.filter((x) => x.tipo === "foto").length;
      return `<div class="hoja-caja"><span class="etq">Señal</span><h2>${n ? `${n} registro${n === 1 ? "" : "s"} por enviar` : "Todo está enviado"}</h2>`
        + `<p class="ayuda">${n ? `${fotos ? `Incluye ${fotos} foto${fotos === 1 ? "" : "s"}. ` : ""}Se envían solos cuando hay señal, con la hora en que los hiciste.` : "Lo que hagas se guarda primero en el celular y se envía de inmediato."}</p>`
        + (n ? `<button class="b1" data-a="enviarAhora">Enviar ahora</button>` : "")
        + (E.sesionVencida ? `<a class="b2" href="/login?next=/campo">Volver a entrar</a>` : "")
        + `<button class="link" data-a="cerrarHoja">Cerrar</button></div>`;
    }
    case "rechazos": {
      // De qué orden es cada uno, qué se intentó y por qué no entró. Lo escrito ya volvió a su orden u hoja.
      const lista = E.rechazos.slice(-12).reverse();
      const volvio = lista.some((x) => x.texto);
      // Una orden que ya no se puede trabajar no se ofrece abrir: la ayuda no pide abrirla, dice por qué.
      const abrible = (x: Any) => (x.ordenId && !PERDIDA[x.motivo] ? ordenDe(Number(x.ordenId)) : null);
      const perdidas = new Set(lista.filter((x) => x.texto && x.ordenId && !abrible(x)).map((x) => x.motivo ?? ""));
      const ayuda = !volvio ? (lista.some((x) => abrible(x) && pasoCambiado(x.error) !== null) ? "«Abrir la orden» te lleva al paso que cambió en la ficha." : "Tu jefatura puede verlos. Si hace falta, repite el trabajo o pide ayuda.")
        : lista.some(abrible) ? "Lo que escribiste volvió a su orden: ábrela, corrige y envíala otra vez."
        : perdidas.size ? (perdidas.size === 1 ? PERDIDA[[...perdidas][0]] : null) ?? PERDIDA.otro
        : "Lo que escribiste volvió a donde lo escribiste: corrígelo y envíalo otra vez.";
      const filas = lista.map((x) => {
        const abierta = abrible(x);
        // K17 y K19 · Desde un paso que cambió en la ficha, la orden se abre en ese paso.
        const paso = abierta ? pasoCambiado(x.error) : null;
        return `<div class="fila"><span class="txt"><strong>${esc(x.que)}</strong><small>${esc([x.accion, x.error].filter(Boolean).join(": "))}</small>`
          + (x.texto ? `<small class="recorte">Lo que escribiste: «${esc(corto(x.texto, 160))}»</small>` : "")
          + (abierta ? `<button class="link" data-a="ir" data-h="#orden-${abierta.id}"${paso !== null ? ` data-paso="${paso}"` : ""}>Abrir la orden</button>` : "")
          + `</span></div>`;
      }).join("");
      return `<div class="hoja-caja"><span class="etq">Sin aceptar</span><h2>El servidor no aceptó ${lista.length === 1 ? "este registro" : "estos registros"}</h2>`
        + `<p class="ayuda">${ayuda}</p>`
        + `<div class="lista desplaza">${filas}</div>`
        + `<button class="b1" data-a="limpiarRechazos">Entendido</button></div>`;
    }
    case "pausar": {
      // «Todavía no» en la emergencia y «Dejar en espera» en una lectura llegan con su motivo ya marcado.
      const motivos = [...new Set([h.sugerido, "Falta repuesto", "Esperando autorización", "El área está ocupada", "Me pasaron a otra urgencia"].filter(Boolean))] as string[];
      return `<div class="hoja-caja"><span class="etq">Pausar el trabajo</span><h2>¿Por qué se detiene?</h2><div class="chips">${motivos.map((m) => `<button class="chip" data-a="motivoPausa" data-m="${esc(m)}" aria-pressed="${h.motivo === m}">${esc(m)}</button>`).join("")}</div>`
        + textoHoja("nota-pausa", `pausa:${o?.id ?? E.params?.id}`, "Otro motivo", "Otro motivo") + `<p class="err" id="err-pausa" hidden>Toca un motivo o escríbelo.</p>`
        + `<button class="b1" data-a="confirmarPausa">Pausar</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "otraActiva": {
      const a = ordenDe(h.activaId);
      return `<div class="hoja-caja"><span class="etq">Ya tienes una orden en curso</span><h2>${esc(a ? tituloOrden(a) : "")}</h2><p class="ayuda">Se trabaja una orden a la vez: deja esa en pausa o sigue con ella.</p>`
        + `<button class="b1" data-a="pausarYEmpezar" data-id="${h.id}" data-activa="${h.activaId}">Pausar esa y empezar esta</button>`
        + `<button class="b2" data-a="ir" data-h="#orden-${h.activaId}">Seguir con la que llevaba</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "problema": {
      const p = o?.pasos[f?.i as number];
      const clave = `problema:${o?.id}:${f?.i}`;
      return `<div class="hoja-caja"><span class="etq">${esc(corto(p?.texto ?? "", 90))}</span><h2>¿Qué encontraste?</h2>`
        + (h.valorTxt ? `<p class="err">${esc(h.valorTxt)}</p>` : "")
        + textoHoja("nota-problema", clave, "Describe lo que encontraste", "Usa el micrófono del teclado para dictarlo.")
        + `<p class="err" id="err-problema" hidden>Describe en pocas palabras qué encontraste (al menos 10 letras).</p>`
        + fotoCampo("foto-problema", clave, "general", "Tomar foto")
        + (p?.critico ? `<button class="b1" data-a="problemaDetener">Anotar y dejar en espera</button>` : `<button class="b1" data-a="problemaSeguir">Anotar y seguir</button>`)
        + `<button class="b2" data-a="problemaCorrectivo">El equipo no vuelve a servicio: abrir correctivo</button>`
        + `<button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "nopudo": {
      const p = o?.pasos[f?.i as number];
      return `<div class="hoja-caja"><span class="etq">${esc(corto(p?.texto ?? "", 90))}</span><h2>¿Por qué no se pudo?</h2>`
        + textoHoja("nota-nopudo", `nopudo:${o?.id}:${f?.i}`, "Por qué no se pudo", "Por ejemplo: la planta no tiene combustible.")
        + `<p class="err" id="err-nopudo" hidden>Escribe en pocas palabras por qué no se pudo.</p>`
        + `<button class="b1" data-a="nopudoSeguir">Anotar y seguir</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "nolibera": {
      if (h.paso === "reversa") {
        const plan = o?.reversa?.plan;
        return `<div class="hoja-caja"><span class="etq">Plan de reversa</span><h2>¿Qué revertiste y cómo quedó?</h2>${plan ? `<p class="ayuda">${esc(corto(plan, 220))}</p>` : ""}`
          + textoHoja("nota-reversa", `reversa:${o?.id}`, "Qué se revirtió y cómo quedó el sistema", "Por ejemplo: reinstalé el compresor original y el equipo quedó como estaba.")
          + `<p class="err" id="err-reversa" hidden>Describe qué se revirtió y cómo quedó el sistema (al menos 10 letras).</p>`
          + `<button class="b1" data-a="confirmarReversa">Marcar la reversa</button><button class="link" data-a="volverNoLibera">Volver</button></div>`;
      }
      return `<div class="hoja-caja"><span class="etq">${esc(h.valorTxt ?? "Fuera de rango")}</span><h2>No libera</h2><p class="ayuda">Con esta lectura el sistema no se puede liberar.</p>`
        + `<button class="b1" data-a="repetirLectura">Repetir la lectura</button><button class="b2" data-a="reversaPaso">Ejecuté el plan de reversa</button><button class="b2" data-a="dejarEnEspera">Dejar en espera</button></div>`;
    }
    case "aop": {
      const d = h.doc;
      const activo = E.b.ficha?.activo?.id;
      // Lo que dice el documento se lee en su propia caja, que se desplaza; los relojes, el campo y los
      // botones quedan a la vista, también con el aviso de un número que se lee de dos formas.
      const documento = `<p class="ayuda">${esc(d.titulo)}</p>${d.aviso ? `<p class="ayuda">${esc(d.aviso)}</p>` : ""}`
        + (d.acciones?.length ? `<ol class="acc">${d.acciones.map((a: string) => `<li><span>${esc(a)}</span></li>`).join("")}</ol>` : "")
        + (h.seguir ? `<p class="ayuda solo-alto">${E.enLinea ? "La desviación ya quedó abierta y tu jefatura la ve con su reloj." : "Su reloj ya corre desde esta hora. Tu jefatura la ve cuando vuelva la señal."}</p>` : "");
      const campos = h.seguir ? ""
        : `<div class="hoja-campos"><label class="etq" for="valor-desv">Valor medido (opcional)</label><div class="lect-caja mini"><input id="valor-desv" data-nota="desv-valor:${activo}" inputmode="decimal" autocomplete="off" value="${esc(E.notas[`desv-valor:${activo}`] ?? "")}"></div><p class="err" id="err-desv" hidden></p>${textoHoja("nota-desv", `desv:${activo}`, "Qué viste", "Qué viste")}</div>`;
      const botones = (h.seguir ? `<button class="b1" data-a="aopSeguir">Seguir con la ronda</button>` : `<button class="b1" data-a="abrirDesviacion">Abrir la desviación</button>`)
        + (h.pideOrden ? `<button class="b2" data-a="correctivoDeParada">Abrir la orden correctiva</button>` : "")
        + (d.eop ? `<button class="b2" data-a="aEop">Ya falló: pasar a emergencia</button>` : "")
        + (h.seguir ? "" : `<button class="link" data-a="cerrarHoja">Cancelar</button>`);
      return `<div class="hoja-caja con-pie"><span class="etq">${esc(h.valorTxt || "Fuera de lo normal")}</span><h2>Se rige por <span class="codigo">${esc(d.codigo)}</span></h2>`
        + `<div class="relojes"><div><span class="etq">Actuar antes de</span><b>${limite(h.at, d.actuarMin)}</b></div><div><span class="etq">Escalar antes de</span><b>${limite(h.at, d.escalarMin)}</b></div></div>`
        + `<div class="hoja-doc">${documento}</div>${campos}<div class="hoja-pie">${botones}</div></div>`;
    }
    case "eop": {
      const d = h.doc;
      return `<div class="hoja-caja"><span class="etq" style="color:var(--rojo)">Emergencia · hazlo en este orden</span><h2>Se rige por <span class="codigo">${esc(d.codigo)}</span></h2><p class="ayuda">${esc(d.titulo)}</p>`
        + (d.acciones?.length ? `<ol class="acc">${d.acciones.map((a: string) => `<li><span>${esc(a)}</span></li>`).join("")}</ol>` : "")
        + `<button class="b1 alerta" data-a="abrirEmergencia">Abrir orden de emergencia</button>`
        + `<button class="link" data-a="cerrarEop">Cerrar</button></div>`;
    }
    case "novedad": {
      return `<div class="hoja-caja"><span class="etq">${esc(h.valorTxt || pt?.texto || "")}</span><h2>${h.opcional ? "¿Dónde? Sala o zona" : "¿Qué viste?"}</h2>`
        + textoHoja("nota-novedad", deParada("novedad"), "Qué viste", h.opcional ? "Por ejemplo: quirófano 2." : "Por ejemplo: alarma de presión baja en la zona 2.")
        + `<p class="err" id="err-novedad" hidden>Escríbelo: queda en la ronda y le llega a tu jefatura.</p>`
        + `<button class="b1" data-a="novedadSeguir">Anotar y seguir</button><button class="link" data-a="cerrarHoja">${h.opcional ? "Corregir la lectura" : "Cancelar"}</button></div>`;
    }
    case "pideOrden": {
      return `<div class="hoja-caja"><span class="etq">${esc(h.valorTxt || "No conforme")}</span><h2>Esto pide una orden</h2><p class="ayuda">${esc(h.nota || "")}</p>`
        + `<button class="b1" data-a="correctivoDeParada">Abrir la orden y seguir</button><button class="link" data-a="aopSeguir">Seguir sin orden</button></div>`;
    }
    case "noverif": {
      return `<div class="hoja-caja"><span class="etq">${esc(pt?.texto ?? "")}</span><h2>¿Por qué no se pudo verificar?</h2>`
        + textoHoja("nota-noverif", deParada("noverif"), "Razón", "Por ejemplo: quirófano ocupado.")
        + `<p class="err" id="err-noverif" hidden>La razón queda escrita en la ronda; sin ella no se puede seguir.</p>`
        + `<button class="b1" data-a="noverifSeguir">Anotar y seguir</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "plan": {
      return `<div class="hoja-caja"><span class="etq">${esc(E.b.ficha?.activo?.codigo ?? "")}</span><h2>${esc(h.plan.titulo)}</h2><p class="ayuda">Se abre la orden a tu nombre y empiezas con el primer paso.</p><p class="err" id="err-crear" hidden></p>`
        + `<button class="b1" data-a="empezarPlan" data-id="${h.plan.id}">${ico.play}Empezar</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "noProg": {
      const pl = E.b.ficha?.plantillas ?? [];
      const activo = E.b.ficha?.activo?.id;
      const elegida = E.notas[`noprog-lista:${activo}`] ?? String(E.b.ficha?.plantillaSugerida ?? "");
      return `<div class="hoja-caja"><span class="etq">Mantenimiento no programado</span><h2>¿Qué le vas a hacer?</h2>`
        + textoHoja("nota-noprog", `noprog:${activo}`, "Qué le vas a hacer", "Usa el micrófono del teclado para dictarlo.")
        + (pl.length ? `<label class="etq" for="plantilla">Lista de pasos (opcional)</label><select class="campo" id="plantilla" data-nota="noprog-lista:${activo}"><option value="">Sin lista de pasos</option>${pl.map((x: Any) => `<option value="${x.id}"${String(x.id) === elegida ? " selected" : ""}>${esc(x.nombre)}</option>`).join("")}</select>` : "")
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
        + textoHoja("nota-falla", `falla:${fi?.activo?.id}`, "Qué pasó", "Qué pasó. Usa el micrófono del teclado.") + `<p class="err" id="err-falla" hidden>Describe en pocas palabras qué pasó.</p>`
        + (correctivoPrimero ? bCorrectivo + bEmergencia : bEmergencia + bCorrectivo)
        + `<button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    }
    case "otra":
      return `<div class="hoja-caja"><span class="etq">Otra falla</span><h2>¿Qué pasó y dónde?</h2>`
        + textoHoja("nota-otra", `otra:${E.sede}`, "Qué pasó y dónde", "Por ejemplo: fuga en lavamanos, consultorio 4.") + `<p class="err" id="err-otra" hidden>Describe en pocas palabras qué pasó y dónde.</p>`
        + `<button class="b1" data-a="otraEnviar">Abrir correctivo</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
    case "salir":
      return `<div class="hoja-caja"><span class="etq">Cerrar sesión</span><h2>${E.pend.length ? `Tienes ${E.pend.length} registros sin enviar` : "¿Cerrar sesión?"}</h2>`
        + (E.pend.length ? `<p class="ayuda">Quedan guardados en este celular y se envían cuando vuelvas a entrar con tu usuario.</p>` : "")
        + `<button class="b1" data-a="salirConfirmado">Cerrar sesión</button><button class="link" data-a="cerrarHoja">Cancelar</button></div>`;
  }
  return "";
}

/**
 * K17 y K19 · El primer paso que cambió en la ficha según la frase del rechazo (su índice), o null: «El paso 3
 * cambió…», «La acción 3…» o «La orden no se envió: los pasos 2 y 3 cambiaron…». La frase sale de src/lib/campo.ts.
 */
const pasoCambiado = (error: unknown): number | null => {
  const m = /(?:paso|acci[oó]n)(?:s|es)? (\d+)(?:, \d+)*(?: y \d+)? cambi(?:ó|aron) en la ficha mientras tanto/.exec(String(error ?? ""));
  return m ? Number(m[1]) - 1 : null;
};
/** La orden que «Abrir la orden» lleva al paso que cambió: se abre en ese paso, no en el primero pendiente. */
let irAlPaso: { hash: string; i: number } | null = null;
/** Por qué ya no se puede trabajar la orden de un registro sin aceptar, como lo dice «Ver por qué». */
const PERDIDA: Record<string, string> = {
  reasignada: "Esta orden ya no está a tu nombre: lo que escribiste queda aquí para tu jefatura.",
  cancelada: "Esta orden se canceló: lo que escribiste queda aquí para tu jefatura.",
  otro: "Esta orden ya no se puede trabajar en tu celular: lo que escribiste queda aquí para tu jefatura.",
};

// ── Pintar ──────────────────────────────────────────────────────────────────
const VISTAS: Record<string, () => string> = {
  hoy: vHoy, inicio: vInicio, pausa: vPausa, permiso: vPermiso, paso: vPaso, liberacion: vLiberacion, controlado: vControlado, normalidad: vNormalidad, fin: vFin, listo: vListo,
  buscar: vBuscar, reportarLugar: vBuscar, equipos: vEquipos, equipo: vEquipo, falla: vFalla, reportar: vReportar, ayuda: vAyuda,
};
// En el trabajo la pantalla es una sola cosa: sin el menú de abajo.
const SIN_TABS = ["permiso", "paso", "liberacion", "controlado", "normalidad", "fin"];
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
  const sinTabs = SIN_TABS.includes(E.vista);
  const nav = $("#tabs");
  if (nav) nav.hidden = sinTabs;
  // Con el menú abajo, el pie fijo no repite el margen del borde inferior del teléfono.
  $("#movil")?.classList.toggle("con-tabs", !sinTabs);
  if (!sinTabs) pintarTabs();
  pintarHoja();
  pantalla.scrollTop = op.conservar ? antes : 0;
  refrescarPill();
  abrirHojaPendiente();
  const campo = $<HTMLInputElement>("#lectura") ?? $<HTMLInputElement>("#referencia");
  if (campo?.id === "lectura") evaluarLectura();
  // Con una hoja abierta, el campo de atrás no toma el foco: el teclado taparía la hoja.
  if (campo && !campo.value && !E.hoja) campo.focus({ preventScroll: true });
}
function pintarHoja() {
  const h = $("#hoja");
  if (!h) return;
  h.hidden = !E.hoja;
  h.innerHTML = E.hoja ? vHoja() : "";
  guardarBorrador();
}

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
  if (!ya && !history.state?.hoja) history.pushState({ hoja: true }, "", location.hash || "#hoy");
  pintarHoja();
  const t = document.querySelector<HTMLTextAreaElement>("#hoja textarea");
  if (t && h.foco !== false) { t.focus({ preventScroll: true }); t.setSelectionRange?.(t.value.length, t.value.length); }
}
/** Cierra la hoja sin borrar lo escrito: Atrás o tocar afuera. «Cancelar» sí lo borra. */
function cerrarHoja() {
  if (E.hoja?.volverA) { E.hoja = E.hoja.volverA; pintarHoja(); return; }
  if (history.state?.hoja) { history.back(); return; }
  E.hoja = null;
  pintarHoja();
}
/** Una hoja que termina en otra pantalla no debe dejar una entrada que Atrás reabra. */
function soltarHistorialDeHoja() { if (history.state?.hoja) history.replaceState({}, "", location.hash || "#hoy"); }
/** Dónde estaba el técnico antes de recargar o cerrar la app, si es esta misma dirección. */
function tomarRestauracion(): Any {
  const r = E.restaurar;
  if (!r) return null;
  if (r.hash !== (location.hash || "#hoy")) { E.restaurar = null; return null; }
  return r;
}
/** La hoja que estaba abierta vuelve a abrirse, con su texto, cuando su pantalla está lista. */
function abrirHojaPendiente() {
  const h = E.hojaPendiente;
  if (!h || E.hoja) return;
  if (["equipo", "falla"].includes(E.vista) && !E.b.ficha) return; // espera la ficha del equipo
  E.hojaPendiente = null;
  abrirHoja({ ...h, foco: false });
}

function ruta() {
  const h = location.hash.replace(/^#/, "") || "hoy";
  let m: RegExpExecArray | null;
  E.hoja = null;
  E.hojaPendiente = null;
  if ((m = /^orden-(\d+)$/.exec(h))) { abrirOrden(Number(m[1])); return; }
  if (h === "ronda") { abrirRonda(); return; }
  const previo = tomarRestauracion();
  E.restaurar = null;
  if (previo?.hoja) E.hojaPendiente = previo.hoja;
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
  E.flujo = E.flujo && SIN_TABS.includes(E.vista) ? null : E.flujo;
  E.vista = ["reportar", "ayuda"].includes(h) ? h : "hoy";
  if (E.vista === "hoy" && Date.now() - E.ultimoFetch > 60000) void refrescarHoy();
  pintar();
}
function abrirRonda() {
  rodarTurno(); // Sin señal y con la página recién recargada: nunca abrir el turno que ya pasó.
  // Desde el turno en que la sede ya no hace ronda, no se empieza una nueva: la que ya empezó sigue.
  const r = rondaQueSigue(E.p?.ronda);
  if (!r) {
    const frase = fraseSinRonda(E.p?.ronda);
    if (frase) { aviso(frase); history.replaceState({}, "", "#hoy"); }
    E.vista = "hoy";
    pintar();
    return;
  }
  const previo = tomarRestauracion();
  E.restaurar = null;
  if (r.estado === "sin_iniciar") void despachar({ tipo: "ronda.iniciar", rondaId: r.rondaId, sucursalId: r.sucursalId, fecha: r.fecha, turno: r.turno });
  const i = rondaFaltante(r);
  E.flujo = { tipo: "ronda", i: i < 0 ? r.puntos.length - 1 : i };
  E.vista = i < 0 ? "fin" : "paso";
  // Al volver a la app, la misma parada de la misma ronda.
  const k = previo?.flujo?.i;
  if (previo?.flujo?.tipo === "ronda" && previo.ronda === `${r.fecha}:${r.turno}` && Number.isInteger(k) && k >= 0 && k < r.puntos.length && (previo.vista === "paso" || (previo.vista === "fin" && i < 0))) {
    E.flujo.i = k;
    E.vista = previo.vista;
  }
  if (previo?.hoja && previo.vista === E.vista && previo.flujo?.i === E.flujo.i) E.hojaPendiente = previo.hoja;
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
    olvidarHoja();
    aviso("Orden abierta a tu nombre.");
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
  aviso(`${tipo === "emergencia.abrir" ? "Emergencia anotada." : "Correctivo anotado."} ${queVeLaJefatura()}`);
}
/** Nunca decir que la jefatura ya lo ve si no hay señal. */
const queVeLaJefatura = () => (E.enLinea ? "Tu jefatura ya lo ve." : "Tu jefatura no lo ve hasta que vuelva la señal; si es urgente, avísale por radio.");
/** La lectura fuera de rango de la hoja del problema, por la clave del campo de su paso: vuelve ahí si la marca no entra. */
const lecturaEscrita = (f: Flujo, valor: unknown) => (valor != null && valor !== "" ? { [`lect:${f.ordenId}:${f.i}`]: comoTexto(valor) } : {});
/** Un punto crítico con novedad, o un equipo que no vuelve a servicio, detienen la secuencia: los pasos que siguen ya no aplican. */
function detenerOrden(o: Any, nota: string, valor: unknown, escrito = "") {
  const f = E.flujo as Flujo;
  void despachar({ tipo: "orden.paso", ordenId: o.id, idx: f.i, texto: o.pasos[f.i].texto, estado: "desviacion", nota, ...(valor != null && valor !== "" ? { valor } : {}), ...antesDe(o.pasos[f.i]), ...accionesMostradas(o), ...conTexto({ [`problema:${o.id}:${f.i}`]: escrito, ...lecturaEscrita(f, valor) }) });
  void despachar({ tipo: "orden.pausar", ordenId: o.id, motivo: `Detenida: ${nota}`.slice(0, 300) });
  olvidar((k) => k === `lect:${o.id}:${f.i}`);
  zumbar();
  soltarPantalla();
  E.flujo = null;
  E.hoja = null;
  soltarHistorialDeHoja();
  aviso(`Orden en espera. ${queVeLaJefatura()}`);
  ir("#hoy", true);
}
/** Lo que el técnico escribió en la hoja del problema; sin texto suficiente, la lectura fuera de rango ya lo dice. */
function notaDeProblema(): string | null {
  const t = $<HTMLTextAreaElement>("#nota-problema");
  const h = E.hoja;
  const nota = t?.value.trim() ?? "";
  const final = nota.length >= 10 ? nota : h.valorTxt ? (nota ? `${h.valorTxt}. ${nota}` : h.valorTxt) : "";
  if (!final) { const e = $("#err-problema"); if (e) e.hidden = false; t?.focus(); return null; }
  return final;
}

// ── Acciones ────────────────────────────────────────────────────────────────
const A: Record<string, (d: DOMStringMap, b: HTMLElement) => void> = {
  ir(d) {
    irAlPaso = d.h && d.paso !== undefined ? { hash: d.h, i: Number(d.paso) } : null;
    if (d.h) ir(d.h);
  },
  reintentar() { E.cargando = true; pintar(); void refrescarHoy(); },
  sync() { abrirHoja({ tipo: "sync" }); },
  enviarAhora() { E.sesionVencida = false; esperaMs = 5000; cerrarHoja(); void drenar(); },
  verRechazos() {
    abrirHoja({ tipo: "rechazos" });
    if (E.enLinea) void explicarRechazos(E.rechazos);
  },
  limpiarRechazos() { E.rechazos = []; void cola.guardar(`rechazos:${UID}`, []); cerrarHoja(); pintar({ conservar: true }); },
  grupo(d) {
    // Un grupo con una emergencia sin atender se abre y se cierra por su cuenta; los demás, de a uno.
    if (d.e) { if (!cerradosConEmergencia.delete(d.e)) cerradosConEmergencia.add(d.e); }
    else E.grupo = E.grupo === d.g || (!E.grupo && d.g === grupoPorDefecto) ? "__ninguno" : d.g ?? null;
    pintar({ conservar: true });
  },
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
    const o = ordenDe(id);
    if (!o) return;
    // La emergencia empieza al llegar al sitio; la intervención, con sus permisos. La de una copia vieja se abre primero.
    if (o.modo === "emergencia" || o.modo === "ficha" || (o.modo === "intervencion" && faltanObligatorios(o))) { ir(`#orden-${id}`, location.hash === `#orden-${id}`); return; }
    const activa = activaCualquiera();
    if (activa && activa.id !== id) { abrirHoja({ tipo: "otraActiva", id, activaId: activa.id, foco: false }); return; }
    void despachar({ tipo: "orden.iniciar", ordenId: id });
    zumbar();
    ir(`#orden-${id}`, location.hash === `#orden-${id}`);
  },
  pausarYEmpezar(d) {
    const id = Number(d.id);
    void despachar({ tipo: "orden.pausar", ordenId: Number(d.activa), motivo: "Pasó a otra orden" });
    void despachar({ tipo: "orden.iniciar", ordenId: id, ...accionesMostradas(ordenDe(id)) });
    ir(`#orden-${id}`, true);
  },
  llegue(d) {
    const id = Number(d.id);
    const o = ordenDe(id);
    if (!o) return;
    const at = new Date().toISOString();
    // Lo que el técnico tenía entre manos queda en pausa mientras atiende la emergencia.
    const otra = enCurso();
    if (otra && otra.id !== id) {
      void despachar({ tipo: "orden.pausar", ordenId: otra.id, motivo: "Atiende una emergencia" }, at);
      aviso(`«${corto(tituloOrden(otra), 40)}» quedó en pausa.`);
    }
    // El primer toque fija la hora de llegada. «Llegué» no inicia la orden: se manda también iniciar,
    // con las acciones que este celular va a mostrar: el servidor guarda esas y no otras.
    if (!o.hitos?.llegada) void despachar({ tipo: "emergencia.hito", ordenId: id, hito: "llegada" }, at);
    if (o.estado !== "en_proceso") void despachar({ tipo: "orden.iniciar", ordenId: id, ...accionesMostradas(o) }, at);
    zumbar();
    seguirOrden(id);
  },
  reanudar(d) {
    const id = Number(d.id);
    void despachar({ tipo: "orden.reanudar", ordenId: id });
    zumbar();
    abrirOrden(id);
  },
  salir() { soltarPantalla(); E.flujo = null; ir("#hoy"); },
  // Una acción del EOP que pide lectura lleva el número escrito, igual que «Guardar lectura».
  hecho() { if ($("#lectura")) guardarLectura(); else marcarPaso("ok"); },
  conforme() { marcarParada("ok"); avanzar(); },
  na() { marcarPaso("na"); },
  nopudo() { abrirHoja({ tipo: "nopudo" }); },
  nopudoSeguir() {
    const t = $<HTMLTextAreaElement>("#nota-nopudo");
    const nota = t?.value.trim() ?? "";
    if (nota.length < 3) { const e = $("#err-nopudo"); if (e) e.hidden = false; t?.focus(); return; }
    olvidarHoja();
    const f = E.flujo as Flujo;
    marcarPaso("desviacion", { nota: `No se pudo: ${nota}` }, { [`nopudo:${f.ordenId}:${f.i}`]: nota });
  },
  controlado() { marcarHito("mitigacion"); },
  restablecido() { marcarHito("restablecimiento"); },
  todaviaNoControlado() {
    soltarPantalla();
    E.flujo = null;
    aviso("La emergencia sigue abierta. Está primera en Hoy.");
    ir("#hoy");
  },
  todaviaNoNormal() {
    const m = "Todavía no vuelve a la normalidad";
    abrirHoja({ tipo: "pausar", sugerido: m, motivo: m, foco: false });
  },
  verPermiso(d) {
    const o = ordenDe(Number(E.flujo?.ordenId ?? E.params?.id));
    if (o) irAPantalla(o, { vista: "permiso", i: Number(d.i) });
  },
  cumplido() {
    const f = E.flujo as Flujo;
    const o = ordenDelFlujo();
    const p = o?.prerrequisitos?.[f.i];
    const campo = $<HTMLInputElement>("#referencia");
    if (!o || !p || !campo) return;
    const ref = campo.value.trim();
    if (ref.length < 2) { const e = $("#err-ref"); if (e) e.hidden = false; campo.focus(); return; }
    void despachar({ tipo: "mop.prerrequisito", ordenId: o.id, prerrequisitoId: p.id, referencia: ref, ...conTexto({ [`ref:${o.id}:${p.id}`]: ref }) });
    olvidar((k) => k === `ref:${o.id}:${p.id}`);
    zumbar();
    siguientePermiso(o, f.i);
  },
  saltar() {
    const f = E.flujo as Flujo;
    const o = ordenDelFlujo();
    const p = o?.prerrequisitos?.[f.i];
    if (!o || !p || p.obligatorio) return;
    E.saltos[`pre:${o.id}`] = [...new Set([...(E.saltos[`pre:${o.id}`] ?? []), p.id])];
    guardarBorrador();
    siguientePermiso(o, f.i);
  },
  lecturaLib() {
    const f = E.flujo as Flujo;
    const o = ordenDelFlujo();
    const l = o?.liberaciones?.[f.i];
    const campo = $<HTMLInputElement>("#lectura");
    if (!o || !l || !campo) return;
    const crudo = campo.value.trim();
    if (!crudo) { aviso("Escribe la lectura para seguir."); campo.focus(); return; }
    // Con mínimo o máximo, la lectura es el número del instrumento: sin él, o con uno que se lee de dos
    // formas («1,200»), el servidor la rechazaría después. No se guarda ni se envía.
    const { valor, ambiguo } = leerLectura(crudo, l);
    if (ambiguo) { pedirNumero(ambiguo, campo); return; }
    if (conRango(l) && valor == null) { pedirNumero("Esta lectura tiene rango: anota el número que marcó el instrumento (por ejemplo 14,5).", campo); return; }
    void despachar({ tipo: "mop.liberacion", ordenId: o.id, liberacionId: l.id, valor: crudo, ...conTexto({ [`lib:${o.id}:${l.id}`]: crudo }) });
    olvidar((k) => k === `lib:${o.id}:${l.id}`);
    zumbar();
    const v = numeroDe(crudo);
    if (v != null && fueraDe(l, v)) {
      const leido = `${crudo}${l.unidad && !/[a-z%°]/i.test(crudo) ? ` ${l.unidad}` : ""}`;
      if (l.obligatoria) { abrirHoja({ tipo: "nolibera", valorTxt: `Lectura ${leido} · normal ${l.esperado || rangoDe(l)}`, motivo: `${l.etiqueta}: ${leido}`, foco: false }); return; }
      aviso("Fuera de rango. Quedó anotada.");
    }
    siguienteLiberacion(o, f.i);
  },
  saltarLib() {
    const f = E.flujo as Flujo;
    const o = ordenDelFlujo();
    const l = o?.liberaciones?.[f.i];
    if (!o || !l || l.obligatoria) return;
    E.saltos[`lib:${o.id}`] = [...new Set([...(E.saltos[`lib:${o.id}`] ?? []), l.id])];
    guardarBorrador();
    siguienteLiberacion(o, f.i);
  },
  repetirLectura() {
    // La misma pantalla, con el campo vacío: la lectura nueva reemplaza la anterior.
    E.hoja = null;
    soltarHistorialDeHoja();
    pintar();
  },
  reversaPaso() { E.hoja = { ...E.hoja, paso: "reversa" }; pintarHoja(); $<HTMLTextAreaElement>("#nota-reversa")?.focus({ preventScroll: true }); },
  volverNoLibera() { E.hoja = { ...E.hoja, paso: null }; pintarHoja(); },
  confirmarReversa() {
    const o = ordenDelFlujo();
    const t = $<HTMLTextAreaElement>("#nota-reversa");
    const notas = t?.value.trim() ?? "";
    if (!o) return;
    if (notas.length < 10) { const e = $("#err-reversa"); if (e) e.hidden = false; t?.focus(); return; }
    void despachar({ tipo: "mop.reversa", ordenId: o.id, notas, ...conTexto({ [`reversa:${o.id}`]: notas }) });
    olvidarHoja();
    zumbar();
    aviso(`Reversa anotada. ${queVeLaJefatura()}`);
    seguirOrden(o.id);
  },
  dejarEnEspera() {
    const m = `No libera: ${E.hoja?.motivo ?? "lectura fuera de rango"}`;
    abrirHoja({ tipo: "pausar", sugerido: m, motivo: m, foco: false, volverA: { ...E.hoja, paso: null } });
  },
  anterior() {
    const f = E.flujo;
    if (!f) return;
    if (f.tipo === "ronda") {
      if (E.vista === "fin") { f.i = E.p.ronda.puntos.length - 1; E.vista = "paso"; } else if (f.i > 0) f.i--;
      pintar();
      return;
    }
    const o = ordenDe(f.ordenId as number);
    const atras = o ? pantallaAnterior(o, E.vista, f.i) : null;
    if (atras) irAPantalla(o, atras);
  },
  irPaso(d) { const f = E.flujo; if (!f) return; f.i = Number(d.i); E.vista = "paso"; pintar(); },
  lectura: guardarLectura,
  problema() { abrirHoja({ tipo: "problema" }); },
  problemaSeguir() {
    const final = notaDeProblema();
    if (!final) return;
    const h = E.hoja;
    const f = E.flujo as Flujo;
    const escrito = $<HTMLTextAreaElement>("#nota-problema")?.value ?? "";
    olvidarHoja();
    // La lectura fuera de rango también vuelve a su campo si el servidor no acepta la marca.
    marcarPaso("desviacion", { nota: final, ...(h.valor != null && h.valor !== "" ? { valor: h.valor } : {}) }, { [`problema:${f.ordenId}:${f.i}`]: escrito, ...lecturaEscrita(f, h.valor) });
  },
  problemaCorrectivo() {
    const final = notaDeProblema();
    if (!final) return;
    const h = E.hoja;
    const escrito = $<HTMLTextAreaElement>("#nota-problema")?.value ?? "";
    olvidarHoja();
    const o = ordenDe(E.flujo?.ordenId as number);
    abrirFalla("correctivo.abrir", { activoId: o.activo?.id ?? null, ubicacionId: o.lugar?.ubicacionId ?? null, sucursalId: o.lugar?.sedeId ?? E.sede, rubro: o.rubro ?? "infraestructura", nota: final }, `Correctivo: ${tituloOrden(o)}`);
    detenerOrden(o, final, h.valor, escrito);
  },
  problemaDetener() {
    const final = notaDeProblema();
    if (!final) return;
    const h = E.hoja;
    const escrito = $<HTMLTextAreaElement>("#nota-problema")?.value ?? "";
    olvidarHoja();
    detenerOrden(ordenDe(E.flujo?.ordenId as number), final, h.valor, escrito);
  },
  abrirCorrectivoDesdeFin() {
    const o = ordenDe(E.flujo?.ordenId as number);
    const crit = o.pasos.find((p: Any) => p.estado === "desviacion" && p.critico);
    abrirFalla("correctivo.abrir", { activoId: o.activo?.id ?? null, ubicacionId: o.lugar?.ubicacionId ?? null, sucursalId: o.lugar?.sedeId ?? E.sede, rubro: o.rubro ?? "infraestructura", nota: crit?.nota ?? "Punto crítico con novedad durante el preventivo." }, `Correctivo: ${tituloOrden(o)}`);
    pintar();
  },
  noconf() {
    // «Hay una alarma» lleva la lectura escrita, si la hay; una que se lee de dos formas se corrige primero.
    const l = $<HTMLInputElement>("#lectura");
    const leido = l ? leerNumero(l.value) : null;
    if (l && leido?.tipo === "ambiguo") { pedirNumero(leido.mensaje, l); return; }
    abrirHoja({ tipo: "novedad", valor: leido ? valorDe(leido) : null, at: new Date().toISOString() });
  },
  novedadSeguir() {
    const h = E.hoja;
    const t = $<HTMLTextAreaElement>("#nota-novedad");
    const nota = t?.value.trim() ?? "";
    if (!h.opcional && nota.length < 3) { const e = $("#err-novedad"); if (e) e.hidden = false; t?.focus(); return; }
    const pt = E.p.ronda.puntos[(E.flujo as Flujo).i];
    olvidarHoja();
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
    olvidarHoja();
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
  // «Cancelar»: la hoja se cierra y lo que se había escrito en ella se borra, con sus fotos que todavía
  // no salieron. Si vino de otra hoja, vuelve a esa.
  cerrarHoja() { olvidarHoja(true); cerrarHoja(); },
  pausar() { abrirHoja({ tipo: "pausar", foco: false }); },
  motivoPausa(d, b) {
    document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true");
    E.hoja.motivo = d.m;
    guardarBorrador();
  },
  confirmarPausa() {
    const t = $<HTMLTextAreaElement>("#nota-pausa");
    const motivo = t?.value.trim() || E.hoja?.motivo;
    if (!motivo) { const e = $("#err-pausa"); if (e) e.hidden = false; return; }
    const id = Number(E.flujo?.ordenId ?? E.params?.id);
    void despachar({ tipo: "orden.pausar", ordenId: id, motivo, ...conTexto({ [`pausa:${id}`]: t?.value ?? "" }) });
    olvidarHoja();
    soltarPantalla();
    E.flujo = null;
    aviso("En pausa. La retomas desde Hoy.");
    ir("#hoy", true);
  },
  verNota() { E.verNota = true; pintar({ conservar: true }); },
  verTodo(_d, b) { b.classList.toggle("entero"); },
  enviar() {
    const f = E.flujo as Flujo;
    const o = ordenDe(f.ordenId as number);
    if (!o) return;
    const nota = ($<HTMLTextAreaElement>("#nota-fin")?.value ?? E.notas[`fin:${o.id}`] ?? "").trim();
    const err = $("#err-fin");
    const decir = (m: string) => { if (err) { err.textContent = m; err.hidden = false; } };
    // Un paso que pide lectura y no la tiene no se envía: el servidor no lo aceptaría y lo escrito volvería a la orden.
    const sinLectura = (o.pasos ?? []).findIndex(pasoSinLectura);
    if (sinLectura >= 0) { pedirLecturaDePaso(o, sinLectura); return; }
    if (o.modo !== "pasos" && nota.length < 10) { decir("Escribe qué encontraste y qué hiciste (al menos 10 letras)."); $<HTMLTextAreaElement>("#nota-fin")?.focus(); return; }
    if (o.modo === "pasos" && !o.pasos.length && nota.length < 10) { decir("Describe lo que hiciste (al menos 10 letras)."); return; }
    if (o.modo === "intervencion" && !o.reversa?.ejecutada) {
      // Una obligatoria con rango cuenta como medida solo con su número, igual que en el servidor.
      const mal = (o.liberaciones ?? []).find((l: Any) => l.obligatoria && (!medidaConNumero(l) || l.conforme === false));
      if (mal) { decir(!mal.medida ? `Falta la lectura de «${mal.etiqueta}».` : mal.conforme === false ? `«${mal.etiqueta}» quedó fuera de rango: repite la lectura o marca la reversa.` : `«${mal.etiqueta}» necesita el número que marcó el instrumento.`); return; }
    }
    E.listo = { titulo: [o.activo?.codigo, tituloOrden(o)].filter(Boolean).join(" · "), lugar: o.lugar?.ubicacion, sinEnviar: !E.enLinea };
    // La causa raíz la escribe la jefatura: el celular manda solo lo que el técnico encontró e hizo.
    // Lo escrito y los opcionales saltados viajan con el envío: si el servidor no lo acepta, vuelven a la orden.
    const saltos = Object.fromEntries([`pre:${o.id}`, `lib:${o.id}`].filter((k) => E.saltos[k]?.length).map((k) => [k, E.saltos[k]]));
    void despachar({ tipo: "orden.terminar", ordenId: o.id, nota: nota || null, ...conTexto({ [`fin:${o.id}`]: nota }, Object.keys(saltos).length ? saltos : undefined) });
    zumbar();
    soltarPantalla();
    olvidarDeOrden(o.id);
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
    const delTurno = `:${r.fecha}:${r.turno}`;
    olvidar((k) => k === `entrega${delTurno}` || /^(rlect|novedad|noverif):/.test(k) && k.includes(`${delTurno}:`));
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
    const campo = $<HTMLInputElement>("#valor-desv");
    const valor = campo?.value ?? null;
    const nota = $<HTMLTextAreaElement>("#nota-desv")?.value ?? "";
    // El valor medido es un número: uno que se lee de dos formas haría que el servidor no abriera la desviación.
    const leido = leerNumero(valor);
    if (leido.tipo === "ambiguo") { const e = $("#err-desv"); if (e) { e.textContent = leido.mensaje; e.hidden = false; } campo?.focus(); return; }
    void despachar({ tipo: "aop.abrir", procedimientoId: d.id, activoId: a?.id ?? null, ubicacionId: a?.ubicacionId ?? null, sucursalId: a?.sedeId ?? E.sede, valor, nota, ...conTexto({ [`desv:${a?.id}`]: nota, [`desv-valor:${a?.id}`]: valor }) });
    olvidarHoja();
    zumbar();
    aviso(`Desviación abierta. Actuar antes de ${plazo(d.actuarMin)}.`);
    soltarHistorialDeHoja();
    ir("#hoy", true);
  },
  fallaEmergencia() {
    const fi = E.b.ficha;
    const nota = $<HTMLTextAreaElement>("#nota-falla")?.value.trim() ?? "";
    olvidarHoja();
    abrirFalla("emergencia.abrir", { eop: fi.falla?.codigo, activoId: fi.activo.id, ubicacionId: fi.activo.ubicacionId, sucursalId: fi.activo.sedeId ?? E.sede, nota, ...conTexto({ [`falla:${fi.activo.id}`]: nota }) }, `Emergencia: ${fi.activo.nombre}`);
    soltarHistorialDeHoja();
    ir("#hoy", true);
  },
  fallaCorrectivo() {
    const fi = E.b.ficha;
    const t = $<HTMLTextAreaElement>("#nota-falla");
    const nota = t?.value.trim() ?? "";
    if (nota.length < 5) { const e = $("#err-falla"); if (e) e.hidden = false; t?.focus(); return; }
    olvidarHoja();
    abrirFalla("correctivo.abrir", { activoId: fi.activo.id, ubicacionId: fi.activo.ubicacionId, sucursalId: fi.activo.sedeId ?? E.sede, nota, ...conTexto({ [`falla:${fi.activo.id}`]: nota }) }, `Correctivo: ${fi.activo.nombre}`);
    soltarHistorialDeHoja();
    ir("#hoy", true);
  },
  otraFalla() { abrirHoja({ tipo: "otra" }); },
  otraEnviar() {
    const t = $<HTMLTextAreaElement>("#nota-otra");
    const nota = t?.value.trim() ?? "";
    if (nota.length < 5) { const e = $("#err-otra"); if (e) e.hidden = false; t?.focus(); return; }
    olvidarHoja();
    abrirFalla("correctivo.abrir", { sucursalId: E.sede, rubro: "infraestructura", nota, ...conTexto({ [`otra:${E.sede}`]: nota }) }, `Correctivo: ${nota.slice(0, 60)}`);
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
  if (fuera) asegurarBorrador();
  // Tocar afuera cierra la hoja, pero no las que piden una decisión. Lo escrito queda en el borrador.
  if (t === $("#hoja") && E.hoja && !["aop", "eop", "pideOrden", "nolibera"].includes(E.hoja.tipo)) cerrarHoja();
});
movil.addEventListener("input", (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.id === "lectura") evaluarLectura();
  // Lo que se escribe se guarda en el celular mientras se escribe.
  if (t.dataset.nota) { E.notas[t.dataset.nota] = t.value; guardarBorrador(); }
  if (t.id === "filtro") {
    const q = t.value.trim().toLowerCase();
    document.querySelectorAll<HTMLElement>(".lista [data-q]").forEach((f) => { f.style.display = !q || (f.dataset.q ?? "").includes(q) ? "" : "none"; });
  }
});
movil.addEventListener("keydown", (ev) => {
  const t = ev.target as HTMLElement;
  if (ev.key !== "Enter") return;
  if (t.id === "lectura") { ev.preventDefault(); if (E.vista === "liberacion") A.lecturaLib({}, t); else guardarLectura(); }
  if (t.id === "referencia") { ev.preventDefault(); A.cumplido({}, t); }
});
movil.addEventListener("change", async (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.tagName === "SELECT" && t.dataset.nota) { E.notas[t.dataset.nota] = t.value; guardarBorrador(); return; }
  if (!t.matches("[data-foto]") || !t.files?.[0]) return;
  const r = t.nextElementSibling?.classList.contains("foto-res") ? (t.nextElementSibling as HTMLElement) : $("#foto-res");
  if (!r) return;
  // De qué orden y de qué hoja es la foto, y su lugar en la cola, se deciden al tomarla, no al terminar de reducirla.
  const archivo = t.files[0];
  const clave = t.dataset.clave ?? "";
  const categoria = t.dataset.foto;
  const ordenId = E.flujo?.ordenId;
  const at = new Date().toISOString();
  t.value = "";
  r.classList.add("si");
  if (!ordenId) { r.textContent = "No se pudo leer esa imagen. Prueba tomarla otra vez."; return; }
  const hoja = hojaViva(clave);
  const seq = nuevoSeq();
  apartadas.add(seq);
  const limite = setTimeout(() => { if (apartadas.delete(seq)) void drenar(); }, LIMITE_FOTO_MS);
  r.textContent = "Reduciendo la foto…";
  try {
    const c = await comprimir(archivo);
    // La hoja se canceló mientras tanto: la foto no se envía.
    if (hoja.fin === "cancelada") return;
    // Mientras la hoja siga abierta, la foto lleva su clave: si el técnico la cancela antes de que salga, no se envía.
    // Si la hoja ya se envió, la foto es de lo anotado y ninguna hoja posterior la cuenta como suya.
    await meter({ seq, uid: UID, opId: uuid(), at, tipo: "foto", ordenId, categoria, blob: c.blob, nombre: `foto-${Date.now()}.jpg`, ...(hoja.fin ? {} : { clave }) });
    if (hoja.fin) return;
    // La foto ya está en la cola: si la página se recarga, esta hoja dice «1 foto lista».
    const n = (E.fotos[clave] ?? 0) + 1;
    if (clave) { E.fotos[clave] = n; guardarBorrador(true); }
    // La hoja pudo cerrarse y abrirse otra vez mientras se reducía: se avisa en la que está a la vista.
    const campo = r.isConnected ? t : [...document.querySelectorAll<HTMLInputElement>("[data-foto]")].find((x) => x.dataset.clave === clave);
    const res = r.isConnected ? r : campo?.nextElementSibling;
    if (res) { res.classList.add("si"); res.innerHTML = `<img alt="Foto guardada" src="${c.url}"><span><b>${n === 1 ? "1 foto lista" : `${n} fotos listas`}.</b> Tu foto de ${peso(c.antes)} quedó en ${peso(c.despues)}. Se envía por detrás; puedes seguir.</span>`; }
    const etiqueta = campo ? document.querySelector(`label[for="${campo.id}"]`) : null;
    if (etiqueta) etiqueta.innerHTML = `${ico.camara}Otra foto`;
  } catch {
    r.textContent = "No se pudo leer esa imagen. Prueba tomarla otra vez.";
  } finally {
    clearTimeout(limite);
    apartadas.delete(seq);
    void drenar();
  }
});
window.addEventListener("popstate", () => {
  if (E.hoja && !history.state?.hoja) { E.hoja = null; pintarHoja(); return; }
  ruta();
});
window.addEventListener("online", () => { E.enLinea = true; esperaMs = 5000; refrescarPill(); void drenar(); void refrescarHoy(); });
window.addEventListener("offline", () => { E.enLinea = false; refrescarPill(); });
window.addEventListener("pagehide", asegurarBorrador);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") { asegurarBorrador(); return; }
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
  const borrador = await cola.leer<Any>(BORRADOR);
  if (borrador) {
    E.notas = { ...(borrador.notas ?? {}), ...E.notas };
    E.fotos = { ...(borrador.fotos ?? {}), ...E.fotos };
    E.saltos = { ...(borrador.saltos ?? {}), ...E.saltos };
    const pant = borrador.pantalla;
    if (pant?.hash && Date.now() - (borrador.en ?? 0) < VIGENCIA_PANTALLA_MS) {
      // Abierta desde el ícono, sin dirección: vuelve a donde estaba.
      if (!location.hash || location.hash === "#") history.replaceState(history.state, "", pant.hash);
      if (location.hash === pant.hash) E.restaurar = pant;
    }
  }
  borradorListo = true;
  const copia = await cola.leer<Any>(`hoy:${UID}`);
  if (copia) {
    E.base = copia;
    if (!E.sede) E.sede = copia.sedeId ?? null;
    rebase();
    E.cargando = false;
  }
  ruta();
  // Una hoja que ya no se va a reabrir no deja una entrada que Atrás tenga que gastar.
  if (!E.hoja && !E.hojaPendiente && history.state?.hoja) history.replaceState({}, "", location.hash || "#hoy");
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
