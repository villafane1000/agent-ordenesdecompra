// Esquemas zod de fixtures, paquete normalizado (PRD 7.2) y orden de compra (PRD 7.4).
import { z } from "zod";

// ── Fixtures (PRD 7.1) ──────────────────────────────────────────────
export const CorreoSchema = z.object({
  id: z.string(), de: z.string(), asunto: z.string(), fecha: z.string(),
  cuerpo: z.string().optional(), adjuntos: z.array(z.unknown()).optional(),
}).loose();

const numero = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n)) { ctx.addIssue({ code: "custom", message: `monto no numérico: ${v}` }); return z.NEVER; }
  return n;
});

export const SolicitudSchema = z.object({
  solicitud_id: z.string(), solicitante: z.string(), proveedor_nombre: z.string(),
  proveedor_nit: z.string().nullish(), descripcion: z.string(), centro_costo: z.string(), subarea: z.string(),
  cantidad: numero, valor_unitario: numero, valor_total: numero, moneda: z.string(),
  indicador_iva: z.string().nullish(), condiciones_pago: z.string().nullish(), fecha_solicitud: z.string(),
  unidad: z.string().nullish(),
}).loose();
export type Solicitud = z.infer<typeof SolicitudSchema>;

export const AprobacionSchema = z.object({ de: z.string(), para: z.unknown().optional(), fecha: z.string(), asunto: z.string().optional(), cuerpo: z.string() }).loose();
export type AprobacionRaw = z.infer<typeof AprobacionSchema>;

export const ProveedorSchema = z.object({
  codigo_sap: z.string(), nit: z.string(), nombre: z.string(),
  condiciones_pago_default: z.string().nullish(), indicador_iva_default: z.string().nullish(), activo: z.boolean(),
}).loose();
export type Proveedor = z.infer<typeof ProveedorSchema>;

export const CentroCostoSchema = z.object({
  centro_costo: z.string(), subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), tope: numero })),
}).loose();
export type CentroCosto = z.infer<typeof CentroCostoSchema>;

export const IndicadorIvaSchema = z.object({ codigo: z.string(), descripcion: z.string().optional(), tasa: numero }).loose();
export const CondicionPagoSchema = z.object({ codigo: z.string(), descripcion: z.string().optional(), dias: numero }).loose();
export type IndicadorIva = z.infer<typeof IndicadorIvaSchema>;
export type CondicionPago = z.infer<typeof CondicionPagoSchema>;

export interface Maestros { proveedores: Proveedor[]; centros: CentroCosto[]; iva: IndicadorIva[]; pagos: CondicionPago[] }

// ── Paquete normalizado (PRD 7.2) ───────────────────────────────────
export interface Paquete {
  correo: { id: string; de: string; asunto: string; fecha: string };
  solicitud: Solicitud;
  cotizacion: { proveedor: string; nit: string | null; numero: string | null; subtotal: number | null; iva: number | null; total: number; moneda: string; validez_hasta: string | null; texto: string } | null;
  aprobacion: { de: string; para: string | null; fecha: string; asunto: string; aprobado: boolean; texto: string } | null;
  factura: { numero: string; fecha: string; total: number } | null;
  faltantes: string[];
}

// ── Resultado de validación (HU-2) ─────────────────────────────────
/** Comparación explícita de los dos valores que motivan una confirmación (p. ej. solicitud vs cotización). */
export interface Comparacion { campo: string; valores: Array<{ fuente: string; valor: string }>; diferencia?: string; resultado: string }
export interface Hallazgo { regla: string; detalle: string; accion?: string; comparacion?: Comparacion }
export interface Derivados { indicador_iva?: { valor: string; fuente: string }; condiciones_pago?: { valor: string; fuente: string }; proveedor?: { codigo_sap: string; nit: string; nombre: string } ; aprobador?: { email: string; tope: number } }
export interface Validacion { apta: boolean; bloqueos: Hallazgo[]; confirmaciones: Hallazgo[]; derivados: Derivados; retroactiva: boolean }

// ── Orden de compra (PRD 7.4) ──────────────────────────────────────
export const OrdenCompraSchema = z.object({
  referencia: z.object({ solicitud_id: z.string(), correo_id: z.string(), cotizacion_ref: z.string().nullable() }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string().min(1),
  aprobador: z.object({ email: z.string(), fecha_aprobacion: z.string(), evidencia_sha256: z.string().length(64) }),
  posiciones: z.array(z.object({
    numero: z.number().int(),
    descripcion: z.string().max(40),
    cantidad: z.number().positive(),
    unidad: z.enum(["UN", "H", "MES"]),
    precio_unitario: z.number().nonnegative(),
    centro_costo: z.string(),
    subarea: z.string(),
    indicador_iva: z.string().min(1),
  })).min(1),
  excepciones: z.array(z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })),
});
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>;
