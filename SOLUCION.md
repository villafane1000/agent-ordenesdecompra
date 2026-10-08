# SOLUCIÓN — Reto 03 · Agente conversacional "Órdenes de Compra SAP"

**Candidato:** Victor Hugo Villafañe Aguilar · **Demo:** https://agent-ordenesdecompra.vercel.app · **Repo:** https://github.com/villafane1000/agent-ordenesdecompra

---

## 1. Problema en una frase

La analista administrativa digita a mano cada orden de compra en SAP a partir de un correo con tres adjuntos, valida de memoria si quien aprueba puede aprobar ese monto en ese centro, y nadie mide cuántas OC se crean después de la factura. Les duele a **administración** (tiempo y errores), a **contabilidad/auditoría** (control y evidencia) y a la **dirección** (no sabe cuánto se salta el proceso de cotización).

## 2. Arquitectura

```
┌─────────────────────┐  POST /api/chat   ┌──────────────────────────────────────────────┐
│ Front (public/)     │ ────────────────▶ │ Backend (api/* · src/http.ts)                 │
│ · historial          │ ◀──────────────── │ · src/agent/runtime.ts  ciclo del agente      │
│ · tarjetas de tools  │  reply, toolCalls,│   (tope 25 iteraciones, sesiones, CA3, log)   │
│ · banner confirmar   │  needsConfirmation│ · src/llm/adapter.ts    interfaz enviar()     │
└─────────────────────┘                   │     ├ anthropic.ts  Claude                    │
                                           │     └ reglas.ts     sin modelo (respaldo)     │
                                           │ · src/tools/oc.ts       herramientas zod      │
                                           │ · src/domain/           reglas RC1–RC10,      │
                                           │                         payload, extracción   │
                                           │ · src/sap/adapter.ts    SapAdapter ─ mock.ts  │
                                           └───────────┬───────────────────┬──────────────┘
                                                       │                   │
                                     fixtures/ (solo lectura)      out/ (escritura)
                                     maestros · solicitudes        sap/ordenes.jsonl · control.csv
                                                                   log.jsonl · <caso>/trazabilidad.json
                                                                   <caso>/aprobacion.txt|.pdf · sessions/
```

| Capa | Dónde vive | Qué contiene |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Rol, reglas no negociables (no afirmar valores sin herramienta, confirmación explícita), formato |
| **Conocimiento** | `src/knowledge/ordenes-compra.md` | Proceso, reglas RC1–RC10 en lenguaje de negocio, acciones sugeridas, glosario |
| **Ejecución** | `src/tools/oc.ts` + `src/domain/` | Herramientas `oc_*` y reglas puras; únicas fuentes de valores |

Un cambio de reglas de negocio toca `src/domain/reglas.ts` (y su descripción en `src/knowledge/`), nunca el servidor.

**API** (documentada en el README): `POST /api/chat {sessionId, message}` → `{reply, toolCalls[], needsConfirmation, sessionId, uso}` · `GET /api/sessions/:id` · `GET /api/health` → `{ok, provider, model}` sin claves.

## 3. Ciclo del agente

1. El front envía `{sessionId, message}`. El runtime agrega el mensaje a la sesión (memoria + `out/sessions/<id>.json`; el navegador guarda una copia por si la petición cae en otra instancia serverless).
2. Bucle (máximo `MAX_ITERACIONES` = 25, **CA1**): `adaptador.enviar(mensajes, herramientas, prompt)` → si el modelo pide herramientas, el backend valida los argumentos con zod, ejecuta, registra cada llamada en `out/log.jsonl` (**CA4**) y devuelve el resultado al modelo; si no pide herramientas, esa es la respuesta del turno. Al llegar al tope, responde con lo hecho y lo pendiente.
3. **Confirmación humana (CA3), aplicada en dos capas:**
   - **Prompt:** con confirmaciones pendientes, el agente termina el turno con una pregunta explícita y no envía `confirmado: true`.
   - **Código (no negociable):** `oc_crear` solo crea con confirmaciones si `confirmado = true` **y** el runtime marcó que el **mensaje actual del usuario** es una confirmación (`ctx.confirmacionUsuario`). El modelo no puede fabricar esa señal: aunque enviara `confirmado: true` por su cuenta, la herramienta lo rechaza.
   - El front recibe `needsConfirmation = true`, resalta la respuesta en naranja y muestra los botones *Confirmo / No confirmo*.
4. **Errores (CA5):** las herramientas nunca lanzan (`{ok:false, error}`); si el proveedor LLM falla o vence el timeout (`LLM_TIMEOUT_MS`), el chat lo dice en lenguaje claro y **continúa el mismo turno con el adaptador sin modelo**. La sesión no muere.
5. **Costo:** tope de tokens por sesión (`MAX_TOKENS_SESION`), tope de iteraciones, prompt cacheado, y el texto completo de cotización/aprobación no se envía al modelo (ya viene extraído).

**Defensa contra valores alterados:** `oc_validar`, `oc_construir_payload` y `oc_crear` reciben el `paquete`/`payload` que exige el contrato, pero **lo releen y recalculan desde los fixtures**. Si el payload que manda el modelo difiere del validado, `oc_crear` lo rechaza. Así se mitiga el riesgo del PRD "el modelo arregla un monto para que cuadre con la cotización".

## 4. Elección del modelo

| | |
|---|---|
| Proveedor / modelo | Anthropic · `claude-sonnet-5-5` (configurable con `MODEL`) |
| Por qué | Uso de herramientas confiable en flujos de varios pasos, buen seguimiento de instrucciones en español (no afirmar valores, terminar con pregunta), y prompt caching para el system prompt. |
| Alternativa | `claude-haiku-5-5` para bajar costo; el diseño lo permite porque las reglas no dependen del modelo. |
| Independencia | Cambiar de proveedor = nueva clase que implemente `AdaptadorLLM.enviar()`; el ciclo no cambia. `ReglasAdapter` es la prueba: misma interfaz, sin modelo. |

**Costo medido en producción** (tarifa configurada US$3 / US$15 por millón de tokens de entrada / salida; verificar la tarifa vigente del modelo):

| Caso | Turnos | Tokens (in / out) | Costo aprox. |
|---|---|---|---|
| sol-004 (prompt de demo del PRD, con confirmación) | 2 | 37.6 k / 1.6 k | **US$ 0,14** |
| sol-001 (sin excepciones, OC directa) | 1 | 23.6 k / 0.8 k | US$ 0,08 |
| sol-003 (bloqueo RC2) | 1 | 18.1 k / 0.6 k | US$ 0,06 |

A 300 OC/mes ≈ US$ 25–40/mes con Sonnet. El grueso es entrada repetida (prompt + definiciones de herramientas en cada iteración); con caching de prompt y Haiku baja de forma importante. El modo sin LLM cuesta cero y procesa el flujo normal.

## 5. Matriz de controles

Implementada en `src/domain/reglas.ts` como función pura `validar(paquete, maestros) → { apta, bloqueos[], confirmaciones[], derivados, retroactiva }`.

| Regla | Implementación | Tipo |
|---|---|---|
| RC1 | Búsqueda por NIT normalizado (sin puntos ni dígito de verificación); sin NIT, por nombre normalizado (sin tildes, sin S.A.S./Ltda.). Verifica `activo`. | Bloqueo |
| RC2 | Aprobación presente, contiene "Aprobado" y **no negado** ("no aprobado"), y el remitente está en `aprobadores` del centro. | Bloqueo |
| RC3 | `valor_total ≤ tope` del aprobador que respondió, en ese centro. | Bloqueo |
| RC4 | Centro existe y la subárea está en sus `subareas`. | Bloqueo |
| RC5 | `|total cotización − valor_total| / valor_total ≤ 2 %`; muestra ambos valores. Sin cotización → confirmación. | Confirmación |
| RC6 | IVA ausente → `indicador_iva_default` del proveedor como **derivado** + confirmación. | Confirmación + derivado |
| RC7 | Condiciones de pago ausentes → default del proveedor, solo se informa. | Derivado |
| RC8 | `factura.fecha < fecha_solicitud` → `retroactiva = true`, confirmación y marca en `control.csv`. | Confirmación |
| RC9 | Fecha de aprobación < fecha de solicitud → confirmación. | Confirmación |
| RC10 | `|cantidad × valor_unitario − valor_total| ≤ 1`. | Bloqueo |

**Resultado sobre los fixtures oficiales (`demo.ts`):**

| Caso | apta | Hallazgos | Resultado |
|---|---|---|---|
| sol-001 | sí | — | OC 4500000001 sin intervención; segunda ejecución → misma OC (`idempotente: true`) |
| sol-002 | no | RC1 proveedor NIT 901999000 inexistente | Sin OC + acción sugerida |
| sol-003 | no | RC2 fvargas no es aprobador de CC-2020 | Sin OC + acción sugerida |
| sol-004 | sí | RC5 cotización 26,5 M vs solicitud 25 M (6 %) | Pide confirmación → OC tras "confirmo" |
| sol-005 | sí | RC8 factura 2026-08-10 < solicitud 2026-08-27 | Pide confirmación → OC con `retroactiva = true` |
| sol-006 | sí | RC6 IVA derivado C1; RC7 pago derivado Z030 (sin NIT: proveedor encontrado por nombre) | Pide confirmación → OC |

**La más difícil: RC2.** No basta con buscar "Aprobado": hay que (a) extraer el email de un remitente que puede venir como `Nombre <correo>`, (b) evitar falsos positivos como "no queda aprobado", y (c) separar dos fallas distintas que el negocio trata diferente: aprobador sin autoridad en ese centro (sol-003, el remitente aprueba en otro centro) vs. aprobador con autoridad pero tope insuficiente (RC3). Se resolvió evaluando RC2 antes que RC3 y dando una acción sugerida distinta para cada una.

## 6. Diseño del adaptador SAP real

**Opción elegida: OData `API_PURCHASEORDER_PROCESS_SRV` (S/4HANA) expuesta a través de SAP Integration Suite / API Management**, con plan B por archivo.

- **Por qué:** es la API estándar y soportada para crear OC, valida con la misma lógica de SAP (no salta controles como una carga directa), devuelve mensajes estructurados y no requiere desarrollo ABAP. Integration Suite agrega lo que la viabilidad incierta pide: un punto único para autenticación, cuotas, monitoreo y para cambiar de canal sin tocar el agente. Si el sistema es ECC sin OData, la misma interfaz `SapAdapter` se implementa sobre `BAPI_PO_CREATE1` vía RFC detrás del middleware.
- **Mapeo del payload (7.4 → OData):**

| Payload | OData A_PurchaseOrder / A_PurchaseOrderItem |
|---|---|
| sociedad / organizacion_compras | CompanyCode / PurchasingOrganization (+ PurchasingGroup por configuración) |
| proveedor.codigo_sap | Supplier |
| moneda / condiciones_pago | DocumentCurrency / PaymentTerms |
| referencia.solicitud_id | Campo de referencia de cabecera (p. ej. YourReference) + texto de cabecera |
| posiciones[].numero / descripcion / cantidad / unidad / precio_unitario | PurchaseOrderItem / PurchaseOrderItemText (40) / OrderQuantity / PurchaseOrderQuantityUnit / NetPriceAmount |
| centro_costo | AccountAssignmentCategory = K + to_AccountAssignment.CostCenter |
| subarea | Centro de beneficio, orden interna o campo de usuario según el modelo de imputación del cliente (supuesto a validar con FI/CO) |
| indicador_iva | TaxCode |
| aprobador + evidencia_sha256 | Texto de cabecera; el PDF se adjunta vía API de Attachment Service (GOS) |
| excepciones | Texto de cabecera + log de control propio |

- **Autenticación y credenciales:** OAuth 2.0 client credentials con un usuario técnico de mínimo privilegio (crear/leer OC y consultar proveedores). Las credenciales viven en el gestor de secretos del backend (Key Vault / Secrets Manager) y las usa solo el adaptador; nunca el agente, el prompt, el front ni los logs.
- **Idempotencia y errores parciales:** antes de crear, `buscarOrdenPorReferencia(solicitud_id)` (filtro por la referencia de cabecera); además, una tabla propia `solicitud_id → numero_oc` con restricción única y estado (`en_curso`, `creada`, `fallida`). Si SAP responde con timeout o error 5xx, **no se reintenta a ciegas**: primero se consulta por referencia; si la OC existe, se registra; si no, se reintenta con backoff. Error 4xx (dato inválido) no se reintenta: se traduce el mensaje de SAP a lenguaje de negocio y vuelve al humano. Si la OC se creó pero falló el adjunto, la OC queda registrada y el adjunto se reintenta de forma independiente (error parcial).
- **Plan B (conexión no viable):** el agente igual elimina la digitación: genera la OC validada (a) como **archivo de carga masiva** (CSV/LSMW o plantilla de Migration Cockpit) que la analista sube una vez al día, o (b) como **hoja "lista para pegar"** campo por campo con el PDF de evidencia. Los controles, la trazabilidad y la medición de retroactivas funcionan igual: solo cambia la implementación de `crearOrden()`.

## 7. Lectura del proceso: OC retroactivas

> **Para la dirección.** Una OC retroactiva significa que la compra ya ocurrió y la OC solo la regulariza. El control preventivo (cotizar, aprobar antes, comprometer presupuesto) se convierte en un trámite. En los fixtures, sol-005 lo muestra con claridad: la cotización es del 5/08, la factura del 10/08, la solicitud del 27/08 y la aprobación del 28/08 dice "ya llegó la factura, por favor crear la OC". El líder aprueba algo que ya no puede rechazar.
>
> **Riesgos:** gasto sin presupuesto comprometido; precio y proveedor no comparados; segregación de funciones debilitada; señal clásica de auditoría y de riesgo de fraude; cierre contable con compromisos que aparecen tarde.
>
> **Lo que el agente ya hace:** no bloquea (el gasto existe y hay que pagarlo), pero exige confirmación explícita y **marca cada caso `retroactiva = true` en `control.csv`**. Desde el primer mes, la dirección tendrá el porcentaje real por área, aprobador y proveedor.
>
> **Cambio de proceso propuesto:**
> 1. Medir primero (4–6 semanas) con el log de control y publicar el indicador mensual por área.
> 2. Abrir una **vía rápida legítima** para urgencias (compra de emergencia con tope y aprobación en 24–48 h): la mayoría de las retroactivas son urgencia, no mala fe.
> 3. **Contratos marco / OC abiertas** para proveedores recurrentes (papelería, licencias, nube), que concentran este patrón.
> 4. Regla "**sin OC no hay pago**" con excepción documentada; por encima de un monto o con reincidencia, escalar a un segundo aprobador y notificar a control interno.
> 5. Decisión de política pendiente (pregunta abierta del PRD): tolerar con marca o rechazar. Recomiendo **tolerar con marca y meta de reducción** durante un trimestre, y endurecer con datos.

## 8. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | Reglas en código puro (`src/domain`); el modelo solo orquesta y explica | Dejar que el LLM evalúe las reglas desde el prompt | Un control financiero debe ser determinista, auditable y testeable; además permite `demo.ts` sin modelo |
| 2 | Las herramientas recalculan desde la fuente e ignoran los valores que manda el modelo | Confiar en el `paquete`/`payload` recibido | Elimina la clase de error "el modelo ajustó el monto"; el costo es releer archivos pequeños |
| 3 | Confirmación verificada en el runtime (`ctx.confirmacionUsuario`) además del prompt | Solo instrucción en el prompt | Un prompt se puede saltar; el código no. El modelo no puede aprobar por el usuario |
| 4 | Extracción de cotización/factura con parser determinista | Extraer con el LLM | Los formatos del reto son estables; el parser es gratis, reproducible y no alucina. Con PDFs libres usaría el LLM con salida zod y confianza por campo |
| 5 | Front en HTML plano | React/Next | Cero build, despliegue trivial en Vercel, menos superficie de fallos en 2 horas |
| 6 | Adaptador "reglas" con la misma interfaz que el LLM | Desactivar el chat sin clave | Degradación controlada: si el proveedor cae en la defensa, el agente sigue operando |
| 7 | Vercel serverless con `out/` en `/tmp` | Servidor persistente (Render/Fly) | Despliegue ya probado; el costo es que `out/` es efímero por instancia (ver riesgos) |
| 8 | En el chat, **cada sesión tiene su propio SAP simulado** (`out/sessions/<id>/sap`); `demo.ts` usa uno global | Un único SAP simulado compartido por todos los usuarios del link | Con un SAP compartido, quien pruebe después ve "la OC ya existía" en lugar del flujo completo. El sandbox por sesión hace reproducible la demo del PRD; la idempotencia se demuestra repitiendo el caso en la misma sesión y en `demo.ts`. En producción hay un solo SAP y la idempotencia es global por `solicitud_id` |

## 9. Supuestos

1. `valor_total` de la solicitud y `TOTAL` de la cotización incluyen IVA (así vienen en los fixtures); RC5 compara totales.
2. La fecha relevante de la factura es la de emisión; la comparación de fechas es por día (se ignora la hora y la zona).
3. "Contener 'Aprobado'" excluye frases negadas ("no aprobado").
4. RC3 usa el tope del aprobador que **respondió**, no el máximo del centro.
5. Con NIT en la solicitud se busca solo por NIT (es identificador fiscal); por nombre únicamente si falta el NIT.
6. La descripción se trunca a 40 caracteres (límite SAP de texto breve); la completa queda en la solicitud y la trazabilidad.
7. La unidad se toma de la solicitud si existe; si no, se infiere de la descripción (horas → H, mensual → MES, resto UN) y queda como derivado en la trazabilidad.
8. Las condiciones de pago de la cotización ("según acuerdo comercial") no sobrescriben las de la solicitud o el proveedor.
9. El SAP simulado reinicia su numeración cuando se limpia `out/` (determinismo de `demo.ts`); en el chat, cada sesión es un sandbox con su propia numeración desde 4500000001.
10. `oc_validar` informa `oc_existente` si la solicitud ya tiene OC, para que el agente lo diga antes de pedir confirmación.

## 10. Cobertura

| Historia | Estado | Notas / qué falta para producción |
|---|---|---|
| HU-1 Leer el paquete | **Hecho** | Adjuntos ausentes → `null` + `faltantes`. Falta: lectura de `.xlsx`/`.pdf` reales (P1 opcional, no hecho) |
| HU-2 Validar | **Hecho** | RC1–RC10, bloqueos/confirmaciones/derivados |
| HU-3 Payload | **Hecho** | Validado con zod; `out/<caso>/trazabilidad.json` con la fuente de cada valor |
| HU-4 Evidencia | **Hecho (P0 + P1)** | `aprobacion.txt` con sha256 y `aprobacion.pdf` (pdf-lib) |
| HU-5 Crear OC | **Hecho** | Secuencial desde 4500000001, `out/sap/ordenes.jsonl`, idempotencia, fila en `control.csv` por intento (creada, idempotente, bloqueada, pendiente) |
| HU-6 Errores | **Hecho** | `{ok:false, error}` legible; JSON malformado, monto no numérico y paquete incompleto se reportan con qué pedir |
| CA1–CA5 | **Hecho** | Tope 25, valores solo de herramientas, confirmación verificada en código, `log.jsonl`, errores sin matar la sesión |
| Bonus módulo (9.4) | **Hecho** | `modulo/agent.md` (frontmatter `description`, `mode: primary`, `permission {edit: deny, bash: deny}` + system prompt), `modulo/tools/oc.ts` (re-export: mismas herramientas, importables sin el servidor) y `modulo/skill/ordenes-compra/SKILL.md` (frontmatter `name`, `description` + conocimiento). Los Markdown son idénticos byte a byte a los que lee el runtime; `npm run modulo` y `demo.ts` fallan si divergen |
| `oc_leer_excel` | No hecho | P1 opcional |

Para producción falta: persistencia real (base de datos para sesiones, log y control), autenticación y roles, el adaptador SAP real, lectura de adjuntos binarios desde el buzón y monitoreo.

## 11. Uso de IA

| Asistente | Para qué |
|---|---|
| **Claude (Anthropic), en Claude Code / app de Claude** | Lectura y análisis del PRD; borrador del esqueleto (ciclo del agente, front de chat, despliegue en Vercel); implementación de reglas, herramientas y `demo.ts` a partir de mis decisiones; redacción inicial de esta documentación |
| **Claude Sonnet 5.5 vía API** | Es el modelo del agente en producción (no un asistente de desarrollo) |

**Qué descarté de lo propuesto y por qué:**
- Un primer diseño que pedía confirmación humana **siempre** antes de crear la OC: lo descarté porque el PRD exige que `sol-001` se cree sin intervención (O1). La confirmación queda solo para excepciones.
- Comparar RC5 contra el subtotal de la cotización: descartado al ver que los fixtures traen totales con IVA en ambos lados.
- Extraer datos de la cotización con el LLM: descartado por determinismo y costo (decisión 4).
- Confiar en el `payload` enviado por el modelo a `oc_crear`: descartado (decisión 2).
- Usar TypeScript 7 en el build: rompía el builder de Vercel; se fijó TypeScript 5.

Revisé y probé cada componente (demo con los 6 casos, pruebas en la URL pública en ambos modos) y puedo explicar cada línea.

## 12. Riesgos para producción

| Riesgo | Mitigación |
|---|---|
| La conexión a SAP no es viable a corto plazo | Plan B por archivo de carga (sección 6); el valor de control y medición no depende de SAP |
| El modelo inventa o ajusta valores | Herramientas como única fuente; recálculo desde la fuente y rechazo de payload alterado |
| El modelo "confirma" por el usuario | `oc_crear` exige la señal de confirmación del runtime, ligada al mensaje real del usuario |
| Prompt injection en correos/cotizaciones | El prompt los trata como datos; ninguna herramienta ejecuta instrucciones ni comandos de shell; el texto completo no se envía al modelo |
| Estado efímero en serverless (`/tmp`) | En producción: base de datos para sesiones, idempotencia y `control.csv`; la idempotencia real vive en SAP por referencia |
| Costo descontrolado | Tope de iteraciones, tope de tokens por sesión, timeout, caching; modo sin LLM |
| Datos personales (Ley 1581 de 2012, Colombia) | Minimizar lo que va al modelo, acuerdos de tratamiento con el proveedor, retención definida de logs |
| Maestros desactualizados | En producción se consultan en SAP en tiempo real (`consultarProveedor`) |
| Evidencia insuficiente para auditoría | El sha256 garantiza integridad; si auditoría lo exige, firma digital del PDF |
