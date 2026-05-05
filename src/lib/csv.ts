// Helper para exportar a CSV (compatible con Excel: BOM UTF-8 + comas + CRLF)

export function toCsv(rows: any[], columnas: { key: string; label: string }[]): string {
  // BOM para que Excel detecte UTF-8 correctamente
  const lines: string[] = ["﻿" + columnas.map((c) => csvEscape(c.label)).join(",")];
  for (const row of rows) {
    lines.push(columnas.map((c) => csvEscape(formatCell(row[c.key]))).join(","));
  }
  return lines.join("\r\n");
}

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Si contiene coma, comilla o salto de línea, escapar con comillas
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatCell(v: any): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  // Fechas SQLite vienen como "2024-01-15 12:34:56" → convertir a ISO
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v)) {
    return v.replace(" ", "T");
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

// Construye filtro de fechas (createdAt, completadaEn, etc.) en SQL desde query string
export function rangoFechas(url: URL): { desde: string | null; hasta: string | null } {
  return {
    desde: url.searchParams.get("desde") || null,
    hasta: url.searchParams.get("hasta") || null,
  };
}
