// API HTTP (PRD 6.4), compartida por Vercel (api/*) y el servidor local (scripts/dev-server.ts).
import { z } from "zod";
import { chat, obtenerSesion, proveedorActivo } from "./agent/runtime.js";

const ChatBody = z.object({
  sessionId: z.string().max(64).nullish(),
  message: z.string().min(1).max(4000),
  modo: z.enum(["llm", "reglas"]).optional(),
  historial: z.array(z.unknown()).max(600).optional(),
});

export async function postChat(req: Request): Promise<Response> {
  const body = ChatBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, error: "Cuerpo inválido: se espera { sessionId?, message }" }, { status: 400 });
  try {
    // historial: copia que guarda el navegador, solo se usa si la instancia serverless no tiene la sesión
    return Response.json(await chat(body.data as Parameters<typeof chat>[0]));
  } catch (e) {
    console.error("[chat]", e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: "Error interno procesando el mensaje. La sesión sigue activa; intenta de nuevo." }, { status: 500 });
  }
}

export const getHealth = () => Response.json({ ok: true, ...proveedorActivo() });

export function getSesion(id: string): Response {
  const s = obtenerSesion(id);
  return s ? Response.json({ ok: true, sessionId: s.id, historial: s.visibles, tokens: s.tokens }) : Response.json({ ok: false, error: "Sesión no encontrada" }, { status: 404 });
}
