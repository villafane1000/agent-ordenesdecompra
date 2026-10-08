# Agente de Órdenes de Compra — Periferia IT Group (Reto 3)

Agente conversacional en TypeScript que valida solicitudes de compra y crea órdenes en un SAP simulado, con confirmación humana. Detalle técnico en [SOLUCION.md](SOLUCION.md).

## Requisitos
Node 20+ (o Bun). Opcional: `ANTHROPIC_API_KEY` para el modo con LLM.

## Uso
```bash
npm install
npx tsx demo.ts          # verificación de los 6 casos, sin LLM   (o: bun demo.ts)
npx tsx server.ts        # chat local en http://localhost:3000
```

## Variables de entorno
| Variable | Uso | Defecto |
|---|---|---|
| `ANTHROPIC_API_KEY` | Habilita el modo con LLM | (sin ella, modo reglas) |
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
