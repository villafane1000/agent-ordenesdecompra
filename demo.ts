// Verificación sin modelo (PRD 6.6): procesa los 6 casos llamando directamente a las herramientas.
// Uso: bun run demo.ts   ·   npx tsx demo.ts      (no requiere ninguna clave)
import { fileURLToPath } from "node:url";
import { herramientas } from "./src/tools/index.js";
import { invocar, type ToolCtx } from "./src/tools/contrato.js";
import { dirOut, limpiarOut } from "./src/out.js";
import { verificarModulo } from "./scripts/modulo.js";

const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
limpiarOut(root); // determinismo: out/ se limpia al inicio
const ctx: ToolCtx = { directory: root, sessionId: "demo", confirmacionUsuario: false };

interface Hallazgo { regla: string; detalle: string; accion?: string; comparacion?: { campo: string; valores: Array<{ fuente: string; valor: string }>; diferencia?: string; resultado: string } }
interface Datos { apta: boolean; retroactiva: boolean; bloqueos: Hallazgo[]; confirmaciones: Hallazgo[]; derivados: Record<string, { valor?: string; fuente?: string }>; trazabilidad: string; ruta: string; ruta_pdf: string; sha256: string; numero_oc: string; idempotente: boolean }
type R = { ok: boolean; data: Datos; error?: string };
const call = async (nombre: string, args: object, c: ToolCtx = ctx): Promise<R> => JSON.parse(await invocar(herramientas[nombre], args, c));
const linea = "─".repeat(78);

async function procesar(caso: string, confirmado = false) {
  const paquete = await call("oc_leer_paquete", { caso });
  if (!paquete.ok) return console.log(`  ✗ No se pudo leer el paquete: ${paquete.error}`);
  const v = (await call("oc_validar", { caso, paquete: paquete.data })).data;
  console.log(`  apta: ${v.apta}   retroactiva: ${v.retroactiva}`);
  for (const b of v.bloqueos) console.log(`  ✗ BLOQUEO ${b.regla}: ${b.detalle}\n      → ${b.accion}`);
  for (const c of v.confirmaciones) {
    console.log(`  ? CONFIRMAR ${c.regla}: ${c.detalle}`);
    if (c.comparacion) console.log(`      ${c.comparacion.valores.map((x) => `${x.fuente}: ${x.valor}`).join("  vs  ")}${c.comparacion.diferencia ? `  ·  diferencia ${c.comparacion.diferencia}` : ""}`);
  }
  for (const [k, d] of Object.entries(v.derivados)) if (d?.fuente) console.log(`  ↳ derivado ${k} = ${d.valor} (${d.fuente})`);
  if (v.apta) {
    const p = await call("oc_construir_payload", { caso, paquete: paquete.data, derivados: v.derivados });
    if (p.ok) console.log(`  payload OK (zod) · trazabilidad: ${p.data.trazabilidad}`);
    const e = await call("oc_generar_evidencia", { caso });
    if (e.ok) console.log(`  evidencia: ${e.data.ruta} · ${e.data.ruta_pdf} · sha256 ${e.data.sha256.slice(0, 16)}…`);
  }
  const c = await call("oc_crear", { caso, confirmado }, { ...ctx, confirmacionUsuario: confirmado });
  console.log(c.ok ? `  ⇒ OC ${c.data.numero_oc}${c.data.idempotente ? " (idempotente: ya existía)" : ""}` : `  ⇒ SIN OC: ${c.error}`);
  return c;
}

const casos = (JSON.parse(await invocar(herramientas.oc_listar_casos, {}, ctx)) as { data: string[] }).data;
console.log(`${linea}\nVerificación sin LLM · ${casos.length} casos · salida en ${dirOut(root)}\n${linea}`);
for (const caso of casos) { console.log(`\n■ ${caso}`); await procesar(caso); }

console.log(`\n${linea}\nIdempotencia: sol-001 por segunda vez\n${linea}`);
await procesar("sol-001");

for (const caso of casos.filter((c) => c !== "sol-001")) {
  const v = (await call("oc_validar", { caso })).data;
  if (v?.apta && v.confirmaciones.length) {
    console.log(`\n${linea}\nConfirmación explícita del usuario para ${caso}: "confirmo"\n${linea}`);
    await procesar(caso, true);
  }
}
console.log(`\n${linea}\nLog de control: ${dirOut(root)}/control.csv · SAP simulado: ${dirOut(root)}/sap/ordenes.jsonl\n${linea}`);

// Bonus 9.4: el módulo reutilizable debe usar exactamente las mismas piezas que la app.
const divergencias = await verificarModulo();
console.log(divergencias.length ? `✗ modulo/ divergente: ${divergencias.join("; ")}` : "✓ modulo/: agent.md, SKILL.md y tools/oc.ts son las mismas piezas que usa la aplicación.");
if (divergencias.length) process.exitCode = 1;
