// Lectura de fixtures (solo lectura). Todo se resuelve desde ctx.directory, nunca rutas absolutas.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { extraerCotizacion, extraerFactura, parseFecha } from "../domain/extraccion.js";
import {
  AprobacionSchema, CentroCostoSchema, CondicionPagoSchema, CorreoSchema, IndicadorIvaSchema, ProveedorSchema, SolicitudSchema,
  type Maestros, type Paquete,
} from "../domain/tipos.js";

export const dirFixtures = (root: string) => process.env.FIXTURES_DIR ?? join(root, "fixtures", "reto-03");
const CASO = /^[\w-]+$/;

function leerJson<T>(ruta: string, schema: z.ZodType<T>, nombre: string): T {
  let crudo: unknown;
  try { crudo = JSON.parse(readFileSync(ruta, "utf8")); } catch (e) { throw new Error(`${nombre}: JSON malformado (${(e as Error).message})`); }
  const r = schema.safeParse(crudo);
  if (!r.success) throw new Error(`${nombre}: ${r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"} ${i.message}`).join("; ")}`);
  return r.data;
}

const cache = new Map<string, Maestros>();
export function leerMaestros(root: string): Maestros {
  const base = join(dirFixtures(root), "maestros");
  const hit = cache.get(base);
  if (hit) return hit;
  const m: Maestros = {
    proveedores: leerJson(join(base, "proveedores.json"), z.array(ProveedorSchema), "proveedores.json"),
    centros: leerJson(join(base, "centros-costo.json"), z.array(CentroCostoSchema), "centros-costo.json"),
    iva: leerJson(join(base, "indicadores-iva.json"), z.array(IndicadorIvaSchema), "indicadores-iva.json"),
    pagos: leerJson(join(base, "condiciones-pago.json"), z.array(CondicionPagoSchema), "condiciones-pago.json"),
  };
  cache.set(base, m);
  return m;
}

export function listarCasos(root: string): string[] {
  const dir = join(dirFixtures(root), "solicitudes");
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
}

/** HU-1: lee y normaliza el paquete. Un adjunto ausente queda en null y se lista en `faltantes`. */
export function leerPaquete(root: string, caso: string): Paquete {
  if (!CASO.test(caso)) throw new Error(`Nombre de caso inválido: ${caso}`);
  const dir = join(dirFixtures(root), "solicitudes", caso);
  if (!existsSync(dir)) throw new Error(`No existe el caso ${caso}`);
  const faltantes: string[] = [];
  const ruta = (f: string) => { const p = join(dir, f); if (!existsSync(p)) { faltantes.push(f); return null; } return p; };

  const pCorreo = ruta("correo.json"), pSol = ruta("solicitud.json"), pCot = ruta("cotizacion.txt"), pApr = ruta("aprobacion.json");
  const pFac = existsSync(join(dir, "factura.txt")) ? join(dir, "factura.txt") : null; // la factura es opcional: no es un faltante
  if (!pSol) throw new Error(`El caso ${caso} no tiene solicitud.json: no se puede procesar. Pedir al solicitante el Excel de solicitud.`);

  const correo = pCorreo ? leerJson(pCorreo, CorreoSchema, "correo.json") : null;
  const solicitud = leerJson(pSol, SolicitudSchema, "solicitud.json");

  let cotizacion: Paquete["cotizacion"] = null;
  if (pCot) {
    const texto = readFileSync(pCot, "utf8");
    const c = extraerCotizacion(texto);
    if (c.total === null) faltantes.push("cotizacion.txt: total no legible");
    else cotizacion = { ...c, total: c.total, texto };
  }

  let aprobacion: Paquete["aprobacion"] = null;
  if (pApr) {
    const a = leerJson(pApr, AprobacionSchema, "aprobacion.json");
    const texto = a.cuerpo;
    aprobacion = {
      de: a.de, para: typeof a.para === "string" ? a.para : Array.isArray(a.para) ? a.para.join(", ") : null,
      fecha: a.fecha, asunto: a.asunto ?? "", texto,
      // "Aprobado" presente y no negado ("no aprobado", "no queda aprobado")
      aprobado: /\baprobad[oa]\b/i.test(texto) && !/\bno\s+(?:\w+\s+){0,2}aprobad[oa]\b/i.test(texto),
    };
  }

  let factura: Paquete["factura"] = null;
  if (pFac) {
    const f = extraerFactura(readFileSync(pFac, "utf8"));
    if (f.fecha) factura = { numero: f.numero ?? "(sin número)", fecha: f.fecha, total: f.total ?? 0 };
    else faltantes.push("factura.txt: fecha no legible");
  }

  return {
    correo: correo ? { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha } : { id: `${caso}-sin-correo`, de: solicitud.solicitante, asunto: "", fecha: solicitud.fecha_solicitud },
    solicitud: { ...solicitud, fecha_solicitud: parseFecha(solicitud.fecha_solicitud) ?? solicitud.fecha_solicitud },
    cotizacion, aprobacion, factura, faltantes,
  };
}
