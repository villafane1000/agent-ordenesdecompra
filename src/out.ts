// Escritura en out/ (control.csv, log.jsonl, evidencias, trazabilidad). En Vercel el disco es de solo
// lectura salvo /tmp, por eso OUT_DIR es configurable.
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const dirOut = (root: string) => process.env.OUT_DIR ?? (process.env.VERCEL ? "/tmp/out" : join(root, "out"));

export function escribir(ruta: string, contenido: string | Uint8Array) {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido);
}

export function limpiarOut(root: string) {
  rmSync(dirOut(root), { recursive: true, force: true });
}

const csv = (v: unknown) => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export interface FilaControl { solicitud_id: string; resultado: "creada" | "idempotente" | "bloqueada" | "pendiente_confirmacion" | "error"; numero_oc: string | null; retroactiva: boolean; bloqueos: string[]; confirmaciones: string[]; ts?: string }

/** HU-5: cada intento agrega una fila a out/control.csv. */
export function registrarControl(root: string, f: FilaControl) {
  const ruta = join(dirOut(root), "control.csv");
  if (!existsSync(ruta)) escribir(ruta, "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n");
  appendFileSync(ruta, [f.solicitud_id, f.resultado, f.numero_oc ?? "", f.retroactiva, f.bloqueos.join(" | "), f.confirmaciones.join(" | "), f.ts ?? new Date().toISOString()].map(csv).join(",") + "\n");
}

/** CA4: toda llamada a herramienta queda en out/log.jsonl. */
export function registrarLog(root: string, evento: Record<string, unknown>) {
  const ruta = join(dirOut(root), "log.jsonl");
  mkdirSync(dirname(ruta), { recursive: true });
  appendFileSync(ruta, JSON.stringify({ ts: new Date().toISOString(), ...evento }) + "\n");
}
