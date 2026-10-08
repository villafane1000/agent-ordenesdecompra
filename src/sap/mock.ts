// SAP simulado sobre archivos: out/sap/ordenes.jsonl. Números secuenciales desde 4500000001.
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { leerMaestros } from "../data/fixtures.js";
import { normNit } from "../domain/extraccion.js";
import type { OrdenCompra } from "../domain/tipos.js";
import { dirOut, escribir } from "../out.js";
import type { SapAdapter } from "./adapter.js";

interface Registro { numero_oc: string; fecha: string; orden: OrdenCompra }

export class SapMock implements SapAdapter {
  constructor(private root: string, private scope?: string) {}
  private get ruta() { return this.scope ? join(dirOut(this.root), "sessions", this.scope, "sap", "ordenes.jsonl") : join(dirOut(this.root), "sap", "ordenes.jsonl"); }

  private leer(): Registro[] {
    if (!existsSync(this.ruta)) return [];
    return readFileSync(this.ruta, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Registro);
  }

  async consultarProveedor(nit: string) {
    const p = leerMaestros(this.root).proveedores.find((x) => normNit(x.nit) === normNit(nit));
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null;
  }

  async buscarOrdenPorReferencia(solicitud_id: string) {
    const r = this.leer().find((x) => x.orden.referencia.solicitud_id === solicitud_id);
    return r ? { numero_oc: r.numero_oc } : null;
  }

  async crearOrden(orden: OrdenCompra) {
    const previas = this.leer();
    const numero_oc = String(4500000001 + previas.length);
    const fecha = new Date().toISOString();
    if (!existsSync(this.ruta)) escribir(this.ruta, "");
    appendFileSync(this.ruta, JSON.stringify({ numero_oc, fecha, orden } satisfies Registro) + "\n");
    return { numero_oc, fecha };
  }
}
