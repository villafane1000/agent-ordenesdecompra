// Implementación del adaptador para Anthropic (Claude). La clave solo se lee del entorno del backend.
import Anthropic from "@anthropic-ai/sdk";
import type { AdaptadorLLM, DefinicionHerramienta, Mensaje, RespuestaLLM } from "./adapter.js";

export const claveAnthropic = () => process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY_GENERAL;

export class AnthropicAdapter implements AdaptadorLLM {
  readonly proveedor = "anthropic";
  private client: Anthropic;
  constructor(readonly modelo = process.env.MODEL ?? "claude-sonnet-5-5") {
    this.client = new Anthropic({
      apiKey: claveAnthropic(),
      timeout: Number(process.env.LLM_TIMEOUT_MS ?? 45000),
      maxRetries: 1,
      ...(process.env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } } : {}),
    });
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], sistema: string): Promise<RespuestaLLM> {
    const r = await this.client.messages.create({
      model: this.modelo,
      max_tokens: 2048,
      system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
      tools: herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: h.schema as Anthropic.Tool.InputSchema })),
      messages: mensajes.map(aAnthropic),
    });
    return {
      texto: r.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim(),
      llamadas: r.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use").map((b) => ({ id: b.id, nombre: b.name, args: b.input })),
      uso: { entrada: r.usage.input_tokens + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0), salida: r.usage.output_tokens },
    };
  }
}

function aAnthropic(m: Mensaje): Anthropic.MessageParam {
  if (m.rol === "user") return { role: "user", content: m.texto };
  if (m.rol === "assistant") {
    const content: Anthropic.ContentBlockParam[] = [];
    if (m.texto) content.push({ type: "text", text: m.texto });
    for (const l of m.llamadas) content.push({ type: "tool_use", id: l.id, name: l.nombre, input: l.args as Record<string, unknown> });
    return { role: "assistant", content: content.length ? content : [{ type: "text", text: "(sin texto)" }] };
  }
  return { role: "user", content: m.resultados.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.contenido, is_error: !(JSON.parse(r.contenido) as { ok: boolean }).ok })) };
}
