// Puerto (interfaz) hacia SAP + adaptador simulado.
// En producción se reemplaza SapSimulado por un adaptador real (OData API_PURCHASEORDER_PROCESS_SRV
// o BAPI_PO_CREATE1 vía middleware) sin tocar herramientas ni agente. Ver SOLUCION.md.
import { createHash } from "node:crypto";

export interface PosicionOC { descripcion: string; cantidad: number; valorUnitario: number; indicadorIva: string; centroCosto: string }
export interface SolicitudOC { claveIdempotencia: string; nitProveedor: string; condicionPago: string; moneda: string; posiciones: PosicionOC[]; referencia: string; marcaRetroactiva: boolean; aprobadoPor: string }
export interface OrdenCompra extends SolicitudOC { numero: string; creadaEn: string; total: number; estado: "CREADA" }

export interface SapPort {
  crearOrdenCompra(req: SolicitudOC): Promise<{ oc: OrdenCompra; duplicada: boolean }>;
  consultarOrdenCompra(numeroOReferencia: string): Promise<OrdenCompra | null>;
}

class SapSimulado implements SapPort {
  private ordenes = new Map<string, OrdenCompra>(); // clave idempotencia -> OC

  async crearOrdenCompra(req: SolicitudOC) {
    const previa = this.ordenes.get(req.claveIdempotencia);
    if (previa) return { oc: previa, duplicada: true };
    // Número determinista: misma solicitud => mismo número (útil para demo y pruebas)
    const n = parseInt(createHash("sha256").update(req.claveIdempotencia).digest("hex").slice(0, 8), 16) % 1_000_000;
    const oc: OrdenCompra = {
      ...req,
      numero: "45" + String(n).padStart(8, "0"),
      creadaEn: new Date().toISOString(),
      total: req.posiciones.reduce((a, p) => a + p.cantidad * p.valorUnitario, 0),
      estado: "CREADA",
    };
    this.ordenes.set(req.claveIdempotencia, oc);
    return { oc, duplicada: false };
  }

  async consultarOrdenCompra(q: string) {
    for (const oc of this.ordenes.values()) if (oc.numero === q || oc.referencia === q) return oc;
    return null;
  }
}

export const sap: SapPort = new SapSimulado();
