# Agente de Órdenes de Compra — Periferia IT Group (Reto 3)

**Demo en vivo:** https://agent-ordenesdecompra.vercel.app

Agente conversacional en TypeScript que valida solicitudes de compra y crea órdenes en un SAP simulado, con confirmación humana. Detalle técnico en [SOLUCION.md](SOLUCION.md).

## Guía para evaluadores

| Entregable solicitado | Dónde está |
|---|---|
| 1. Repositorio con arquitectura limpia | Este repositorio. System prompt en [`agent/prompt.md`](agent/prompt.md), herramientas zod en [`src/tools/oc.ts`](src/tools/oc.ts), backend en [`src/agent/runtime.ts`](src/agent/runtime.ts), chat en [`public/index.html`](public/index.html) |
| 2. Script de verificación sin LLM | [`demo.ts`](demo.ts) → `npm install && npx tsx demo.ts` (o `bun demo.ts`) |
| 3. Enlace público funcional | https://agent-ordenesdecompra.vercel.app |
| 4. Documentación técnica | [`SOLUCION.md`](SOLUCION.md): arquitectura, ciclo del agente, matriz de controles, adaptador SAP real y análisis de órdenes retroactivas |

**Prueba en 2 minutos (URL pública):**
1. Escribe `¿Qué solicitudes hay?` o usa los atajos de la parte inferior.
2. `procesa sol-001` → valida los controles y pide **confirmación humana** (recuadro naranja) antes de crear la OC en SAP.
3. Un caso rechazado → el agente explica qué control bloqueó y no ofrece crear la OC.
4. La compra retroactiva → exige justificación antes de crear la OC.
5. Botón **Sin LLM** → el mismo flujo con reglas deterministas (respaldo si el modelo no está disponible).

Cada llamada a herramienta se muestra como tarjeta desplegable con su entrada y resultado; abajo se ven tokens y costo estimado.

## Requisitos
Node 20+ (o Bun). Opcional: `ANTHROPIC_API_KEY` para el modo con LLM.

## Uso
```bash
npm install
npx tsx demo.ts          # verificación de los 6 casos, sin LLM   (o: bun demo.ts)
npx tsx scripts/dev-server.ts   # chat local en http://localhost:3000
```

## Variables de entorno
| Variable | Uso | Defecto |
|---|---|---|
| `ANTHROPIC_API_KEY` o `ANTHROPIC_API_KEY_GENERAL` | Habilita el modo con LLM | (sin ella, modo reglas) |
| `ANTHROPIC_WORKSPACE_ID` | Solo si la API key no está asociada a un workspace | — |
| `MODEL` | Modelo | `claude-sonnet-5-5` |
| `PRECIO_INPUT_MTOK` / `PRECIO_OUTPUT_MTOK` | Precio USD por millón de tokens para el costo estimado | 3 / 15 |
| `SIGNING_SECRET` | Firma de acciones pendientes | deriva de la API key |
| `TOLERANCIA_MONTO` | Tolerancia solicitud vs cotización | 0.01 |

## Estructura
```
agent/prompt.md        system prompt
src/tools/oc.ts        herramientas tipadas con zod
src/domain/            extracción y matriz de controles (sin LLM)
src/sap/sap.ts         puerto SAP + adaptador simulado
src/agent/runtime.ts   ciclo del agente (LLM y reglas), confirmación humana
api/                   funciones serverless (Vercel)
public/index.html      chat
demo.ts                verificación determinista
```
