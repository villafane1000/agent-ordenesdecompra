// Ciclo del agente: prompt → modelo → herramientas → respuesta (PRD 6.3).
// Comportamiento en agent/prompt.md · conocimiento en src/knowledge/ · ejecución en src/tools/.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AdaptadorLLM, Mensaje } from "../llm/adapter.js";
import { AnthropicAdapter, claveAnthropic } from "../llm/anthropic.js";
import { ReglasAdapter, esConfirmacion } from "../llm/reglas.js";
import { dirOut, escribir, registrarLog } from "../out.js";
import { invocar } from "../tools/contrato.js";
import { definiciones, herramientas } from "../tools/index.js";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
const MAX_ITER = Number(process.env.MAX_ITERACIONES ?? 25);                 // CA1
const MAX_TOKENS_SESION = Number(process.env.MAX_TOKENS_SESION ?? 300000);  // tope de costo por sesión
const PRECIO_IN = Number(process.env.PRECIO_INPUT_MTOK ?? 3), PRECIO_OUT = Number(process.env.PRECIO_OUTPUT_MTOK ?? 15);

let sistema: string | null = null;
export function systemPrompt(): string {
  const cuerpo = (ruta: string) => readFileSync(join(ROOT, ruta), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim(); // sin frontmatter
  sistema ??= cuerpo("agent/prompt.md") + "\n\n---\n\n# Conocimiento del proceso\n\n" + cuerpo("src/knowledge/ordenes-compra.md");
  return sistema;
}

export interface ToolCallVisible { nombre: string; args: unknown; ok: boolean; resumen: string; resultado: unknown; ms: number }
export interface Sesion { id: string; mensajes: Mensaje[]; visibles: Array<{ rol: "user" | "assistant"; texto: string; toolCalls?: ToolCallVisible[]; needsConfirmation?: boolean }>; tokens: { entrada: number; salida: number } }
export interface RespuestaChat { sessionId: string; historial: Mensaje[]; reply: string; toolCalls: ToolCallVisible[]; needsConfirmation: boolean; modo: string; uso: { entrada: number; salida: number; costoUSD: number; tokensSesion: number } }

// ── Sesiones: memoria + archivo en out/sessions ──
const sesiones = new Map<string, Sesion>();
const idValido = (id: string) => /^[\w-]{1,64}$/.test(id);
const rutaSesion = (id: string) => join(dirOut(ROOT), "sessions", `${id}.json`);
export function obtenerSesion(id: string): Sesion | null {
  if (!idValido(id)) return null;
  const s = sesiones.get(id) ?? (existsSync(rutaSesion(id)) ? (JSON.parse(readFileSync(rutaSesion(id), "utf8")) as Sesion) : null);
  if (s) sesiones.set(id, s);
  return s;
}
const guardar = (s: Sesion) => { sesiones.set(s.id, s); escribir(rutaSesion(s.id), JSON.stringify(s)); };

export function adaptador(modo?: string): AdaptadorLLM {
  return modo === "reglas" || !claveAnthropic() ? new ReglasAdapter() : new AnthropicAdapter();
}
export const proveedorActivo = () => { const a = adaptador(); return { provider: a.proveedor, model: a.modelo }; };

/** Resumen corto del resultado para el front (el detalle completo va en `resultado`). */
function resumir(nombre: string, contenido: string): { ok: boolean; resumen: string; resultado: unknown } {
  const r = JSON.parse(contenido) as { ok: boolean; data?: Record<string, unknown>; error?: string };
  if (!r.ok) return { ok: false, resumen: r.error ?? "error", resultado: r };
  const d = r.data ?? {};
  const resumen =
    nombre === "oc_validar" ? `apta=${d.apta} · ${(d.bloqueos as unknown[]).length} bloqueos · ${(d.confirmaciones as unknown[]).length} confirmaciones · retroactiva=${d.retroactiva}` :
    nombre === "oc_crear" ? `OC ${d.numero_oc}${d.idempotente ? " (idempotente)" : ""}` :
    nombre === "oc_construir_payload" ? `payload válido (zod) · ${d.trazabilidad}` :
    nombre === "oc_generar_evidencia" ? `${d.ruta} · sha256 ${String(d.sha256).slice(0, 12)}…` :
    nombre === "oc_leer_paquete" ? `paquete leído${(d.faltantes as string[] | undefined)?.length ? ` · faltan: ${(d.faltantes as string[]).join(", ")}` : ""}` :
    nombre === "oc_listar_casos" ? (d as unknown as string[]).join(", ") : "ok";
  return { ok: true, resumen, resultado: r.data };
}

export async function chat(entrada: { sessionId?: string | null; message: string; modo?: string; historial?: Mensaje[] }): Promise<RespuestaChat> {
  const id = entrada.sessionId && idValido(entrada.sessionId) ? entrada.sessionId : crypto.randomUUID();
  const sesion: Sesion = obtenerSesion(id) ?? { id, mensajes: entrada.historial ?? [], visibles: [], tokens: { entrada: 0, salida: 0 } };
  let llm = adaptador(entrada.modo);
  const toolCalls: ToolCallVisible[] = [];
  const uso = { entrada: 0, salida: 0 };
  let reply = "";
  let confirmacionPendiente = false;

  sesion.mensajes.push({ rol: "user", texto: entrada.message });
  sesion.visibles.push({ rol: "user", texto: entrada.message });
  // CA3: la confirmación solo vale si ESTE mensaje del usuario confirma. El modelo no puede fabricarla.
  const ctx = { directory: ROOT, sessionId: id, sapScope: id, confirmacionUsuario: esConfirmacion(entrada.message) }; // cada sesión = sandbox de SAP

  if (llm.proveedor !== "reglas" && sesion.tokens.entrada + sesion.tokens.salida > MAX_TOKENS_SESION) {
    reply = `Se alcanzó el tope de tokens de esta sesión (${MAX_TOKENS_SESION}). Abre una sesión nueva o usa el modo sin LLM.`;
  } else {
    for (let i = 0; i < MAX_ITER; i++) {
      let r;
      try { r = await llm.enviar(sesion.mensajes, definiciones, systemPrompt()); }
      catch (e) {
        // CA5: error del proveedor en lenguaje claro; la sesión no muere y se continúa sin modelo.
        const msg = e instanceof Error ? e.message : String(e);
        registrarLog(ROOT, { sessionId: id, tipo: "error_llm", error: msg });
        reply += `⚠ El proveedor de IA no respondió (${msg.slice(0, 160)}). Continúo en modo sin LLM.\n\n`;
        llm = new ReglasAdapter();
        continue;
      }
      uso.entrada += r.uso.entrada; uso.salida += r.uso.salida;
      sesion.mensajes.push({ rol: "assistant", texto: r.texto, llamadas: r.llamadas });
      if (!r.llamadas.length) { reply += r.texto; break; }
      if (r.texto) reply += r.texto + "\n\n";

      const resultados: Array<{ id: string; nombre: string; contenido: string }> = [];
      for (const l of r.llamadas) {
        const t0 = Date.now();
        const h = herramientas[l.nombre];
        const contenido = h ? await invocar(h, l.args, ctx) : JSON.stringify({ ok: false, error: `Herramienta desconocida: ${l.nombre}` });
        const vis = resumir(l.nombre, contenido);
        toolCalls.push({ nombre: l.nombre, args: l.args, ...vis, ms: Date.now() - t0 });
        registrarLog(ROOT, { sessionId: id, tipo: "tool", nombre: l.nombre, args: l.args, ok: vis.ok, resumen: vis.resumen, ms: Date.now() - t0 }); // CA4
        if (l.nombre === "oc_validar" && vis.ok) { const v = vis.resultado as { apta: boolean; confirmaciones: unknown[] }; if (v.apta && v.confirmaciones.length) confirmacionPendiente = true; }
        if (l.nombre === "oc_crear") confirmacionPendiente = !vis.ok && /confirmaci[oó]n/i.test(vis.resumen);
        resultados.push({ id: l.id, nombre: l.nombre, contenido });
      }
      sesion.mensajes.push({ rol: "tool", resultados });
      if (i === MAX_ITER - 1) reply += `\n\n(Se alcanzó el tope de ${MAX_ITER} iteraciones en este turno. Pide continuar para seguir.)`; // CA1
    }
  }

  sesion.tokens.entrada += uso.entrada; sesion.tokens.salida += uso.salida;
  reply = reply.trim() || "(sin respuesta)";
  sesion.visibles.push({ rol: "assistant", texto: reply, toolCalls, needsConfirmation: confirmacionPendiente });
  guardar(sesion);
  registrarLog(ROOT, { sessionId: id, tipo: "turno", modo: llm.proveedor, uso, needsConfirmation: confirmacionPendiente });
  return {
    sessionId: id, historial: sesion.mensajes, reply, toolCalls, needsConfirmation: confirmacionPendiente, modo: llm.proveedor,
    uso: { ...uso, costoUSD: +((uso.entrada * PRECIO_IN + uso.salida * PRECIO_OUT) / 1e6).toFixed(5), tokensSesion: sesion.tokens.entrada + sesion.tokens.salida },
  };
}
