// Acceso a los maestros y solicitudes (fixtures). Solo lectura.
// MAÑANA: ajustar los tipos y nombres de campo a los fixtures reales.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Ruta relativa al propio archivo (src/data/ -> raíz), así funciona igual en local y en Vercel
const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const BASE = process.env.FIXTURES_DIR ?? join(RAIZ, "fixtures", "reto-03");

export interface Proveedor { nit: string; razonSocial: string; estado: string; indicadorIvaDefault?: string; condicionPagoDefault?: string; [k: string]: unknown }
export interface CentroCosto { codigo: string; nombre: string; subareas?: string[]; lider: string; topeAprobacion: number; [k: string]: unknown }
export interface IndicadorIva { codigo: string; descripcion?: string; tasa: number }
export interface CondicionPago { codigo: string; dias: number; descripcion?: string }

export interface Solicitud { id: string; solicitante: string; nitProveedor: string; centroCosto: string; subarea?: string; descripcion: string; monto: number; indicadorIva?: string; condicionPago?: string; fecha: string; [k: string]: unknown }
export interface Aprobacion { aprobador: string; estado: string; fecha: string; monto?: number; [k: string]: unknown }
export interface Correo { de: string; asunto: string; fecha: string; [k: string]: unknown }

export interface Caso { id: string; correo: Correo; solicitud: Solicitud; cotizacionTxt: string; aprobacion: Aprobacion | null; facturaTxt: string | null }

const json = <T>(p: string): T => JSON.parse(readFileSync(join(BASE, p), "utf8")) as T;
const txt = (p: string): string | null => (existsSync(join(BASE, p)) ? readFileSync(join(BASE, p), "utf8") : null);

let cache: { proveedores: Proveedor[]; centros: CentroCosto[]; iva: IndicadorIva[]; pagos: CondicionPago[] } | null = null;
export function maestros() {
  cache ??= {
    proveedores: json<Proveedor[]>("maestros/proveedores.json"),
    centros: json<CentroCosto[]>("maestros/centros-costo.json"),
    iva: json<IndicadorIva[]>("maestros/indicadores-iva.json"),
    pagos: json<CondicionPago[]>("maestros/condiciones-pago.json"),
  };
  return cache;
}

export const normNit = (n: string) => n.replace(/[^0-9]/g, "").slice(0, 9);

export function listarCasos(): string[] {
  return readdirSync(join(BASE, "solicitudes"), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

export function leerCaso(id: string): Caso {
  if (!/^[\w-]+$/.test(id) || !listarCasos().includes(id)) throw new Error(`No existe la solicitud ${id}`);
  const ap = txt(`solicitudes/${id}/aprobacion.json`);
  return {
    id,
    correo: json<Correo>(`solicitudes/${id}/correo.json`),
    solicitud: json<Solicitud>(`solicitudes/${id}/solicitud.json`),
    cotizacionTxt: txt(`solicitudes/${id}/cotizacion.txt`) ?? "",
    aprobacion: ap ? (JSON.parse(ap) as Aprobacion) : null,
    facturaTxt: txt(`solicitudes/${id}/factura.txt`),
  };
}
