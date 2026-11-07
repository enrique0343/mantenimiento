// PDF institucional · Sistema Visual Avante v2.0, modo controlado.
// Encabezado (A4) y folio (A5) iguales en cada página, Figtree embebida y tablas
// sin relleno (A7). Lo usan los PDF que se generan en el navegador.
(function () {
  const COLOR = { azul: [35, 65, 125], tinta: [26, 26, 26], tinta2: [74, 74, 74], filete: [189, 198, 216] };
  const CDN = "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js";

  function cargarJsPdf() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = CDN;
      s.onload = () => resolve(window.jspdf);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  async function base64(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("No se pudo cargar " + url);
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(bin);
  }
  async function fuentes(doc) {
    const lista = [["Figtree-Regular.ttf", "normal"], ["Figtree-SemiBold.ttf", "semibold"], ["Figtree-Bold.ttf", "bold"], ["Figtree-Italic.ttf", "italic"]];
    for (const [archivo, estilo] of lista) {
      doc.addFileToVFS(archivo, await base64("/fonts/" + archivo));
      doc.addFont(archivo, "Figtree", estilo);
    }
    doc.setFont("Figtree", "normal");
  }
  const hoy = () => {
    const s = new Date(Date.now() - 6 * 3600000).toISOString();
    return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  };

  async function crear(o) {
    const { jsPDF } = await cargarJsPdf();
    const doc = new jsPDF({ unit: "mm", format: "letter", orientation: o.orientacion || "p", compress: true });
    await fuentes(doc);
    let logo = null;
    try { logo = "data:image/png;base64," + (await base64("/brand/avante-logo.png")); } catch (e) { logo = null; }
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const MX = 25, ARRIBA = 32, ABAJO = 20;
    const ancho = W - MX * 2;
    let y = ARRIBA;
    const color = (c) => doc.setTextColor(c[0], c[1], c[2]);
    const fuente = (estilo, pt, c) => { doc.setFont("Figtree", estilo); doc.setFontSize(pt); color(c || COLOR.tinta); };
    const filete = (x1, yy, x2, c, g) => { const k = c || COLOR.azul; doc.setDrawColor(k[0], k[1], k[2]); doc.setLineWidth(g || 0.18); doc.line(x1, yy, x2, yy); };
    const saltoSi = (alto) => { if (y + alto > H - ABAJO) { doc.addPage(); y = ARRIBA; } };
    const etq = (txt) => txt.toUpperCase();

    const api = {
      doc, W, H, MX, ancho,
      get y() { return y; },
      set y(v) { y = v; },
      fuente,
      saltoSi,
      nivel1(numero, texto) {
        saltoSi(16);
        y += 3;
        filete(MX, y, W - MX);
        y += 6;
        if (numero) { fuente("semibold", 13, COLOR.azul); doc.text(String(numero), MX, y); }
        fuente("semibold", 13);
        doc.text(texto, MX + (numero ? 8 : 0), y);
        y += 6;
      },
      texto(txt, op) {
        const opciones = op || {};
        fuente(opciones.estilo || "normal", opciones.pt || 10, opciones.color);
        const lineas = doc.splitTextToSize(String(txt ?? ""), opciones.ancho || ancho);
        const paso = (opciones.pt || 10) * 0.46;
        for (const l of lineas) { saltoSi(paso); doc.text(l, opciones.x || MX, y); y += paso; }
        y += opciones.despues ?? 2;
      },
      etiqueta(txt, x) {
        fuente("bold", 7, COLOR.azul);
        doc.text(etq(txt), x ?? MX, y, { charSpace: 0.25 });
        y += 4;
      },
      /** columnas: [{ titulo, w (proporción), alinear: "right" | "center" }], filas: arreglos de texto */
      tabla(columnas, filas) {
        const total = columnas.reduce((s, c) => s + c.w, 0);
        const anchos = columnas.map((c) => (c.w / total) * ancho);
        const encabezado = () => {
          saltoSi(10);
          fuente("bold", 7, COLOR.azul);
          let x = MX;
          columnas.forEach((c, i) => {
            const al = c.alinear || "left";
            const px = al === "right" ? x + anchos[i] - 1.5 : al === "center" ? x + anchos[i] / 2 : x;
            doc.text(etq(c.titulo), px, y, { align: al, charSpace: 0.2 });
            x += anchos[i];
          });
          y += 1.6;
          filete(MX, y, W - MX);
          y += 4;
        };
        encabezado();
        for (const fila of filas) {
          fuente("normal", 9);
          const celdas = fila.map((v, i) => doc.splitTextToSize(String(v ?? "—"), anchos[i] - 2));
          const alto = Math.max(...celdas.map((c) => c.length)) * 4.2;
          if (y + alto > H - ABAJO) { doc.addPage(); y = ARRIBA; encabezado(); fuente("normal", 9); }
          let x = MX;
          celdas.forEach((lineas, i) => {
            const al = columnas[i].alinear || "left";
            const px = al === "right" ? x + anchos[i] - 1.5 : al === "center" ? x + anchos[i] / 2 : x;
            doc.text(lineas, px, y, { align: al });
            x += anchos[i];
          });
          y += alto - 2.4;
          filete(MX, y, W - MX, COLOR.filete);
          y += 4;
        }
        y += 2;
      },
      guardar(nombre) {
        const total = doc.getNumberOfPages();
        for (let n = 1; n <= total; n++) {
          doc.setPage(n);
          // Encabezado: logotipo, nombre del documento y claves de control.
          if (logo) doc.addImage(logo, "PNG", MX, 9, 42, 14);
          fuente("semibold", 9);
          doc.text(o.titulo, W / 2 + 4, 13.5, { align: "center", maxWidth: 70 });
          if (o.subtitulo) { fuente("normal", 8, COLOR.tinta2); doc.text(String(o.subtitulo), W / 2 + 4, 18, { align: "center", maxWidth: 70 }); }
          const claves = [];
          if (o.codigo) claves.push([o.etiquetaCodigo || "Código", o.codigo]);
          if (o.version != null) claves.push(["Versión", String(o.version)]);
          claves.push(["Fecha", o.fecha || hoy()]);
          claves.push(["Página", `${n} de ${total}`]);
          let yy = 11;
          for (const [k, v] of claves) {
            fuente("bold", 6.5, COLOR.azul);
            doc.text(etq(k), W - MX - 30, yy);
            fuente("normal", 8);
            doc.text(String(v), W - MX, yy, { align: "right" });
            yy += 3.6;
          }
          filete(MX, 26, W - MX);
          // Folio
          filete(MX, H - 14, W - MX);
          const folio = [o.codigo || o.titulo, o.version != null ? `Versión ${o.version}` : null, o.destino || "Uso interno"].filter(Boolean).join(" · ");
          fuente("semibold", 7, COLOR.tinta2);
          doc.text(etq(folio), MX, H - 10, { charSpace: 0.2 });
          fuente("bold", 7);
          doc.text(`${n} DE ${total}`, W - MX, H - 10, { align: "right" });
        }
        doc.save(nombre);
      },
    };
    return api;
  }

  window.pdfAvante = { crear };
})();
