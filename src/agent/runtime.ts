// Ciclo del agente. Sin estado en servidor: el cliente envía el historial en cada turno.
// Dos modos: "llm" (Claude con tool use) y "reglas" (orquestación determinista, sin modelo).
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { herramientas, porNombre, ejecutar } from "../tools/oc.js";
import { evaluarSolicitud, type Evaluacion } from "../domain/controles.js";
import { leerCaso } from "../data/repo.js";

type Msg = Anthropic.MessageParam;
export type Evento =
  | { tipo: "texto"; texto: string }
  | { tipo: "herramienta"; id: string; nombre: string; input: unknown; resultado?: unknown; error?: string; ms: number }
  | { tipo: "confirmacion"; id: string; nombre: string; input: unknown; decision: "aprobada" | "rechazada" };

export interface Pendiente { toolUseId: string; nombre: string; input: Record<string, unknown>; resultadosPrevios: Anthropic.ToolResultBlockParam[]; firma?: string; resumen?: ResumenOC }

/** Resumen determinista de la OC que se muestra al humano antes de aprobar (no lo redacta el modelo). */
export interface ResumenOC { solicitudId: string; decision: string; retroactiva: boolean; proveedor: string | null; nit: string; centroCosto: string; descripcion: string; subtotal: number; indicadorIva: string; tasaIva: number; iva: number; total: number; condicionPago: string; aprobadoPor: string | null; alertas: string[] }
export interface Peticion { modo?: "llm" | "reglas"; messages: Msg[]; mensaje?: string; confirmacion?: { toolUseId: string; aprobado: boolean; comentario?: string }; pendiente?: Pendiente }
export interface Respuesta { modo: "llm" | "reglas"; messages: Msg[]; eventos: Evento[]; pendiente: Pendiente | null; uso: { inputTokens: number; outputTokens: number; costoUSD: number; llamadas: number } }

/** Acepta ANTHROPIC_API_KEY o ANTHROPIC_API_KEY_GENERAL (nombre usado en Vercel). */
export const apiKey = () => process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY_GENERAL;

const MODEL = process.env.MODEL ?? "claude-sonnet-5-5";
const PRECIO_IN = Number(process.env.PRECIO_INPUT_MTOK ?? 3); // USD por millón de tokens (verificar tarifa vigente)
const PRECIO_OUT = Number(process.env.PRECIO_OUTPUT_MTOK ?? 15);
const MAX_ITER = 10;

let systemPrompt: string | null = null;
const prompt = () => (systemPrompt ??= readFileSync(join(fileURLToPath(new URL("../../", import.meta.url)), "agent", "prompt.md"), "utf8"));

const toolsApi: Anthropic.Tool[] = herramientas.map((h) => {
  const { $schema, ...schema } = z.toJSONSchema(h.input) as Record<string, unknown>;
  void $schema;
  return { name: h.name, description: h.description, input_schema: schema as Anthropic.Tool.InputSchema };
});

async function correrHerramienta(id: string, nombre: string, input: unknown, eventos: Evento[]): Promise<Anthropic.ToolResultBlockParam> {
  const t0 = Date.now();
  try {
    const resultado = await ejecutar(nombre, input);
    eventos.push({ tipo: "herramienta", id, nombre, input, resultado, ms: Date.now() - t0 });
    return { type: "tool_result", tool_use_id: id, content: JSON.stringify(resultado) };
  } catch (e) {
    const error = e instanceof z.ZodError ? "Entrada inválida: " + e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (e as Error).message;
    eventos.push({ tipo: "herramienta", id, nombre, input, error, ms: Date.now() - t0 });
    return { type: "tool_result", tool_use_id: id, content: error, is_error: true };
  }
}

// La acción pendiente viaja al navegador; se firma para que no pueda alterarse antes de aprobarla.
const SECRETO = process.env.SIGNING_SECRET ?? apiKey() ?? "dev-secret";
const firmar = (x: Pendiente) => createHmac("sha256", SECRETO).update(JSON.stringify([x.toolUseId, x.nombre, x.input, x.resultadosPrevios])).digest("hex");
const conFirma = (x: Pendiente | null) => (x ? { ...x, firma: firmar(x), resumen: resumir(x) } : null);

const cop = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
function textoResumen(r: ResumenOC): string {
  return [
    `**${r.solicitudId}** lista para orden de compra${r.retroactiva ? " (compra RETROACTIVA: requiere justificación)" : ""}.`,
    `- **Proveedor:** ${r.proveedor ?? "?"} (NIT ${r.nit})`,
    `- **Centro de costo:** ${r.centroCosto}`,
    `- **Subtotal / IVA / Total:** ${cop(r.subtotal)} / ${cop(r.iva)} (${r.indicadorIva}) / ${cop(r.total)}`,
    `- **Condición de pago:** ${r.condicionPago}`,
    `- **Aprobado por:** ${r.aprobadoPor ?? "—"}`,
    ...(r.alertas.length ? [`- **Alertas:** ${r.alertas.join("; ")}`] : []),
    "Confirma en el recuadro para crear la OC en SAP.",
  ].join("\n");
}

function resumir(x: Pendiente): ResumenOC | undefined {
  const id = x.input.solicitudId;
  if (x.nombre !== "crear_oc_sap" || typeof id !== "string") return undefined;
  try {
    const caso = leerCaso(id);
    const ev = evaluarSolicitud(caso);
    const v = ev.valores;
    return {
      solicitudId: id, decision: ev.decision, retroactiva: ev.retroactiva, proveedor: v.proveedor, nit: caso.solicitud.nitProveedor,
      centroCosto: caso.solicitud.centroCosto + (caso.solicitud.subarea ? " / " + caso.solicitud.subarea : ""), descripcion: caso.solicitud.descripcion,
      subtotal: v.subtotal, indicadorIva: v.indicadorIva, tasaIva: v.tasaIva, iva: v.iva, total: v.total, condicionPago: v.condicionPago,
      aprobadoPor: caso.aprobacion?.aprobador ?? null,
      alertas: ev.controles.filter((c) => c.resultado !== "OK").map((c) => `${c.id} ${c.control}: ${c.detalle}`),
    };
  } catch { return undefined; }
}
const firmaValida = (x: Pendiente) => { const a = Buffer.from(x.firma ?? ""), b = Buffer.from(firmar(x)); return a.length === b.length && timingSafeEqual(a, b); };

export async function turno(p: Peticion): Promise<Respuesta> {
  if (p.confirmacion && (!p.pendiente || !firmaValida(p.pendiente))) throw new Error("Acción pendiente inválida o alterada");
  const modo = p.modo === "reglas" || !apiKey() ? "reglas" : "llm";
  const r = modo === "llm" ? await turnoLlm(p) : await turnoReglas(p);
  const pendiente = conFirma(r.pendiente);
  // Garantía: antes de pedir aprobación, la persona siempre lee un resumen. Si el modelo
  // pausó sin explicar, el runtime lo escribe con las cifras de las reglas.
  const ultimo = r.eventos.at(-1);
  if (pendiente?.resumen && (r.modo === "reglas" || ultimo?.tipo !== "texto")) r.eventos.push({ tipo: "texto", texto: textoResumen(pendiente.resumen) });
  return { ...r, pendiente };
}

// ───────────────────────────── Modo LLM ─────────────────────────────
async function turnoLlm(p: Peticion): Promise<Respuesta> {
  const client = new Anthropic({
    apiKey: apiKey(),
    // Solo necesario si la API key no está asociada a un workspace
    ...(process.env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } } : {}),
  });
  const messages: Msg[] = [...(p.messages ?? [])];
  const eventos: Evento[] = [];
  const uso = { inputTokens: 0, outputTokens: 0, costoUSD: 0, llamadas: 0 };

  if (p.confirmacion && p.pendiente) {
    // Reanudar: ejecutar (o no) la herramienta que esperaba aprobación humana
    const pend = p.pendiente;
    if (pend.toolUseId !== p.confirmacion.toolUseId) throw new Error("La confirmación no corresponde a la acción pendiente");
    let res: Anthropic.ToolResultBlockParam;
    if (p.confirmacion.aprobado) {
      eventos.push({ tipo: "confirmacion", id: pend.toolUseId, nombre: pend.nombre, input: pend.input, decision: "aprobada" });
      res = await correrHerramienta(pend.toolUseId, pend.nombre, pend.input, eventos);
    } else {
      eventos.push({ tipo: "confirmacion", id: pend.toolUseId, nombre: pend.nombre, input: pend.input, decision: "rechazada" });
      res = { type: "tool_result", tool_use_id: pend.toolUseId, content: `El usuario RECHAZÓ la acción.${p.confirmacion.comentario ? " Comentario: " + p.confirmacion.comentario : ""} No la reintentes sin nueva instrucción.` };
    }
    messages.push({ role: "user", content: [...pend.resultadosPrevios, res] });
  } else if (p.mensaje) {
    messages.push({ role: "user", content: p.mensaje });
  }

  for (let i = 0; i < MAX_ITER; i++) {
    const r = await client.messages.create({ model: MODEL, max_tokens: 2048, system: prompt(), tools: toolsApi, messages });
    uso.llamadas++; uso.inputTokens += r.usage.input_tokens; uso.outputTokens += r.usage.output_tokens;
    messages.push({ role: "assistant", content: r.content });
    for (const b of r.content) if (b.type === "text" && b.text.trim()) eventos.push({ tipo: "texto", texto: b.text });
    if (r.stop_reason !== "tool_use") break;

    const usos = r.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const resultados: Anthropic.ToolResultBlockParam[] = [];
    let pendiente: Pendiente | null = null;
    for (const u of usos) {
      if (porNombre.get(u.name)?.requiereConfirmacion && !pendiente) {
        pendiente = { toolUseId: u.id, nombre: u.name, input: u.input as Record<string, unknown>, resultadosPrevios: [] };
      } else if (porNombre.get(u.name)?.requiereConfirmacion) {
        resultados.push({ type: "tool_result", tool_use_id: u.id, content: "Solo se confirma una acción a la vez; vuelve a pedirla después.", is_error: true });
      } else {
        resultados.push(await correrHerramienta(u.id, u.name, u.input, eventos));
      }
    }
    if (pendiente) {
      pendiente.resultadosPrevios = resultados;
      return { modo: "llm", messages, eventos, pendiente, uso: costo(uso) };
    }
    messages.push({ role: "user", content: resultados });
  }
  return { modo: "llm", messages, eventos, pendiente: null, uso: costo(uso) };
}

const costo = (u: Respuesta["uso"]) => ({ ...u, costoUSD: +((u.inputTokens * PRECIO_IN + u.outputTokens * PRECIO_OUT) / 1e6).toFixed(5) });

// ─────────────────────── Modo reglas (sin LLM) ───────────────────────
// Respaldo si no hay API key o si el modelo falla. Entiende: "listar", "procesa sol-001", "procesa todo".
async function turnoReglas(p: Peticion): Promise<Respuesta> {
  const eventos: Evento[] = [];
  const uso = { inputTokens: 0, outputTokens: 0, costoUSD: 0, llamadas: 0 };
  const fin = (pendiente: Pendiente | null = null): Respuesta => ({ modo: "reglas", messages: [], eventos, pendiente, uso });
  const say = (texto: string) => eventos.push({ tipo: "texto", texto });
  const tool = async (nombre: string, input: unknown) => {
    const r = await correrHerramienta(`r-${nombre}-${Date.now()}`, nombre, input, eventos);
    return r.is_error ? null : JSON.parse(r.content as string);
  };

  if (p.confirmacion && p.pendiente) {
    const pend = p.pendiente;
    eventos.push({ tipo: "confirmacion", id: pend.toolUseId, nombre: pend.nombre, input: pend.input, decision: p.confirmacion.aprobado ? "aprobada" : "rechazada" });
    if (!p.confirmacion.aprobado) { say("Entendido, no se creó la orden de compra."); return fin(); }
    const input = { ...pend.input, ...(p.confirmacion.comentario ? { justificacionRetroactiva: p.confirmacion.comentario } : {}) };
    const r = await tool(pend.nombre, input);
    say(r?.numeroOC ? `Orden de compra **${r.numeroOC}** ${r.duplicada ? "ya existía (idempotencia)" : "creada"} en SAP.` : `No se creó la OC: ${r?.motivo ?? "error"}`);
    return fin();
  }

  const texto = (p.mensaje ?? "").toLowerCase();
  const ids = texto.match(/sol-\d+/g);
  if (!ids && /list|bandeja|pendiente|qué hay|que hay/.test(texto)) {
    const l = await tool("listar_solicitudes", {});
    say(`Hay ${l.length} solicitudes en la bandeja: ${l.map((x: { id: string }) => x.id).join(", ")}. Escribe por ejemplo "procesa sol-001".`);
    return fin();
  }
  const objetivo: string[] = ids ?? (/todo|todas/.test(texto) ? (await tool("listar_solicitudes", {})).map((x: { id: string }) => x.id) : []);
  if (!objetivo.length) { say('Modo sin LLM. Comandos: "listar", "procesa sol-001", "procesa todo".'); return fin(); }

  for (const id of objetivo) {
    if (!(await tool("leer_solicitud", { solicitudId: id }))) { say(`No encontré ${id}.`); continue; }
    const ev: Evaluacion = await tool("validar_solicitud", { solicitudId: id });
    const malos = ev.controles.filter((c) => c.resultado !== "OK").map((c) => `${c.resultado === "BLOQUEO" ? "✗" : "!"} ${c.id} ${c.control}: ${c.detalle}`);
    say(`**${id}** → ${ev.decision}${malos.length ? "\n" + malos.join("\n") : "\nTodos los controles OK."}`);
    if (ev.decision !== "RECHAZADA" && objetivo.length === 1) {
      // El resumen previo a la aprobación lo agrega turno() con las cifras de las reglas.
      return fin({ toolUseId: `reglas-${id}`, nombre: "crear_oc_sap", input: { solicitudId: id }, resultadosPrevios: [] });
    }
  }
  return fin();
}
