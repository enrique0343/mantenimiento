// Editor de plantillas de checklist (Fase 59 · ronda 2, WP-F). Lo que necesita la
// pantalla /configuracion/plantillas para armar y revisar una plantilla antes de
// mandarla a /api/checklist-plantillas, y la plantilla sugerida «Preventivo
// biomédico general» (requisitos JCI 17, alarmas, y 18, limpieza y desinfección).
//
// Puro y apto para el navegador: no importa zod, base de datos ni Astro. Lo usan la
// página (servidor y <script>), las rutas de la API y las pruebas.
import { leerNumero, textoDeNumero } from "./numero";
import { normalizarTexto } from "./biomedico";

/** Quién administra plantillas: la API y la pantalla dicen lo mismo. */
export const ROLES_PLANTILLAS = ["admin", "jefe"] as const;
export const puedeEditarPlantillas = (rol: string | null | undefined) => (ROLES_PLANTILLAS as readonly string[]).includes(rol ?? "");

export const MAX_PASOS = 200;
export const UNIDAD_MAX = 12;
export const RUTA_EDITOR = "/configuracion/plantillas";

/**
 * El 409 de PATCH /api/checklist-plantillas/{id} cuando los pasos están ligados:
 * lleva al editor, donde sí se cambian el nombre, la descripción y el estado.
 */
export const MENSAJE_PASOS_LIGADOS =
  `Esta plantilla tiene pasos con vínculos (variable, procedimiento, equipo, ubicación o acción si no cumple): para no perderlos, sus pasos no se reemplazan. En «Plantillas de checklist» (${RUTA_EDITOR}) puedes cambiar su nombre y su descripción, o desactivarla.`;

/**
 * Punto de partida para el preventivo de los equipos biomédicos. Ingeniería
 * Biomédica la edita después. Críticos: inspección, limpieza y prueba funcional,
 * que siempre aplican. Alarmas y seguridad eléctrica no son críticos para que el
 * celular ofrezca «No aplica» (un paso crítico no lo tiene).
 */
export const PLANTILLA_SUGERIDA = {
  nombre: "Preventivo biomédico general",
  descripcion:
    "Punto de partida para el preventivo de los equipos biomédicos. Ingeniería Biomédica ajusta los pasos, los criterios, los tiempos y las lecturas a cada familia de equipos y a su manual.",
  items: [
    {
      texto: "Inspección física del equipo, cables y accesorios",
      criterioAceptacion: "Carcasa, cable de alimentación, conectores y accesorios completos y sin daños.",
      bloqueante: true,
    },
    {
      texto: "Limpieza y desinfección según el protocolo del fabricante y el de Control de Infecciones",
      criterioAceptacion: "Limpio y desinfectado con el producto y el tiempo de contacto que indican el fabricante y Control de Infecciones.",
      bloqueante: true,
    },
    {
      texto: "Prueba de alarmas audibles y visuales",
      criterioAceptacion: "Cada alarma se activa, se ve y se oye. Equipo sin alarmas: No aplica.",
      bloqueante: false,
    },
    {
      texto: "Prueba funcional según el manual del fabricante",
      criterioAceptacion: "Funciones principales operativas, como indica el manual del fabricante.",
      bloqueante: true,
    },
    {
      texto: "Seguridad eléctrica (IEC 62353) cuando aplique",
      criterioAceptacion:
        "Si le toca la prueba (anual o después de una reparación), regístrala en «Seguridad eléctrica» del equipo. Si no le toca o funciona solo con batería: No aplica.",
      bloqueante: false,
    },
  ],
} as const;

/** Un paso como lo devuelve la API (GET /api/checklist-plantillas). */
export type PasoApi = {
  texto: string;
  criterioAceptacion?: string | null;
  bloqueante?: boolean | number | null;
  minutosEstimados?: number | null;
  materiales?: string | null;
  requiereValor?: boolean | number | null;
  unidad?: string | null;
  valorEsperadoMin?: number | null;
  valorEsperadoMax?: number | null;
};

/** Un paso como se escribe en el editor: lo de los campos, en texto. */
export type PasoEditor = {
  texto: string;
  criterio: string;
  critico: boolean;
  minutos: string;
  materiales: string;
  pideLectura: boolean;
  unidad: string;
  minimo: string;
  maximo: string;
};

/**
 * Lo que se manda a la API. Cada campo va explícito (null borra): así nada se
 * hereda del paso guardado con el mismo texto (filasDeReemplazo).
 */
export type PasoEnvio = {
  texto: string;
  criterioAceptacion: string | null;
  bloqueante: boolean;
  minutosEstimados: number | null;
  materiales: string | null;
  requiereValor: boolean;
  unidad: string | null;
  valorEsperadoMin: number | null;
  valorEsperadoMax: number | null;
};

export type CampoPaso = "texto" | "minutos" | "unidad" | "minimo" | "maximo";
export type ErrorPaso = { indice: number; campo: CampoPaso; mensaje: string };

export const MSG_EDITOR = {
  nombre: "Escribe el nombre de la plantilla.",
  texto: "Escribe qué se hace en este paso.",
  repetido: (paso: number) => `Ya hay un paso ${paso} con este texto: escribe uno distinto (por ejemplo, «Medir voltaje L1» y «Medir voltaje L2»).`,
  minutos: "Los minutos son un número entero mayor que cero.",
  unidad: `La unidad tiene como máximo ${UNIDAD_MAX} letras.`,
  numero: "Escribe solo el número, por ejemplo 0.3.",
  rango: "El mínimo no puede ser mayor que el máximo.",
  sinPasos: "Agrega al menos un paso.",
  quitarTodos: "Deja al menos un paso. Si la plantilla ya no se usa, desactívala.",
  muchos: `Una plantilla tiene como máximo ${MAX_PASOS} pasos.`,
  revisa: "Revisa los pasos marcados.",
  sinCambios: "No hay cambios para guardar.",
  sinConexion: "Sin conexión. Lo que escribiste sigue aquí: intenta de nuevo.",
  sesion: "Tu sesión terminó. Entra de nuevo en otra pestaña y vuelve a intentarlo: lo que escribiste sigue aquí.",
  permiso: "No tienes permiso para cambiar plantillas.",
  noGuardo: "No se pudo guardar la plantilla. Intenta de nuevo.",
  salir: "Hay cambios sin guardar en esta plantilla. ¿Salir sin guardarlos?",
} as const;

/** Confirmación antes de desactivar. Un MOP además deja de copiar sus prerrequisitos a las órdenes. */
export function confirmacionDesactivar(tipoDocumento: string | null | undefined): string {
  const base = "¿Desactivar esta plantilla? Ya no se ofrecerá al crear rutinas ni órdenes.";
  return tipoDocumento === "mop"
    ? `${base} Las órdenes de su procedimiento dejarán de copiar sus prerrequisitos y sus lecturas de liberación. Lo ya creado no cambia.`
    : `${base} Lo ya creado no cambia.`;
}

/** El cuerpo del POST que crea la plantilla sugerida, con cada campo explícito. */
export function envioSugerida(): { nombre: string; descripcion: string; items: PasoEnvio[] } {
  return {
    nombre: PLANTILLA_SUGERIDA.nombre,
    descripcion: PLANTILLA_SUGERIDA.descripcion,
    items: PLANTILLA_SUGERIDA.items.map((p) => ({
      texto: p.texto,
      criterioAceptacion: p.criterioAceptacion,
      bloqueante: p.bloqueante,
      minutosEstimados: null,
      materiales: null,
      requiereValor: false,
      unidad: null,
      valorEsperadoMin: null,
      valorEsperadoMax: null,
    })),
  };
}

export const esSugerida = (nombre: string | null | undefined) => claveNombre(nombre) === claveNombre(PLANTILLA_SUGERIDA.nombre);

export const pasoVacio = (): PasoEditor => ({
  texto: "", criterio: "", critico: false, minutos: "", materiales: "", pideLectura: false, unidad: "", minimo: "", maximo: "",
});

const numeroATexto = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? textoDeNumero(n) : "");

/** Un paso guardado, en los campos del editor. */
export function pasoEditorDesdeApi(p: PasoApi): PasoEditor {
  return {
    texto: p.texto ?? "",
    criterio: p.criterioAceptacion ?? "",
    critico: !!p.bloqueante,
    minutos: numeroATexto(p.minutosEstimados),
    materiales: p.materiales ?? "",
    pideLectura: !!p.requiereValor,
    unidad: p.unidad ?? "",
    minimo: numeroATexto(p.valorEsperadoMin),
    maximo: numeroATexto(p.valorEsperadoMax),
  };
}

const textoONull = (s: string) => (s.trim() ? s.trim() : null);

/** Un número escrito: vacío → null; si no se lee, el mensaje. */
function leerLimite(texto: string): { valor: number | null } | { error: string } {
  const r = leerNumero(texto);
  if (r.tipo === "vacio") return { valor: null };
  if (r.tipo === "numero") return { valor: r.valor };
  if (r.tipo === "ambiguo") return { error: r.mensaje };
  return { error: MSG_EDITOR.numero };
}

/**
 * Los pasos del editor como se mandan a la API, con los errores de cada campo.
 * Sin «Pide lectura», la unidad y el rango van vacíos (y no se revisan). Dos pasos
 * no pueden tener el mismo texto: el formulario de rutinas de la ficha toma el
 * criterio, el punto crítico y la lectura de cada paso por su texto.
 */
export function leerPasos(pasos: ReadonlyArray<PasoEditor>): { items: PasoEnvio[]; errores: ErrorPaso[] } {
  const errores: ErrorPaso[] = [];
  const vistos = new Map<string, number>();
  const items = pasos.map((p, indice): PasoEnvio => {
    const texto = p.texto.trim();
    if (!texto) errores.push({ indice, campo: "texto", mensaje: MSG_EDITOR.texto });
    else {
      const clave = normalizarTexto(texto);
      const antes = vistos.get(clave);
      if (antes !== undefined) errores.push({ indice, campo: "texto", mensaje: MSG_EDITOR.repetido(antes + 1) });
      else vistos.set(clave, indice);
    }

    let minutosEstimados: number | null = null;
    const m = leerNumero(p.minutos);
    if (m.tipo === "numero" && Number.isInteger(m.valor) && m.valor > 0) minutosEstimados = m.valor;
    else if (m.tipo !== "vacio") errores.push({ indice, campo: "minutos", mensaje: MSG_EDITOR.minutos });

    let unidad: string | null = null;
    let valorEsperadoMin: number | null = null;
    let valorEsperadoMax: number | null = null;
    if (p.pideLectura) {
      unidad = textoONull(p.unidad);
      if (unidad && unidad.length > UNIDAD_MAX) errores.push({ indice, campo: "unidad", mensaje: MSG_EDITOR.unidad });
      const min = leerLimite(p.minimo);
      const max = leerLimite(p.maximo);
      if ("error" in min) errores.push({ indice, campo: "minimo", mensaje: `Mínimo: ${min.error}` });
      else valorEsperadoMin = min.valor;
      if ("error" in max) errores.push({ indice, campo: "maximo", mensaje: `Máximo: ${max.error}` });
      else valorEsperadoMax = max.valor;
      if (valorEsperadoMin !== null && valorEsperadoMax !== null && valorEsperadoMin > valorEsperadoMax) {
        errores.push({ indice, campo: "maximo", mensaje: MSG_EDITOR.rango });
      }
    }
    return {
      texto,
      criterioAceptacion: textoONull(p.criterio),
      bloqueante: !!p.critico,
      minutosEstimados,
      materiales: textoONull(p.materiales),
      requiereValor: !!p.pideLectura,
      unidad,
      valorEsperadoMin,
      valorEsperadoMax,
    };
  });
  return { items, errores };
}

/** Los pasos guardados en la forma de envío: sirve para saber si el editor los cambió. */
export const pasosEnvioDesdeApi = (items: ReadonlyArray<PasoApi>): PasoEnvio[] => leerPasos(items.map(pasoEditorDesdeApi)).items;

export const mismosPasos = (a: ReadonlyArray<PasoEnvio>, b: ReadonlyArray<PasoEnvio>) => JSON.stringify(a) === JSON.stringify(b);

/** El nombre para comparar: sin tildes, sin mayúsculas y con un solo espacio. */
export const claveNombre = (nombre: string | null | undefined) => normalizarTexto(nombre);

/** La plantilla con ese nombre (sin contar tildes ni mayúsculas), salvo la propia. */
export function plantillaConNombre<T extends { id: number; nombre: string }>(lista: ReadonlyArray<T>, nombre: string, salvoId: number | null = null): T | null {
  const clave = claveNombre(nombre);
  if (!clave) return null;
  return lista.find((p) => p.id !== salvoId && claveNombre(p.nombre) === clave) ?? null;
}

export const mensajeNombreRepetido = (nombre: string) => `Ya existe una plantilla llamada «${nombre}». Usa otro nombre o abre esa plantilla.`;

/** Error del nombre antes de mandar: vacío o repetido. */
export function errorNombre(nombre: string, lista: ReadonlyArray<{ id: number; nombre: string }>, salvoId: number | null = null): string | null {
  if (!nombre.trim()) return MSG_EDITOR.nombre;
  const otra = plantillaConNombre(lista, nombre, salvoId);
  return otra ? mensajeNombreRepetido(otra.nombre) : null;
}

/** Cuántos pasos, cuántos piden lectura y cuántos son críticos. */
export function resumenPasos(items: ReadonlyArray<PasoApi>): { pasos: number; conLectura: number; criticos: number } {
  return {
    pasos: items.length,
    conLectura: items.filter((i) => !!i.requiereValor).length,
    criticos: items.filter((i) => !!i.bloqueante).length,
  };
}

/** El mensaje para la pantalla de una respuesta que no fue bien: el `error` de la API cuando lo trae. */
export function mensajeDeRespuesta(status: number, cuerpo: unknown, porDefecto: string = MSG_EDITOR.noGuardo): string {
  if (status === 401) return MSG_EDITOR.sesion;
  const error = cuerpo && typeof cuerpo === "object" ? (cuerpo as { error?: unknown }).error : null;
  if (typeof error === "string" && error.trim()) return error;
  if (status === 403) return MSG_EDITOR.permiso;
  return porDefecto;
}
