// Handler HTTP compartido por Vercel (api/chat.ts) y el servidor local (server.ts).
import { turno, type Peticion } from "./agent/runtime.js";

export async function manejarChat(req: Request): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "Usa POST" }, { status: 405 });
  let body: Peticion;
  try { body = (await req.json()) as Peticion; } catch { return Response.json({ error: "JSON inválido" }, { status: 400 }); }
  try {
    return Response.json(await turno(body));
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[chat]", msg);
    // Degradación controlada: si el modelo falla, se informa y el cliente puede pasar a modo reglas
    return Response.json({ error: msg, sugerencia: "Puedes cambiar al modo sin LLM" }, { status: 502 });
  }
}

export const estado = () => Response.json({ ok: true, modoLlmDisponible: !!process.env.ANTHROPIC_API_KEY, modelo: process.env.MODEL ?? "claude-sonnet-5-5" });
