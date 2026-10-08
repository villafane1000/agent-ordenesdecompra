// Bonus 9.4: sincroniza y verifica que modulo/ use exactamente las mismas piezas que la aplicación.
//   npx tsx scripts/modulo.ts          → verifica (falla si divergen)
//   npx tsx scripts/modulo.ts --sync   → copia agent/prompt.md y src/knowledge/ordenes-compra.md a modulo/
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
export const PARES: Array<[string, string]> = [
  ["agent/prompt.md", "modulo/agent.md"],
  ["src/knowledge/ordenes-compra.md", "modulo/skill/ordenes-compra/SKILL.md"],
];

export async function verificarModulo(): Promise<string[]> {
  const errores: string[] = [];
  for (const [app, mod] of PARES)
    if (readFileSync(join(root, app), "utf8") !== readFileSync(join(root, mod), "utf8")) errores.push(`${mod} difiere de ${app}`);
  const app = await import("../src/tools/oc.js");
  const mod = await import("../modulo/tools/oc.js");
  for (const k of ["leer_paquete", "validar", "construir_payload", "generar_evidencia", "crear"] as const)
    if (app[k] !== mod[k]) errores.push(`modulo/tools/oc.ts: ${k} no es la misma herramienta que src/tools/oc.ts`);
  return errores;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--sync")) for (const [app, mod] of PARES) { mkdirSync(dirname(join(root, mod)), { recursive: true }); copyFileSync(join(root, app), join(root, mod)); }
  const errores = await verificarModulo();
  console.log(errores.length ? `✗ Módulo divergente:\n  ${errores.join("\n  ")}` : "✓ modulo/ usa las mismas piezas que la aplicación (prompt, skill y herramientas).");
  process.exit(errores.length ? 1 : 0);
}
