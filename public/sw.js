// Modo técnico · sirve la pantalla cuando no hay señal.
//
// Solo atiende /campo y sus archivos. El resto de la aplicación y toda la API
// pasan directo a la red: aquí no se guarda ningún dato de negocio. Los datos sin
// enviar viven en IndexedDB y los maneja la página.
// Sube con cada cambio de la pantalla del técnico: la copia anterior se borra al activarse.
const CACHE = "campo-v4";
const PANTALLA = "/campo";
const ARCHIVOS = ["/_astro/", "/fonts/", "/icons/", "/brand/"];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (ev) => {
  const d = ev.data || {};
  if (d.tipo === "olvidar") ev.waitUntil(caches.delete(CACHE));
  if (d.tipo === "guardar" && Array.isArray(d.urls)) ev.waitUntil(guardarArchivos(d.urls, d.soltar !== false));
});

// La página dice qué usa. Se guarda eso y se suelta lo de versiones anteriores, salvo cuando la página pide solo
// agregar: lo hace al cambiar de servicio, y ahí puede ser una pestaña que quedó abierta con la versión anterior.
async function guardarArchivos(urls, soltar) {
  const cache = await caches.open(CACHE);
  const vigentes = new Set();
  for (const u of urls) {
    const url = new URL(u, self.location.origin);
    if (url.origin !== self.location.origin) continue;
    vigentes.add(url.pathname);
    if (await cache.match(url.pathname)) continue;
    try {
      const res = await fetch(url.pathname);
      if (res.ok && !res.redirected) await cache.put(url.pathname, res);
    } catch {}
  }
  if (!soltar) return;
  for (const req of await cache.keys()) {
    const p = new URL(req.url).pathname;
    if (p !== PANTALLA && !vigentes.has(p)) await cache.delete(req);
  }
}

async function pantalla(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && !res.redirected) await cache.put(PANTALLA, res.clone());
    return res;
  } catch {
    const copia = await cache.match(PANTALLA);
    if (copia) return copia;
    throw new Error("sin señal y sin copia");
  }
}

async function archivo(req) {
  const cache = await caches.open(CACHE);
  const copia = await cache.match(new URL(req.url).pathname);
  return copia || fetch(req);
}

self.addEventListener("fetch", (ev) => {
  if (ev.request.method !== "GET") return;
  const u = new URL(ev.request.url);
  if (u.origin !== self.location.origin) return;
  if (u.pathname === PANTALLA || u.pathname === PANTALLA + "/") {
    ev.respondWith(pantalla(ev.request));
    return;
  }
  if (ARCHIVOS.some((p) => u.pathname.startsWith(p))) ev.respondWith(archivo(ev.request));
});
