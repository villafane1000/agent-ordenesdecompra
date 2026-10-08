// HU-3 y HU-4: evidencia de aprobación y payload de la OC con trazabilidad de cada valor.
import { createHash } from "node:crypto";
import { emailDe } from "./reglas.js";
import { OrdenCompraSchema, type OrdenCompra, type Paquete, type Validacion } from "./tipos.js";

/** Contenido canónico de la evidencia (sin la línea del hash). El sha256 se calcula sobre este texto. */
export function textoEvidencia(p: Paquete): string {
  const a = p.aprobacion;
  if (!a) throw new Error("No hay correo de aprobación para generar evidencia");
  return [
    "EVIDENCIA DE APROBACIÓN DE COMPRA",
    `Solicitud: ${p.solicitud.solicitud_id}`,
    "",
    `De: ${a.de}`,
    `Para: ${a.para ?? ""}`,
    `Fecha: ${a.fecha}`,
    `Asunto: ${a.asunto}`,
    "",
    a.texto.trim(),
    "",
  ].join("\n");
}
export const sha256 = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

function unidad(p: Paquete): "UN" | "H" | "MES" {
  const u = (p.solicitud.unidad ?? "").toUpperCase();
  if (u === "H" || u === "MES" || u === "UN") return u;
  const d = p.solicitud.descripcion.toLowerCase();
  if (/\bhoras?\b|\bh\b/.test(d)) return "H";
  if (/\bmes(es)?\b|mensual|suscripci[oó]n/.test(d)) return "MES";
  return "UN";
}

export type Fuente = "solicitud" | "cotizacion" | "correo" | "aprobacion" | "derivado" | "constante" | `maestro.${string}`;
export type Trazabilidad = Record<string, { valor: unknown; fuente: Fuente }>;

export function construirPayload(p: Paquete, v: Validacion, confirmadoPor: string | null = null): { orden: OrdenCompra; trazabilidad: Trazabilidad } {
  if (!v.apta) throw new Error(`La solicitud tiene bloqueos (${v.bloqueos.map((b) => b.regla).join(", ")}): no se construye la OC.`);
  const s = p.solicitud, a = p.aprobacion!, prov = v.derivados.proveedor!;
  const iva = s.indicador_iva ?? v.derivados.indicador_iva?.valor;
  const pago = s.condiciones_pago ?? v.derivados.condiciones_pago?.valor;
  if (!iva) throw new Error("No hay indicador de IVA ni en la solicitud ni en el proveedor.");
  if (!pago) throw new Error("No hay condiciones de pago ni en la solicitud ni en el proveedor.");
  const moneda = s.moneda.toUpperCase();
  if (moneda !== "COP" && moneda !== "USD") throw new Error(`Moneda no soportada: ${s.moneda}`);

  const t: Trazabilidad = {};
  const set = <T>(campo: string, valor: T, fuente: Fuente): T => { t[campo] = { valor, fuente }; return valor; };

  const orden = OrdenCompraSchema.parse({
    referencia: {
      solicitud_id: set("referencia.solicitud_id", s.solicitud_id, "solicitud"),
      correo_id: set("referencia.correo_id", p.correo.id, "correo"),
      cotizacion_ref: set("referencia.cotizacion_ref", p.cotizacion?.numero ?? null, "cotizacion"),
    },
    sociedad: set("sociedad", "1000", "constante"),
    organizacion_compras: set("organizacion_compras", "1000", "constante"),
    proveedor: {
      codigo_sap: set("proveedor.codigo_sap", prov.codigo_sap, "maestro.proveedores"),
      nit: set("proveedor.nit", prov.nit, "maestro.proveedores"),
      nombre: set("proveedor.nombre", prov.nombre, "maestro.proveedores"),
    },
    moneda: set("moneda", moneda, "solicitud"),
    condiciones_pago: set("condiciones_pago", pago, s.condiciones_pago ? "solicitud" : "derivado"),
    aprobador: {
      email: set("aprobador.email", emailDe(a.de), "aprobacion"),
      fecha_aprobacion: set("aprobador.fecha_aprobacion", a.fecha, "aprobacion"),
      evidencia_sha256: set("aprobador.evidencia_sha256", sha256(textoEvidencia(p)), "derivado"),
    },
    posiciones: [{
      numero: set("posiciones[0].numero", 10, "constante"),
      descripcion: set("posiciones[0].descripcion", s.descripcion.slice(0, 40), "solicitud"),
      cantidad: set("posiciones[0].cantidad", s.cantidad, "solicitud"),
      unidad: set("posiciones[0].unidad", unidad(p), s.unidad ? "solicitud" : "derivado"),
      precio_unitario: set("posiciones[0].precio_unitario", s.valor_unitario, "solicitud"),
      centro_costo: set("posiciones[0].centro_costo", s.centro_costo, "solicitud"),
      subarea: set("posiciones[0].subarea", s.subarea, "solicitud"),
      indicador_iva: set("posiciones[0].indicador_iva", iva, s.indicador_iva ? "solicitud" : "derivado"),
    }],
    excepciones: set("excepciones", v.confirmaciones.map((c) => ({ codigo: c.regla, detalle: c.detalle, confirmado_por: confirmadoPor })), "derivado"),
  });
  return { orden, trazabilidad: t };
}
