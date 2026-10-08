// Pruebas de la matriz de controles y de las garantías del agente.
// Usan fixtures propios (tests/fixtures) para no depender de los datos oficiales del reto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

process.env.FIXTURES_DIR = fileURLToPath(new URL("./fixtures/reto-03", import.meta.url));
process.env.SIGNING_SECRET = "test-secret";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY_GENERAL;

const { leerCaso } = await import("../src/data/repo.js");
const { evaluarSolicitud } = await import("../src/domain/controles.js");
const { parseMonto, extraerCotizacion } = await import("../src/domain/extraccion.js");
const { ejecutar } = await import("../src/tools/oc.js");
const { turno } = await import("../src/agent/runtime.js");

const ev = (id: string) => evaluarSolicitud(leerCaso(id));
const control = (id: string, c: string) => ev(id).controles.find((x) => x.id === c)?.resultado;

test("parseMonto entiende formatos colombianos y anglosajones", () => {
  assert.equal(parseMonto("$13.500.000"), 13500000);
  assert.equal(parseMonto("13,500,000.50"), 13500000.5);
  assert.equal(parseMonto("13.500.000,50"), 13500000.5);
});

test("la cotización se extrae sin LLM", () => {
  const c = extraerCotizacion(leerCaso("sol-001").cotizacionTxt);
  assert.equal(c.subtotal, 8000000);
  assert.equal(c.ivaPct, 0.19);
  assert.deepEqual(c.camposFaltantes, []);
});

test("caso feliz: todos los controles OK", () => {
  const e = ev("sol-001");
  assert.equal(e.decision, "LISTA_PARA_OC");
  assert.equal(e.valores.total, 9520000);
});

test("C01 proveedor bloqueado → RECHAZADA", () => {
  assert.equal(control("sol-002", "C01"), "BLOQUEO");
  assert.equal(ev("sol-002").decision, "RECHAZADA");
});

test("C05 monto sobre el tope del líder → RECHAZADA", () => {
  assert.equal(control("sol-003", "C05"), "BLOQUEO");
});

test("C04 aprobador distinto al líder y C06 monto ≠ cotización → RECHAZADA", () => {
  assert.equal(control("sol-004", "C04"), "BLOQUEO");
  assert.equal(control("sol-004", "C06"), "BLOQUEO");
});

test("C09 factura anterior a la aprobación → retroactiva", () => {
  const e = ev("sol-005");
  assert.equal(e.retroactiva, true);
  assert.equal(e.decision, "REQUIERE_REVISION");
});

test("C07 IVA inconsistente → alerta; C08 usa condición de pago por defecto", () => {
  assert.equal(control("sol-006", "C07"), "ALERTA");
  assert.equal(ev("sol-006").valores.condicionPago, "N45");
});

test("las reglas son deterministas", () => {
  assert.deepEqual(ev("sol-004"), ev("sol-004"));
});

test("crear_oc_sap nunca crea una OC para una solicitud rechazada", async () => {
  const r = (await ejecutar("crear_oc_sap", { solicitudId: "sol-002" })) as { creada: boolean };
  assert.equal(r.creada, false);
});

test("retroactiva sin justificación no crea OC; con justificación sí", async () => {
  const sin = (await ejecutar("crear_oc_sap", { solicitudId: "sol-005" })) as { creada: boolean };
  assert.equal(sin.creada, false);
  const con = (await ejecutar("crear_oc_sap", { solicitudId: "sol-005", justificacionRetroactiva: "Curso urgente autorizado por gerencia" })) as { creada: boolean; numeroOC: string };
  assert.equal(con.creada, true);
  assert.match(con.numeroOC, /^45\d{8}$/);
});

test("idempotencia: el segundo intento devuelve la misma OC", async () => {
  const a = (await ejecutar("crear_oc_sap", { solicitudId: "sol-001" })) as { numeroOC: string };
  const b = (await ejecutar("crear_oc_sap", { solicitudId: "sol-001" })) as { numeroOC: string; duplicada: boolean };
  assert.equal(b.duplicada, true);
  assert.equal(b.numeroOC, a.numeroOC);
});

test("zod rechaza entradas inválidas", async () => {
  await assert.rejects(ejecutar("validar_solicitud", { solicitudId: "../etc/passwd" }));
});

test("confirmación humana: la acción pendiente trae resumen y no puede alterarse", async () => {
  const r = await turno({ modo: "reglas", messages: [], mensaje: "procesa sol-006" });
  assert.ok(r.pendiente, "debe quedar una acción pendiente de aprobación");
  assert.equal(r.pendiente.resumen?.total, 2100000);
  const alterada = { ...r.pendiente, input: { solicitudId: "sol-002" } };
  await assert.rejects(turno({ modo: "reglas", messages: [], pendiente: alterada, confirmacion: { toolUseId: r.pendiente.toolUseId, aprobado: true } }), /alterada/);
});
