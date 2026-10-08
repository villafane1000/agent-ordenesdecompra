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
      return decir(r.ok ? textoCreada(caso, r.data!) : `No se creó la OC: ${r.error}`);
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
    const orden = (res.get("oc_construir_payload")?.data as { orden?: Orden } | undefined)?.orden;
    const partes: string[] = [];
    if (c.ok) partes.push(`**${caso}: OC creada sin excepciones.**`);
    else if (!v.apta) partes.push(`**${caso}: no se crea la OC** (tiene bloqueos).`);
    else partes.push(`**${caso}: la OC está lista, pero requiere tu confirmación. Todavía NO se ha creado.**`);
    if (orden) partes.push("**OC como quedaría en SAP**\n" + tablaOrden(orden));
    partes.push(validaciones(v));
    if (c.ok) partes.push(textoCreada(caso, c.data!));
    else if (v.apta) partes.push('**¿Confirmas la creación de la OC?** Responde "confirmo" o usa el botón.');
    return decir(partes.join("\n\n"));
  }
}

interface Orden { referencia: { solicitud_id: string; cotizacion_ref: string | null }; proveedor: { codigo_sap: string; nit: string; nombre: string }; moneda: string; condiciones_pago: string; aprobador: { email: string; fecha_aprobacion: string }; posiciones: Array<{ numero: number; descripcion: string; cantidad: number; unidad: string; precio_unitario: number; centro_costo: string; subarea: string; indicador_iva: string }> }
type Validacion = NonNullable<Res["data"]>;
const REGLAS: Record<string, string> = { RC1: "Proveedor existe y activo", RC2: "Aprobación válida de aprobador del centro", RC3: "Valor dentro del tope del aprobador", RC4: "Subárea pertenece al centro", RC5: "Cotización vs solicitud ≤ 2 %", RC6: "Indicador de IVA informado", RC7: "Condiciones de pago informadas", RC8: "No retroactiva (factura no anterior)", RC9: "Aprobación posterior a la solicitud", RC10: "Cantidad × unitario = total" };
const num = (n: number) => n.toLocaleString("es-CO");

function tablaOrden(o: Orden): string {
  const p = o.posiciones[0];
  const filas: Array<[string, string]> = [
    ["Solicitud", o.referencia.solicitud_id], ["Proveedor", `${o.proveedor.nombre} (SAP ${o.proveedor.codigo_sap}, NIT ${o.proveedor.nit})`],
    ["Sociedad / Org. compras", "1000 / 1000"], ["Centro de costo / subárea", `${p.centro_costo} / ${p.subarea}`],
    [`Posición ${p.numero}`, p.descripcion], ["Cantidad × precio", `${num(p.cantidad)} ${p.unidad} × ${o.moneda} ${num(p.precio_unitario)} = ${o.moneda} ${num(p.cantidad * p.precio_unitario)}`],
    ["Indicador IVA", p.indicador_iva], ["Condiciones de pago", o.condiciones_pago], ["Cotización", o.referencia.cotizacion_ref ?? "—"],
    ["Aprobador", `${o.aprobador.email} (${o.aprobador.fecha_aprobacion.slice(0, 10)})`],
  ];
  return "| Campo | Valor |\n|---|---|\n" + filas.map(([k, val]) => `| ${k} | ${val.replace(/\|/g, "/")} |`).join("\n");
}

function validaciones(v: Validacion): string {
  const fallan = new Set([...(v.bloqueos ?? []), ...(v.confirmaciones ?? [])].map((x) => x.regla));
  const pasan = Object.keys(REGLAS).filter((r) => !fallan.has(r));
  const l: string[] = [`**Validaciones que pasaron:** ${pasan.map((r) => `${r} (${REGLAS[r]})`).join(" · ")}`];
  if (v.bloqueos?.length) l.push("**Bloqueos:**\n" + v.bloqueos.map((b) => `✗ ${b.regla}: ${b.detalle}\n   Acción sugerida: ${b.accion}`).join("\n"));
  if (v.confirmaciones?.length) l.push("**Requieren confirmación:**\n" + v.confirmaciones.map((x) => `? ${x.regla}: ${x.detalle}${x.accion ? `\n   ${x.accion}` : ""}`).join("\n"));
  const der = Object.entries((v.derivados ?? {}) as Record<string, { valor?: string; fuente?: string }>).filter(([, d]) => d?.fuente);
  if (der.length) l.push("**Derivados de maestros:** " + der.map(([k, d]) => `${k} = ${d.valor} (${d.fuente})`).join(" · "));
  return l.join("\n\n");
}

function textoCreada(caso: string, d: Record<string, unknown>): string {
  const ev = d.evidencia ? `\nEvidencia de aprobación: ${d.evidencia} · ${d.evidencia_pdf}` : "";
  return `✅ **OC ${d.numero_oc}** ${d.idempotente ? "ya existía para esta solicitud (idempotencia: no se creó otra)" : `creada para ${caso}`}${d.retroactiva ? " · marcada **retroactiva = true** en el log de control" : ""}.${ev}`;
}

function ultimoCaso(mensajes: Mensaje[]): string | null {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i];
    if (m.rol === "assistant") for (const l of [...m.llamadas].reverse()) { const c = (l.args as { caso?: string })?.caso; if (c) return c; }
    if (m.rol === "user") { const c = casoDe(m.texto); if (c) return c; }
  }
  return null;
}
