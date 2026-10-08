// Script de verificación: procesa TODOS los casos llamando a las herramientas directamente, sin LLM.
// Uso: bun demo.ts   |   npx tsx demo.ts   (agrega --json para salida en JSON)
import { ejecutar } from "./src/tools/oc.js";
import type { Evaluacion } from "./src/domain/controles.js";

const comoJson = process.argv.includes("--json");
const icon = { OK: "✓", ALERTA: "!", BLOQUEO: "✗" } as const;
const resumen: Array<Record<string, unknown>> = [];

const lista = (await ejecutar("listar_solicitudes", {})) as Array<{ id: string; asunto: string }>;
for (const { id, asunto } of lista) {
  const ev = (await ejecutar("validar_solicitud", { solicitudId: id })) as Evaluacion;
  let oc: Record<string, unknown> | null = null;
  if (ev.decision !== "RECHAZADA") {
    // En la demo la "confirmación humana" se simula como aprobada; las retroactivas llevan justificación.
    oc = (await ejecutar("crear_oc_sap", {
      solicitudId: id,
      ...(ev.retroactiva ? { justificacionRetroactiva: "Regularización aprobada por el líder (demo)" } : {}),
    })) as Record<string, unknown>;
  }
  // Idempotencia: un segundo intento no debe crear otra OC
  const reintento = oc ? ((await ejecutar("crear_oc_sap", { solicitudId: id, justificacionRetroactiva: "Reintento de prueba de idempotencia" })) as Record<string, unknown>) : null;

  resumen.push({ id, decision: ev.decision, retroactiva: ev.retroactiva, oc: oc?.numeroOC ?? null, idempotente: reintento ? reintento.duplicada === true : null });
  if (!comoJson) {
    console.log(`\n■ ${id} — ${asunto}\n  Decisión: ${ev.decision}${ev.retroactiva ? "  [RETROACTIVA]" : ""}`);
    for (const c of ev.controles) console.log(`   ${icon[c.resultado]} ${c.id} ${c.control.padEnd(26)} ${c.detalle}`);
    console.log(oc?.numeroOC ? `  → OC ${oc.numeroOC} creada (total con IVA $${Number(oc.totalConIva).toLocaleString("es-CO")})` : "  → Sin OC");
  }
}
if (comoJson) console.log(JSON.stringify(resumen, null, 2));
else { console.log("\nResumen"); console.table(resumen); }
