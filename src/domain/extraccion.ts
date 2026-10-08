// Extracción determinista de cotizaciones y facturas en texto plano. Sin LLM: reproducible y gratis.

/** "$13.500.000" | "13,500,000.50" | "13.500.000,50" | "USD 1,200.00" -> número */
export function parseMonto(raw: string): number {
  let s = raw.replace(/[^\d.,]/g, "");
  const dec = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  const cola = s.length - dec - 1;
  if (dec >= 0 && cola > 0 && cola <= 2) s = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1);
  else s = s.replace(/[.,]/g, "");
  return Number(s);
}

/** Normaliza fechas "2026-09-01", "01/09/2026", "1-9-2026" a ISO yyyy-mm-dd. */
export function parseFecha(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = raw.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

const linea = (t: string, re: RegExp) => t.match(re)?.[1]?.trim() ?? null;
const montoDe = (t: string, etiqueta: string) => {
  // Toma la ÚLTIMA línea que empieza con la etiqueta (evita confundir "Subtotal" con "Total")
  const lineas = t.split(/\r?\n/).filter((l) => new RegExp(`^\\s*${etiqueta}\\b`, "i").test(l));
  const l = lineas.at(-1);
  const m = l?.match(/([\d][\d.,]*)\s*$/) ?? l?.match(/:\s*[A-Z$]*\s*([\d][\d.,]*)/);
  return m ? parseMonto(m[1]) : null;
};

export interface CotizacionExtraida { proveedor: string; nit: string | null; numero: string | null; subtotal: number | null; iva: number | null; total: number | null; moneda: string; validez_hasta: string | null }

export function extraerCotizacion(t: string): CotizacionExtraida {
  const nit = linea(t, /NIT[^\d\n]*([\d.\-\s]{6,})/i)?.replace(/\s/g, "") ?? null;
  return {
    proveedor: linea(t, /^\s*(?:proveedor|raz[oó]n social|empresa)\s*:\s*(.+)$/im) ?? (t.split(/\r?\n/).find((l) => l.trim())?.trim() ?? ""),
    nit,
    numero: linea(t, /cotizaci[oó]n\s*(?:no\.?|n[°º]|#|n[uú]mero)?\s*:?\s*([A-Z0-9][\w-]*\d[\w-]*)/i),
    subtotal: montoDe(t, "subtotal"),
    iva: montoDe(t, "iva"),
    total: montoDe(t, "total"),
    moneda: /\bUSD\b|US\$/i.test(t) ? "USD" : "COP",
    validez_hasta: validez(t),
  };
}

/** Validez como fecha ("válida hasta 2026-09-30") o como plazo ("30 días" desde la fecha de la cotización). */
function validez(t: string): string | null {
  const raw = linea(t, /v[aá]lid[ae]z[^\n:]*:\s*(.+)/i) ?? linea(t, /v[aá]lid[ao] hasta[^\n:]*:?\s*(.+)/i);
  if (!raw) return null;
  const f = parseFecha(raw);
  if (f) return f;
  const dias = raw.match(/(\d+)\s*d[ií]as/i);
  const base = parseFecha(linea(t, /^\s*fecha[^\n:]*:\s*(.+)$/im));
  if (!dias || !base) return null;
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Number(dias[1]));
  return d.toISOString().slice(0, 10);
}

export interface FacturaExtraida { numero: string | null; fecha: string | null; total: number | null }
export function extraerFactura(t: string): FacturaExtraida {
  return {
    numero: linea(t, /factura[^\n]*?(?:no\.?|n[°º]|#|n[uú]mero)?\s*:?\s*([A-Z]{0,5}-?\d[\w-]*)/i),
    fecha: parseFecha(linea(t, /fecha[^\n:]*:\s*(.+)/i)),
    total: montoDe(t, "total"),
  };
}

/** Normaliza nombres de empresa para comparar: minúsculas, sin tildes, sin S.A.S./Ltda./puntuación. */
export function normNombre(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(s\.?\s?a\.?\s?s\.?|s\.?\s?a\.?|ltda\.?|limitada|sas|inc\.?|corp\.?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/** NIT sin dígito de verificación ni separadores. */
export const normNit = (n: string) => n.replace(/[^\d-]/g, "").split("-")[0].replace(/\D/g, "");
