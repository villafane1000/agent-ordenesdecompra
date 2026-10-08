// Herramientas del agente de órdenes de compra. Cada export → nombre `oc_<export>` para el modelo.
// Son la ÚNICA fuente de valores que el agente puede afirmar (CA2) y no dependen del servidor HTTP.
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { z } from "zod";
import { leerMaestros, leerPaquete, listarCasos } from "../data/fixtures.js";
import { construirPayload, sha256, textoEvidencia } from "../domain/payload.js";
import { validar as validarReglas } from "../domain/reglas.js";
import type { OrdenCompra } from "../domain/tipos.js";
import { dirOut, escribir, registrarControl } from "../out.js";
import { SapMock } from "../sap/mock.js";
import type { SapAdapter } from "../sap/adapter.js";
import { seguro, type Herramienta, type ToolCtx } from "./contrato.js";

const caso = z.string().regex(/^[\w-]+$/).describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, p. ej. sol-001");
const paqueteArg = z.unknown().optional().describe("Paquete devuelto por oc_leer_paquete. Opcional: el servidor lo relee de la fuente para que nadie pueda alterarlo");

/** Fábrica del adaptador SAP: hoy el mock sobre archivos; en producción, el adaptador real (ver SOLUCION.md). */
export const crearSap = (ctx: ToolCtx): SapAdapter => new SapMock(ctx.directory, ctx.sapScope);

/** Recalcula todo desde la fuente: el modelo nunca aporta valores, solo el nombre del caso. */
function evaluar(ctx: ToolCtx, c: string) {
  const paquete = leerPaquete(ctx.directory, c);
  const validacion = validarReglas(paquete, leerMaestros(ctx.directory));
  return { paquete, validacion };
}

export const listar_casos: Herramienta<{}> = {
  description: "Lista los casos (solicitudes de compra) disponibles para procesar.",
  args: {},
  execute: (_a, ctx) => seguro(() => listarCasos(ctx.directory)),
};

export const leer_paquete: Herramienta<{ caso: typeof caso }> = {
  description: "Lee y normaliza el paquete de un caso: correo, solicitud, cotización, aprobación y factura (si existe); los adjuntos ausentes vienen en null y en `faltantes`.",
  args: { caso },
  execute: (a, ctx) => seguro(() => {
    const p = leerPaquete(ctx.directory, a.caso);
    // El texto completo de cotización y aprobación no se envía al modelo (ahorra tokens; los datos ya vienen extraídos)
    return { ...p, cotizacion: p.cotizacion && { ...p.cotizacion, texto: `(${p.cotizacion.texto.length} caracteres)` }, aprobacion: p.aprobacion && { ...p.aprobacion } };
  }),
};

export const validar: Herramienta<{ caso: typeof caso; paquete: typeof paqueteArg }> = {
  description: "Aplica las reglas de control RC1–RC10 y devuelve { apta, bloqueos[], confirmaciones[], derivados, retroactiva, oc_existente }.",
  args: { caso, paquete: paqueteArg },
  execute: (a, ctx) => seguro(async () => {
    const { paquete, validacion } = evaluar(ctx, a.caso);
    // Informa desde el inicio si la solicitud ya tiene OC: oc_crear no duplicará (idempotencia).
    const existente = await crearSap(ctx).buscarOrdenPorReferencia(paquete.solicitud.solicitud_id);
    return { ...validacion, oc_existente: existente?.numero_oc ?? null };
  }),
};

export const construir_payload: Herramienta<{ caso: typeof caso; paquete: typeof paqueteArg; derivados: typeof paqueteArg }> = {
  description: "Construye la orden de compra exactamente como quedaría en SAP (validada con zod) y guarda la trazabilidad de cada valor.",
  args: { caso, paquete: paqueteArg, derivados: paqueteArg },
  execute: (a, ctx) => seguro(() => {
    const { paquete, validacion } = evaluar(ctx, a.caso);
    const { orden, trazabilidad } = construirPayload(paquete, validacion);
    const ruta = join(dirOut(ctx.directory), a.caso, "trazabilidad.json");
    escribir(ruta, JSON.stringify(trazabilidad, null, 2));
    return { orden, trazabilidad: rel(ctx, ruta), confirmaciones_pendientes: validacion.confirmaciones.map((c) => c.regla) };
  }),
};

export const generar_evidencia: Herramienta<{ caso: typeof caso }> = {
  description: "Genera la evidencia del correo de aprobación (aprobacion.txt y aprobacion.pdf) con su sha256.",
  args: { caso },
  execute: (a, ctx) => seguro(async () => evidencia(ctx, a.caso)),
};

export const crear: Herramienta<{ caso: typeof caso; payload: typeof paqueteArg; confirmado: z.ZodOptional<z.ZodBoolean> }> = {
  description: "Crea la OC en SAP. Solo si no hay bloqueos y, si hay confirmaciones, con confirmado=true DESPUÉS de que el usuario confirme explícitamente. Es idempotente por solicitud.",
  args: { caso, payload: paqueteArg, confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente en su último mensaje") },
  execute: (a, ctx) => seguro(async () => {
    const { paquete, validacion: v } = evaluar(ctx, a.caso);
    const id = paquete.solicitud.solicitud_id;
    const fila = { solicitud_id: id, retroactiva: v.retroactiva, bloqueos: v.bloqueos.map((b) => `${b.regla}: ${b.detalle}`), confirmaciones: v.confirmaciones.map((c) => `${c.regla}: ${c.detalle}`) };
    const sap = crearSap(ctx);

    if (!v.apta) {
      registrarControl(ctx.directory, { ...fila, resultado: "bloqueada", numero_oc: null });
      throw new Error(`No se crea la OC: ${v.bloqueos.map((b) => `${b.regla} ${b.detalle} Acción: ${b.accion ?? "-"}`).join(" | ")}`);
    }
    const requiere = v.confirmaciones.length > 0;
    const confirmada = a.confirmado === true && ctx.confirmacionUsuario !== false;
    if (requiere && !confirmada) {
      registrarControl(ctx.directory, { ...fila, resultado: "pendiente_confirmacion", numero_oc: null });
      throw new Error(`Requiere confirmación explícita del usuario antes de crear: ${v.confirmaciones.map((c) => `${c.regla} ${c.detalle}`).join(" | ")}`);
    }
    // La idempotencia se evalúa DESPUÉS de la confirmación: una excepción siempre se pregunta antes de cualquier acción.
    const existente = await sap.buscarOrdenPorReferencia(id);
    if (existente) {
      registrarControl(ctx.directory, { ...fila, resultado: "idempotente", numero_oc: existente.numero_oc });
      return { numero_oc: existente.numero_oc, fecha: null, idempotente: true, retroactiva: v.retroactiva };
    }

    const { orden } = construirPayload(paquete, v, requiere ? `usuario (sesión ${ctx.sessionId})` : null);
    if (a.payload !== undefined && !mismoPayload(a.payload, orden)) throw new Error("El payload recibido no coincide con el validado por las reglas; se rechaza para evitar valores alterados. Reconstruye con oc_construir_payload.");
    const ev = await evidencia(ctx, a.caso);
    const r = await sap.crearOrden(orden);
    registrarControl(ctx.directory, { ...fila, resultado: "creada", numero_oc: r.numero_oc });
    return { numero_oc: r.numero_oc, fecha: r.fecha, idempotente: false, retroactiva: v.retroactiva, evidencia: ev.ruta, evidencia_pdf: ev.ruta_pdf };
  }),
};

// ── utilidades ─────────────────────────────────────────────────────
const rel = (ctx: ToolCtx, ruta: string) => ruta.startsWith(ctx.directory) ? ruta.slice(ctx.directory.length + 1) : ruta;

/** Compara lo que importa (montos, proveedor, cuentas); ignora quién confirmó las excepciones. */
function mismoPayload(recibido: unknown, real: OrdenCompra): boolean {
  const limpio = (o: OrdenCompra) => JSON.stringify({ ...o, excepciones: o.excepciones.map((e) => e.codigo) });
  try {
    const r = recibido as OrdenCompra;
    if (!r || typeof r !== "object" || !r.posiciones) return true; // payload resumido o vacío: se usa el validado
    return limpio(r) === limpio(real);
  } catch { return false; }
}

async function evidencia(ctx: ToolCtx, c: string) {
  const p = leerPaquete(ctx.directory, c);
  const texto = textoEvidencia(p);
  const hash = sha256(texto);
  const dir = join(dirOut(ctx.directory), c);
  const ruta = join(dir, "aprobacion.txt");
  escribir(ruta, `${texto}\nsha256: ${hash}\n`);
  const rutaPdf = join(dir, "aprobacion.pdf");
  escribir(rutaPdf, await pdf(texto, hash));
  return { ruta: rel(ctx, ruta), ruta_pdf: rel(ctx, rutaPdf), sha256: hash };
}

async function pdf(texto: string, hash: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const latin1 = (s: string) => s.replace(/[^\x20-\xFF]/g, "?");
  let page = doc.addPage([595, 842]);
  let y = 800;
  for (const l of [...texto.split("\n"), "", `sha256: ${hash}`]) {
    for (const trozo of (latin1(l).match(/.{1,95}/g) ?? [""])) {
      if (y < 50) { page = doc.addPage([595, 842]); y = 800; }
      page.drawText(trozo, { x: 50, y, size: 10, font: fuente });
      y -= 14;
    }
  }
  doc.setTitle("Evidencia de aprobación");
  doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0)); // determinismo
  return doc.save();
}
