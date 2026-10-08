# SOLUCIÓN — Agente de Órdenes de Compra (Reto 3)

> Autor: Victor Hugo Villafañe Aguilar · Prueba IA — Periferia IT Group
> Marcas `[AJUSTAR]`: puntos que se completan con el PRD y los fixtures oficiales.

## 1. Resumen

Agente conversacional en TypeScript (Node 20+ / Bun) que recibe solicitudes de compra, las valida contra los maestros corporativos con una **matriz de controles determinista** y, solo con **aprobación humana explícita**, crea la orden de compra en un **SAP simulado**.

Principio de diseño: **el LLM orquesta y explica; las reglas deciden.** Ninguna cifra, validación o decisión de control depende del modelo. Por eso el `demo.ts` procesa los 6 casos sin consumir un LLM y produce siempre el mismo resultado.

| Entregable | Dónde |
|---|---|
| System prompt | `agent/prompt.md` |
| Herramientas tipadas con zod | `src/tools/oc.ts` |
| Backend (ciclo del agente) | `src/agent/runtime.ts`, `api/chat.ts` |
| Frontend de chat | `public/index.html` |
| Script de verificación sin LLM | `demo.ts` (`npx tsx demo.ts` o `bun demo.ts`) |
| URL pública | https://agent-ordenesdecompra.vercel.app |

## 2. Arquitectura

```text
 Navegador (public/index.html)
   │  historial + acción pendiente firmada
   ▼
 api/chat.ts ──► src/agent/runtime.ts ── ciclo del agente
                    │        │
                    │        ├─ modo "llm": Claude + tool use
                    │        └─ modo "reglas": orquestación determinista (respaldo)
                    ▼
              src/tools/oc.ts  (contratos zod, única puerta a datos y SAP)
                    │
     ┌──────────────┼──────────────────┐
     ▼              ▼                  ▼
 src/domain/     src/domain/        src/sap/sap.ts
 extraccion.ts   controles.ts       SapPort ── SapSimulado (hoy)
 (parser         (matriz de                └─ SapODataAdapter (producción)
  determinista)   controles)
     ▲              ▲
     └──── src/data/repo.ts ◄── fixtures/reto-03 (maestros + solicitudes)
```

Capas y responsabilidades:

- **Datos (`repo.ts`)**: lectura de maestros y de cada solicitud (correo, solicitud, cotización, aprobación, factura). Solo lectura.
- **Dominio (`extraccion.ts`, `controles.ts`)**: funciones puras. Extraen montos y fechas de los textos y evalúan los controles. Sin LLM, sin red.
- **Herramientas (`oc.ts`)**: cada una con esquema zod; la entrada del modelo se valida antes de ejecutarse. Las mismas herramientas usa el agente y el `demo.ts`.
- **Puerto SAP (`sap.ts`)**: interfaz `SapPort`. El simulado y el real son intercambiables sin tocar herramientas ni agente.
- **Runtime**: servidor sin estado. El cliente devuelve el historial en cada turno; escala horizontal en serverless sin sesión.

## 3. Ciclo del agente

1. El usuario escribe (p. ej. "procesa sol-003").
2. El modelo decide la herramienta; el runtime valida la entrada con zod y la ejecuta.
3. Orden obligatorio (prompt + defensa en código): `leer_solicitud` → `validar_solicitud` → `crear_oc_sap`.
4. Si el modelo pide `crear_oc_sap` (marcada `requiereConfirmacion`), **el runtime no la ejecuta**: pausa el ciclo y devuelve una acción pendiente **firmada con HMAC** al navegador, que la muestra resaltada con *Aprobar / Rechazar* y un campo de justificación.
5. Al aprobar, el runtime verifica la firma (no se puede alterar el `solicitudId` en el navegador), ejecuta la herramienta, entrega el resultado al modelo y este informa el número de OC.
6. `crear_oc_sap` **re-evalúa los controles** antes de llamar a SAP: aunque el modelo o el usuario lo intenten, una solicitud `RECHAZADA` nunca genera OC (defensa en profundidad).
7. Límite de 10 iteraciones por turno; los errores de herramientas vuelven al modelo como `is_error` para que se recupere o lo explique.

**Modo sin LLM**: si no hay API key o el modelo falla, el mismo chat funciona con orquestación por reglas ("listar", "procesa sol-001", "procesa todo"). Degradación controlada en lugar de caída.

## 4. Matriz de controles

`[AJUSTAR]` alinear con las reglas obligatorias del PRD.

| ID | Control | Fuente | Falla → | Racional |
|---|---|---|---|---|
| C01 | Proveedor existe y está ACTIVO | proveedores.json | BLOQUEO | No comprar a proveedores bloqueados o no homologados |
| C02 | NIT de la cotización = NIT de la solicitud | cotizacion.txt | BLOQUEO (ilegible: ALERTA) | Evita pagar a un tercero distinto |
| C03 | Centro de costo y subárea válidos | centros-costo.json | BLOQUEO | Imputación contable correcta |
| C04 | Aprobación existe, está APROBADA y la dio el líder del centro | aprobacion.json | BLOQUEO | Segregación de funciones |
| C05 | Monto ≤ tope de aprobación del líder | centros-costo.json | BLOQUEO (escalar) | Matriz de atribuciones |
| C06 | Monto solicitud ≈ cotización (±1 %) y ≤ monto aprobado | cotización + aprobación | BLOQUEO | Lo aprobado es lo que se compra |
| C07 | Indicador de IVA existe y coincide con la cotización | indicadores-iva.json | BLOQUEO / ALERTA | Riesgo fiscal |
| C08 | Condición de pago válida (default del proveedor si falta) | condiciones-pago.json | BLOQUEO | Datos maestros consistentes |
| C09 | Compra retroactiva: factura anterior a la aprobación | factura.txt | ALERTA + justificación obligatoria | Detectar desvío del proceso |
| — | Idempotencia: una OC por solicitud | SAP | Devuelve la OC existente | Evita duplicados por reintentos |

Decisión: cualquier BLOQUEO → `RECHAZADA`; solo alertas → `REQUIERE_REVISION` (crear exige que la persona lo pida y lo apruebe); todo OK → `LISTA_PARA_OC` (igual pasa por confirmación humana).

Resultado del `demo.ts` sobre los casos `[AJUSTAR con los fixtures oficiales]`:

| Caso | Decisión | OC |
|---|---|---|
| sol-001 | | |
| sol-002 | | |
| sol-003 | | |
| sol-004 | | |
| sol-005 | | |
| sol-006 | | |

## 5. Decisiones de diseño

1. **Reglas en código, no en el prompt.** Un control financiero debe ser auditable, testeable y reproducible. El LLM aporta lenguaje natural, orquestación y explicación.
2. **Extracción determinista de cotizaciones y facturas.** Los textos son semiestructurados; un parser con expresiones regulares es suficiente, gratis y reproducible. Si los formatos fueran libres, se usaría el LLM con salida estructurada validada por zod y un umbral de confianza, nunca como fuente única de cifras.
3. **Confirmación humana en el runtime, no solo en el prompt.** La pausa la impone el código según la bandera `requiereConfirmacion`; el modelo no puede saltársela.
4. **Acción pendiente firmada (HMAC).** El servidor no guarda sesión, así que la acción viaja al navegador; la firma impide modificarla antes de aprobar.
5. **Puerto/adaptador para SAP.** Permite probar todo con el simulado y cambiar a producción sin tocar el agente.
6. **Idempotencia por solicitud.** Clave `OC:<solicitudId>`; reintentos de red o doble clic no duplican órdenes.
7. **Contenido de correos y documentos tratado como datos.** El prompt lo declara y, además, ninguna herramienta ejecuta instrucciones leídas de los documentos: mitigación de *prompt injection*.

## 6. Diseño del adaptador SAP real (producción)

**Opción recomendada (S/4HANA):** API OData de órdenes de compra (`API_PURCHASEORDER_PROCESS_SRV`, o su versión OData v4), expuesta a través de SAP BTP / Integration Suite o API Management. **ECC:** `BAPI_PO_CREATE1` vía RFC detrás de un middleware que la exponga como REST.

Implementación: `SapODataAdapter implements SapPort`.

| Aspecto | Diseño |
|---|---|
| Autenticación | OAuth 2.0 *client credentials* con usuario técnico de mínimo privilegio (solo crear y leer OC); secretos en un gestor (Key Vault / Secrets Manager), nunca en código |
| Mapeo | Proveedor → `Supplier`; sociedad, organización y grupo de compras por configuración; posición con imputación a centro de costo (`AccountAssignmentCategory = K`, `CostCenter`); `TaxCode` ← indicador de IVA; `PaymentTerms` ← condición de pago; referencia a la solicitud en un campo de texto o cabecera |
| CSRF | `GET` con `x-csrf-token: fetch` antes del `POST` (requisito de OData en SAP) |
| Idempotencia | Antes de crear, consultar si ya existe una OC con la referencia de la solicitud; además, tabla propia `solicitud → OC` con restricción única |
| Errores | Mensajes de SAP (`BAPIRET2` / `sap-message`) se traducen a errores de negocio legibles para el agente; 4xx no se reintentan, 5xx y timeouts con reintento exponencial y *circuit breaker* |
| Retroactivas | Marca en la OC (texto o campo Z) para que el área de compras y auditoría las identifique |
| Trazabilidad | Registro inmutable: solicitud, resultado de controles, quién aprobó, cuándo, número de OC, versión del prompt y del modelo |
| Pruebas | Contra *sandbox* o tenant QA de SAP; pruebas de contrato del mapeo |

## 7. Análisis crítico: órdenes retroactivas

`[AJUSTAR con los casos reales: cuántos, montos, áreas, quién aprobó.]`

**Qué es.** La factura existe antes de la aprobación (o de la solicitud): el bien o servicio ya se recibió y la OC solo "regulariza" el gasto. El control preventivo se convierte en un trámite posterior.

**Por qué es un problema.**
- La aprobación pierde su función: el líder aprueba algo ya consumido, sin poder real de decir no.
- Se compromete gasto sin presupuesto ni validación del proveedor, el precio o el IVA.
- Debilita la segregación de funciones y es una alerta clásica de auditoría y de riesgo de fraude.
- Distorsiona la planeación: el compromiso de presupuesto aparece tarde.

**Causas probables (a validar con el área).** Urgencia operativa real; proceso de compra percibido como lento; proveedores recurrentes sin contrato marco; falta de una vía de compra de emergencia.

**Qué hace la solución.** No bloquea la regularización (el gasto ya existe y hay que pagarlo), pero la **hace visible y trazable**: alerta C09, justificación obligatoria, aprobación humana explícita y marca en la OC.

**Recomendación de proceso.**
1. Indicador mensual de retroactivas por área y aprobador, con meta de reducción.
2. Vía rápida formal para urgencias (compra de emergencia con tope y aprobación posterior en 48 h) para que no se use la retroactiva como atajo.
3. Contratos marco u órdenes abiertas con proveedores recurrentes.
4. Por encima de cierto monto o reincidencia, escalar al siguiente nivel de aprobación y notificar a control interno.
5. Política de "sin OC no hay pago" con excepciones documentadas.

## 8. Costos del modelo

Modelo por defecto: `claude-sonnet-5-5` (configurable con `MODEL`; alternativa económica `claude-haiku-5-5`). El chat muestra en vivo tokens y costo estimado por turno.

Fórmula: `costo = tokens_entrada × precio_entrada + tokens_salida × precio_salida` (precios en `PRECIO_INPUT_MTOK` y `PRECIO_OUTPUT_MTOK`, USD por millón de tokens; `[AJUSTAR]` verificar la tarifa vigente).

| Concepto | Valor medido `[AJUSTAR]` |
|---|---|
| Llamadas al modelo por caso | |
| Tokens de entrada por caso | |
| Tokens de salida por caso | |
| Costo por caso (Sonnet) | |
| Costo por caso (Haiku) | |
| Costo mensual estimado (N solicitudes) | |

Palancas de ahorro: las validaciones no consumen tokens (son código); *prompt caching* del system prompt y de la definición de herramientas; Haiku para casos `LISTA_PARA_OC`; modo por lotes para "procesar todo" fuera de horario.

## 9. Consideraciones de producción

- **Seguridad:** autenticación de usuarios (SSO corporativo), autorización por rol (quién puede aprobar OC), secretos en gestor, rate limiting.
- **Datos:** los correos y cotizaciones pueden contener datos personales; minimizar lo que se envía al modelo, retención definida y acuerdos con el proveedor del modelo (Ley 1581 de 2012 en Colombia).
- **Observabilidad:** trazas por turno (herramientas, latencia, tokens, costo, decisión), alertas por tasa de error y por aumento de retroactivas.
- **Calidad:** conjunto de evaluación con los casos y variantes; correr `demo.ts` en CI en cada cambio; pruebas de *prompt injection* en los documentos.
- **Gobierno de IA:** inventario del caso de uso, dueño de negocio, versión de prompt y modelo registrada en cada OC, revisión humana obligatoria en la acción irreversible.
- **Escalabilidad:** servidor sin estado; la cola de solicitudes entrantes (correo) se procesaría con un worker y el chat quedaría para revisión y excepciones.

## 10. Limitaciones conocidas

- SAP simulado en memoria: en serverless el registro de OC se reinicia entre instancias (la idempotencia real va en SAP y en una tabla propia).
- Un solo ítem por OC `[AJUSTAR si los casos traen varias posiciones]`.
- Parser ajustado al formato de las cotizaciones del reto.

## 11. Uso de asistentes de IA en el desarrollo

La solución se construyó con apoyo de asistentes de IA para acelerar la codificación. Las decisiones de arquitectura, la matriz de controles, el análisis del proceso y la validación de resultados son responsabilidad del autor.
