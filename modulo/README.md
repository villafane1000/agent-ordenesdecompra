# Módulo reutilizable — agente de órdenes de compra

Empaquetado para integrarse a otras plataformas de agentes sin depender del servidor de esta aplicación.

| Pieza | Archivo | Es la misma que usa la app |
|---|---|---|
| Agente (frontmatter + system prompt) | `agent.md` | Enlace simbólico a `agent/prompt.md` |
| Herramientas | `tools/oc.ts` | Re-export de `src/tools/oc.ts` |
| Skill (conocimiento del proceso) | `skill/ordenes-compra/SKILL.md` | Enlace simbólico a `src/knowledge/ordenes-compra.md` |

Al no haber copias, no pueden divergir: el runtime de la app lee exactamente estos archivos (quitando el frontmatter).

Uso de las herramientas desde otra plataforma:

```ts
import { leer_paquete, validar, crear } from "./modulo/tools/oc.js";
const ctx = { directory: "/ruta/al/proyecto", sessionId: "s1" };
console.log(await validar.execute({ caso: "sol-004" }, ctx));
```
