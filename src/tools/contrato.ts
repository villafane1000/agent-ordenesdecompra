// Contrato de herramientas del PRD 6.2: { description, args (zod), execute(args, ctx) → string JSON }.
import { z } from "zod";

export interface ToolCtx {
  /** Raíz del proyecto: las herramientas resuelven rutas desde aquí. */
  directory: string;
  sessionId: string;
  /** CA3: true solo si el último mensaje del usuario es una confirmación explícita. Lo fija el runtime, no el modelo. */
  confirmacionUsuario?: boolean;
}

export interface Herramienta<A extends z.ZodRawShape = z.ZodRawShape> {
  description: string;
  args: A;
  execute(args: z.infer<z.ZodObject<A>>, ctx: ToolCtx): Promise<string>;
}

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };
export const ok = <T>(data: T) => JSON.stringify({ ok: true, data } satisfies Resultado<T>);
export const fallo = (error: string) => JSON.stringify({ ok: false, error } satisfies Resultado<never>);

/** Envuelve la lógica para que la herramienta NUNCA lance: cualquier error vuelve como { ok: false, error }. */
export async function seguro<T>(fn: () => Promise<T> | T): Promise<string> {
  try { return ok(await fn()); } catch (e) { return fallo(e instanceof Error ? e.message : String(e)); }
}

/** Valida los argumentos con zod antes de ejecutar; si no cumplen, devuelve el error al modelo. */
export async function invocar(h: Herramienta, argsCrudos: unknown, ctx: ToolCtx): Promise<string> {
  const r = z.object(h.args).safeParse(argsCrudos ?? {});
  if (!r.success) return fallo("Argumentos inválidos: " + r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  try { return await h.execute(r.data, ctx); } catch (e) { return fallo(e instanceof Error ? e.message : String(e)); }
}
