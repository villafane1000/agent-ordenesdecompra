// "Proveedor" determinista sin modelo: implementa la misma interfaz y decide las llamadas con reglas fijas.
// Sirve de respaldo si no hay clave o el proveedor falla, y demuestra que el ciclo no depende del LLM.
import type { AdaptadorLLM, Llamada, Mensaje, RespuestaLLM } from "./adapter.js";

export const esConfirmacion = (t: string) => /^\s*(s[ií]\b|confirm[oa]?\b|confirmado|apruebo|adelante|procede|proceder|ok\b|dale|de acuerdo|est[aá] bien)/i.test(t) && !/\bno\b/i.test(t);
const casoDe = (t: string) => t.match(/sol-\d{3}/i)?.[0].toLowerCase() ?? null;

interface Res { ok: boolean; data?: Record<string, unknown> & { apta?: boolean; bloqueos?: Array<{ regla: string; detalle: string; accion?: string }>; confirmaciones?: Array<{ regla: string; detalle: string; accion?: string }> }; error?: string }

export class ReglasAdapter implements AdaptadorLLM {
  readonly proveedor = "reglas";
  readonly modelo = "determinista";

  async enviar(mensajes: Mensaje[]): Promise<RespuestaLLM> {
    const iUser = mensajes.map((m) => m.rol).lastIndexOf("user");
    const texto = (mensajes[iUser] as { texto: string }).texto;
    const despues = mensajes.slice(iUser + 1);
    const hechas = despues.flatMap((m) => (m.rol === "assistant" ? m.llamadas : []));
    const res = new Map<string, Res>();
    for (const m of despues) if (m.rol === "tool") for (const r of m.resultados) res.set(r.nombre, JSON.parse(r.contenido) as Res);
    const llamar = (nombre: string, args: object): RespuestaLLM => ({ texto: "", llamadas: [{ id: `r${mensajes.length}-${nombre}`, nombre, args } satisfies Llamada], uso: { entrada: 0, salida: 0 } });
    const decir = (t: string): RespuestaLLM => ({ texto: t, llamadas: [], uso: { entrada: 0, salida: 0 } });
    const hecho = (n: string) => hechas.some((l) => l.nombre === n);

    if (/list|qu[eé] (solicitudes|casos)|bandeja/i.test(texto) && !casoDe(texto)) {
      if (!hecho("oc_listar_casos")) return llamar("oc_listar_casos", {});
      return decir(`Casos disponibles: ${(res.get("oc_listar_casos")?.data as unknown as string[]).join(", ")}. Escribe por ejemplo "procesa sol-001".`);
    }

    if (esConfirmacion(texto)) {
      const caso = ultimoCaso(mensajes.slice(0, iUser));
      if (!caso) return decir("No hay ninguna solicitud pendiente de confirmación.");
      if (!hecho("oc_crear")) return llamar("oc_crear", { caso, confirmado: true });
      const r = res.get("oc_crear")!;
      return decir(r.ok ? `OC **${r.data!.numero_oc}** creada para ${caso}${r.data!.retroactiva ? " (marcada retroactiva = true en el log de control)" : ""}. ${r.data!.evidencia ? `Evidencia: ${r.data!.evidencia}.` : "(ya existía: idempotencia)"}` : `No se creó la OC: ${r.error}`);
    }

    const caso = casoDe(texto);
    if (!caso) return decir('Modo sin LLM. Comandos: "listar", "procesa sol-001", y "confirmo" cuando se pida confirmación.');
    if (!hecho("oc_leer_paquete")) return llamar("oc_leer_paquete", { caso });
    if (!res.get("oc_leer_paquete")!.ok) return decir(`No pude leer el paquete: ${res.get("oc_leer_paquete")!.error}`);
    if (!hecho("oc_validar")) return llamar("oc_validar", { caso });
    const v = res.get("oc_validar")!.data!;
    if (v.apta && !hecho("oc_construir_payload")) return llamar("oc_construir_payload", { caso });
    if (!hecho("oc_crear")) return llamar("oc_crear", { caso });
    const c = res.get("oc_crear")!;
    if (c.ok) return decir(`${caso}: todas las reglas OK. OC **${c.data!.numero_oc}** creada${c.data!.idempotente ? " (ya existía: idempotencia)" : ""}.`);
    if (!v.apta) return decir(`${caso}: **no se crea la OC**.\n${v.bloqueos!.map((b) => `✗ ${b.regla}: ${b.detalle}\n   Acción sugerida: ${b.accion}`).join("\n")}`);
    return decir(`${caso}: la OC está lista pero requiere tu confirmación:\n${v.confirmaciones!.map((x) => `? ${x.regla}: ${x.detalle}`).join("\n")}\n\n**¿Confirmas la creación de la OC?** Responde "confirmo".`);
  }
}

function ultimoCaso(mensajes: Mensaje[]): string | null {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i];
    if (m.rol === "assistant") for (const l of [...m.llamadas].reverse()) { const c = (l.args as { caso?: string })?.caso; if (c) return c; }
    if (m.rol === "user") { const c = casoDe(m.texto); if (c) return c; }
  }
  return null;
}
