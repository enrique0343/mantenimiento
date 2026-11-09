// Modo técnico · lo que aún no llega al servidor y la última copia del día.
//
// Vive en IndexedDB para sobrevivir a que se cierre el navegador o se apague el
// celular. Si IndexedDB no está disponible (navegación privada), funciona en
// memoria: se sigue trabajando, pero un cierre del navegador perdería lo pendiente.
export interface Op {
  seq: number;
  uid: number;
  opId: string;
  tipo: string;
  at: string;
  ordenId?: number;
  blob?: Blob;
  /** Lo que el técnico escribió, por su clave de borrador. No viaja: si el servidor rechaza la operación, vuelve al borrador. */
  borrador?: { notas?: Record<string, string>; saltos?: Record<string, number[]> };
  /**
   * En una foto, la clave de la hoja donde se tomó: si se cancela la hoja antes de que salga, no se
   * envía. Al enviar la hoja se quita: la foto ya es de lo que se anotó.
   */
  clave?: string;
  /** De qué orden es y qué se hizo, con el nombre del momento en que se hizo. No viaja: lo muestra «Ver por qué». */
  rotulo?: { que: string; accion: string };
  [k: string]: unknown;
}

const NOMBRE = "avante-campo";
const memoria = { ops: new Map<number, Op>(), kv: new Map<string, unknown>() };
let conexion: Promise<IDBDatabase | null> | null = null;

function abrir(): Promise<IDBDatabase | null> {
  if (!conexion) {
    conexion = new Promise((resolve) => {
      try {
        const r = indexedDB.open(NOMBRE, 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains("ops")) db.createObjectStore("ops", { keyPath: "seq" });
          if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return conexion;
}

function hecho<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function poner(op: Op): Promise<void> {
  const db = await abrir();
  if (!db) { memoria.ops.set(op.seq, op); return; }
  try {
    await hecho(db.transaction("ops", "readwrite").objectStore("ops").put(op));
  } catch {
    memoria.ops.set(op.seq, op);
  }
}

export async function quitar(seq: number): Promise<void> {
  memoria.ops.delete(seq);
  const db = await abrir();
  if (!db) return;
  try { await hecho(db.transaction("ops", "readwrite").objectStore("ops").delete(seq)); } catch {}
}

export async function deUsuario(uid: number): Promise<Op[]> {
  const db = await abrir();
  let todas: Op[] = [];
  if (db) {
    try { todas = await hecho(db.transaction("ops").objectStore("ops").getAll()); } catch {}
  }
  const unidas = new Map<number, Op>(todas.map((o) => [o.seq, o]));
  for (const [k, v] of memoria.ops) unidas.set(k, v);
  return [...unidas.values()].filter((o) => o.uid === uid).sort((a, b) => a.seq - b.seq);
}

export async function leer<T>(clave: string): Promise<T | undefined> {
  if (memoria.kv.has(clave)) return memoria.kv.get(clave) as T;
  const db = await abrir();
  if (!db) return undefined;
  try { return await hecho(db.transaction("kv").objectStore("kv").get(clave)); } catch { return undefined; }
}

export async function guardar(clave: string, valor: unknown): Promise<void> {
  const db = await abrir();
  if (!db) { memoria.kv.set(clave, valor); return; }
  try {
    await hecho(db.transaction("kv", "readwrite").objectStore("kv").put(valor, clave));
  } catch {
    memoria.kv.set(clave, valor);
  }
}

export async function pedirPersistencia(): Promise<void> {
  try { await navigator.storage?.persist?.(); } catch {}
}
