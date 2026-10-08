// Extracción determinista de cotizaciones y facturas en texto plano.
// El LLM no extrae cifras: las cifras salen de aquí para que el resultado sea reproducible.

/** "$13.500.000" | "13,500,000.50" | "13.500.000,50" -> número */
export function parseMonto(raw: string): number {
  let s = raw.replace(/[^\d.,]/g, "");
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  const dec = Math.max(lastDot, lastComma);
  // Si el último separador deja exactamente 1-2 dígitos, es decimal
  if (dec >= 0 && s.length - dec - 1 <= 2 && s.length - dec - 1 > 0) {
    s = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1);
  } else {
    s = s.replace(/[.,]/g, "");
  }
  return Number(s);
}

const campo = (t: string, re: RegExp) => t.match(re)?.[1]?.trim() ?? null;
const monto = (t: string, etiqueta: string) => {
  const v = campo(t, new RegExp(`\\b${etiqueta}[^:\\n]*:\\s*\\$?\\s*([\\d.,]+)`, "i"));
  return v ? parseMonto(v) : null;
};
const fecha = (t: string, re: RegExp) => campo(t, re)?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;

export interface DatosCotizacion { numero: string | null; nit: string | null; proveedor: string | null; fecha: string | null; subtotal: number | null; iva: number | null; ivaPct: number | null; total: number | null; camposFaltantes: string[] }

export function extraerCotizacion(t: string): DatosCotizacion {
  const d: DatosCotizacion = {
    numero: campo(t, /cotizaci[oó]n\s*(?:no\.?|n[°º]|#)?\s*([\w-]+)/i),
    nit: campo(t, /NIT[:\s]*([\d.\-]+)/i),
    proveedor: campo(t, /proveedor:\s*(.+)/i),
    fecha: fecha(t, /fecha[^:\n]*:\s*(.+)/i),
    subtotal: monto(t, "subtotal"),
    iva: monto(t, "IVA"),
    ivaPct: (() => { const p = campo(t, /IVA\s*\((\d+(?:[.,]\d+)?)\s*%\)/i); return p ? Number(p.replace(",", ".")) / 100 : null; })(),
    total: monto(t, "total"),
    camposFaltantes: [],
  };
  for (const k of ["nit", "subtotal", "total"] as const) if (d[k] === null) d.camposFaltantes.push(k);
  return d;
}

export interface DatosFactura { numero: string | null; nit: string | null; fechaEmision: string | null; total: number | null }
export function extraerFactura(t: string): DatosFactura {
  return {
    numero: campo(t, /factura[^\n]*?\b([A-Z]{1,4}-?\d+)/i),
    nit: campo(t, /NIT[:\s]*([\d.\-]+)/i),
    fechaEmision: fecha(t, /fecha[^:\n]*:\s*(.+)/i),
    total: monto(t, "total"),
  };
}
