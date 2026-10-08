# Agente conversacional "Órdenes de Compra SAP" — Reto 03 · Periferia IT Group

**Link de prueba (público, sin clave de acceso):** https://agent-ordenesdecompra.vercel.app
**Planteamiento de la solución:** [SOLUCION.md](SOLUCION.md)

El agente lee el paquete de compra (correo, solicitud, cotización, aprobación y factura), lo valida contra los maestros con las reglas RC1–RC10, construye el payload de la OC con trazabilidad, genera la evidencia de aprobación (TXT y PDF con sha256) y crea la OC en un SAP simulado. Las excepciones se devuelven al humano: los bloqueos con una acción sugerida y las dudas con una confirmación explícita.

## Levantar en local (un comando)

```bash
npm install && npm run dev        # o: bun install && bun run dev   →  http://localhost:3000
```

Sin `ANTHROPIC_API_KEY`, el chat arranca en **modo sin LLM** (adaptador determinista con la misma interfaz). Copia `.env.example` a `.env` y define la clave para usar el modelo.

## Verificación sin modelo

```bash
bun run demo.ts                   # o: npx tsx demo.ts   ·   npm run demo
```

Limpia `out/`, procesa los 6 casos llamando directamente a las herramientas, ejecuta `sol-001` dos veces (idempotencia) y muestra la confirmación explícita de `sol-004` (también de `sol-005` y `sol-006`). Imprime por caso `apta`, bloqueos, confirmaciones, derivados, `retroactiva` y el número de OC o el motivo.

## Variables de entorno (`.env.example`)

| Variable | Uso | Defecto |
|---|---|---|
| `ANTHROPIC_API_KEY` | Clave del proveedor LLM (solo backend; nunca en el front, el repo ni los logs) | vacía → modo sin LLM |
| `MODEL` | Modelo | `claude-sonnet-5-5` |
| `MAX_ITERACIONES` | Tope de iteraciones herramienta → modelo por turno | 25 |
| `MAX_TOKENS_SESION` | Tope de tokens por sesión | 300000 |
| `LLM_TIMEOUT_MS` | Timeout al proveedor | 45000 |
| `PRECIO_INPUT_MTOK` / `PRECIO_OUTPUT_MTOK` | Tarifa USD por millón de tokens para el costo mostrado | 3 / 15 |
| `OUT_DIR` | Carpeta de salida | `./out` (en Vercel `/tmp/out`) |
| `ANTHROPIC_WORKSPACE_ID` | Solo si la clave no está asociada a un workspace | — |

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message, modo?: "llm" \| "reglas" }` → `{ sessionId, reply, toolCalls[], needsConfirmation, modo, uso }` |
| `GET` | `/api/sessions/:id` | Historial visible de la sesión |
| `GET` | `/api/health` | `{ ok: true, provider, model }` sin exponer claves |

## Prueba sugerida en el link

1. `Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.` → tabla del payload, RC5 con ambos valores, llamadas a herramientas visibles y pregunta en naranja.
2. Botón **Confirmo** (o escribir "confirmo") → número de OC y ruta de la evidencia.
3. `procesa sol-001` → OC creada sin intervención · `procesa sol-002` / `sol-003` → bloqueo y acción sugerida · `procesa sol-005` → retroactiva.
4. Botón **Sin LLM** → el mismo flujo sin modelo.

## Estructura

```
agent/prompt.md               comportamiento (system prompt)
src/knowledge/ordenes-compra.md conocimiento del proceso
src/tools/oc.ts               herramientas oc_* (zod) · contrato.ts · index.ts (registro oc_<export>)
src/domain/                   reglas RC1–RC10, payload + trazabilidad, extracción, tipos zod
src/sap/adapter.ts · mock.ts  interfaz SapAdapter y SAP simulado (out/sap/ordenes.jsonl)
src/llm/adapter.ts            interfaz del proveedor · anthropic.ts · reglas.ts (sin modelo)
src/agent/runtime.ts          ciclo del agente, sesiones, confirmación, log, topes
src/http.ts · api/            API (Vercel) · scripts/dev-server.ts (local)
public/index.html             front de chat
fixtures/reto-03/             entregados por Periferia (sin modificar)
modulo/                       bonus: agente empaquetado (mismos archivos, no copias)
demo.ts                       verificación sin modelo
```

Salidas en `out/`: `sap/ordenes.jsonl`, `control.csv`, `log.jsonl`, `<caso>/trazabilidad.json`, `<caso>/aprobacion.txt|.pdf`, `sessions/`.
