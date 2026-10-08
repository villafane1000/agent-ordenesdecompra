// Mismas herramientas que usa la aplicación (re-export, no copia): importables sin el servidor HTTP.
// Cada export se expone como `oc_<export>`; contrato { description, args (zod), execute(args, ctx) → string JSON }.
export * from "../../src/tools/oc.js";
export type { Herramienta, ToolCtx } from "../../src/tools/contrato.js";
