// Interfaz obligatoria del adaptador SAP (PRD 7.4). El agente y las herramientas solo conocen esta interfaz.
import type { OrdenCompra } from "../domain/tipos.js";

export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>;
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>;
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>;
}
