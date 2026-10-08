# Módulo reutilizable — agente de órdenes de compra

Empaquetado para integrarse a otras plataformas de agentes sin depender del servidor de esta aplicación.

| Pieza | Archivo | Es la misma que usa la app |
|---|---|---|
| Agente (frontmatter + system prompt) | `agent.md` | Idéntico byte a byte a `agent/prompt.md`, que es el que lee el runtime |
| Herramientas | `tools/oc.ts` | Re-export de `src/tools/oc.ts`: son los mismos objetos, no una copia |
| Skill (conocimiento del proceso) | `skill/ordenes-compra/SKILL.md` | Idéntico byte a byte a `src/knowledge/ordenes-compra.md`, que es el que lee el runtime |

**Garantía de no divergencia:** `npm run modulo` (y el final de `demo.ts`) verifica que los dos Markdown sean idénticos a los de la app y que cada herramienta del módulo sea el mismo objeto que usa la app; si algo difiere, termina con error. `npm run modulo -- --sync` los vuelve a copiar. Se usan archivos reales (no enlaces simbólicos) para que se lean bien en GitHub y en un ZIP.

Uso de las herramientas desde otra plataforma:

```ts
import { leer_paquete, validar, crear } from "./modulo/tools/oc.js";
const ctx = { directory: "/ruta/al/proyecto", sessionId: "s1" };
console.log(await validar.execute({ caso: "sol-004" }, ctx));
```
