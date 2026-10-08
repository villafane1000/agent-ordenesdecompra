// Registro: cada export de src/tools/<archivo>.ts se expone al modelo como `<archivo>_<export>`.
import { z } from "zod";
import type { Herramienta } from "./contrato.js";
import * as oc from "./oc.js";

const modulos: Record<string, Record<string, unknown>> = { oc };

export const herramientas: Record<string, Herramienta> = {};
for (const [archivo, mod] of Object.entries(modulos))
  for (const [exp, h] of Object.entries(mod))
    if (h && typeof h === "object" && "execute" in h && "args" in h) herramientas[`${archivo}_${exp}`] = h as Herramienta;

/** Definiciones neutrales (nombre, descripción, JSON Schema) para cualquier proveedor de LLM. */
export const definiciones = Object.entries(herramientas).map(([nombre, h]) => {
  const { $schema, ...schema } = z.toJSONSchema(z.object(h.args), { unrepresentable: "any" }) as Record<string, unknown>;
  void $schema;
  return { nombre, descripcion: h.description, schema };
});
