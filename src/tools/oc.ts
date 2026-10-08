// Herramientas del agente, tipadas con zod. Son la única forma en que el agente toca datos o SAP.
// Las reglas viven en src/domain; aquí solo se exponen. demo.ts las llama directo, sin LLM.
import { z } from "zod";
import { leerCaso, listarCasos } from "../data/repo.js";
import { evaluarSolicitud } from "../domain/controles.js";
import { extraerCotizacion, extraerFactura } from "../domain/extraccion.js";
import { sap } from "../sap/sap.js";

export interface Herramienta<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  /** Si es true, el runtime NUNCA la ejecuta sin aprobación humana explícita. */
  requiereConfirmacion?: boolean;
  run: (args: z.infer<S>) => Promise<unknown>;
}
const def = <S extends z.ZodType>(h: Herramienta<S>) => h;
const solId = z.string().regex(/^[\w-]+$/).describe("Identificador de la solicitud, p. ej. sol-001");

export const listarSolicitudes = def({
  name: "listar_solicitudes",
  description: "Lista las solicitudes de compra pendientes en la bandeja.",
  input: z.object({}),
  run: async () => listarCasos().map((id) => {
    const c = leerCaso(id);
    return { id, asunto: c.correo.asunto, solicitante: c.solicitud.solicitante, monto: c.solicitud.monto, tieneFactura: !!c.facturaTxt };
  }),
});

export const leerSolicitud = def({
  name: "leer_solicitud",
  description: "Lee el correo, la solicitud, la aprobación y extrae de forma determinista los datos de la cotización y, si existe, de la factura.",
  input: z.object({ solicitudId: solId }),
  run: async ({ solicitudId }) => {
    const c = leerCaso(solicitudId);
    return { correo: c.correo, solicitud: c.solicitud, aprobacion: c.aprobacion, cotizacion: extraerCotizacion(c.cotizacionTxt), factura: c.facturaTxt ? extraerFactura(c.facturaTxt) : null };
  },
});

export const validarSolicitud = def({
  name: "validar_solicitud",
  description: "Ejecuta la matriz completa de controles (proveedor, centro de costo, aprobación, tope, montos, IVA, condición de pago, retroactividad) y devuelve la decisión: LISTA_PARA_OC, REQUIERE_REVISION o RECHAZADA.",
  input: z.object({ solicitudId: solId }),
  run: async ({ solicitudId }) => evaluarSolicitud(leerCaso(solicitudId)),
});

export const crearOcSap = def({
  name: "crear_oc_sap",
  description: "Crea la orden de compra en SAP. REQUIERE confirmación humana: el sistema pausará y pedirá aprobación al usuario. Solo llámala si validar_solicitud no dio RECHAZADA. Para compras retroactivas es obligatorio enviar justificacionRetroactiva.",
  input: z.object({ solicitudId: solId, justificacionRetroactiva: z.string().min(10).optional().describe("Obligatoria si la compra es retroactiva") }),
  requiereConfirmacion: true,
  run: async ({ solicitudId, justificacionRetroactiva }) => {
    // Defensa en profundidad: se re-evalúa aquí; nunca se confía en lo que diga el modelo.
    const caso = leerCaso(solicitudId);
    const ev = evaluarSolicitud(caso);
    if (ev.decision === "RECHAZADA") return { creada: false, motivo: "La solicitud tiene controles en BLOQUEO", controles: ev.controles.filter((c) => c.resultado === "BLOQUEO") };
    if (ev.retroactiva && !justificacionRetroactiva) return { creada: false, motivo: "Compra retroactiva: falta justificación" };
    const s = caso.solicitud;
    const { oc, duplicada } = await sap.crearOrdenCompra({
      claveIdempotencia: `OC:${solicitudId}`,
      nitProveedor: s.nitProveedor,
      condicionPago: ev.valores.condicionPago,
      moneda: "COP",
      referencia: solicitudId,
      marcaRetroactiva: ev.retroactiva,
      aprobadoPor: caso.aprobacion?.aprobador ?? "",
      posiciones: [{ descripcion: s.descripcion, cantidad: 1, valorUnitario: ev.valores.subtotal, indicadorIva: ev.valores.indicadorIva, centroCosto: s.centroCosto }],
    });
    return { creada: !duplicada, duplicada, numeroOC: oc.numero, totalAntesIva: oc.total, totalConIva: ev.valores.total, retroactiva: ev.retroactiva, justificacionRetroactiva: justificacionRetroactiva ?? null };
  },
});

export const consultarOc = def({
  name: "consultar_oc",
  description: "Consulta una orden de compra en SAP por número o por id de solicitud.",
  input: z.object({ consulta: z.string() }),
  run: async ({ consulta }) => (await sap.consultarOrdenCompra(consulta)) ?? { encontrada: false },
});

export const herramientas: Herramienta[] = [listarSolicitudes, leerSolicitud, validarSolicitud, crearOcSap, consultarOc] as Herramienta[];
export const porNombre = new Map(herramientas.map((h) => [h.name, h]));

/** Valida la entrada con zod y ejecuta. Lanza si la entrada es inválida. */
export async function ejecutar(nombre: string, args: unknown) {
  const h = porNombre.get(nombre);
  if (!h) throw new Error(`Herramienta desconocida: ${nombre}`);
  return h.run(h.input.parse(args));
}
