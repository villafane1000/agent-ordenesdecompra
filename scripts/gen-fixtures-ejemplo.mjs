// Genera fixtures DE EJEMPLO para probar el esqueleto antes de recibir los reales.
// Mañana se reemplaza la carpeta fixtures/reto-03 completa por la que entregue Periferia.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = join(process.cwd(), "fixtures", "reto-03");
const w = (p, data) => {
  const full = join(base, p);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
};

w("maestros/proveedores.json", [
  { nit: "900123456-1", razonSocial: "Tecnología Andina S.A.S.", estado: "ACTIVO", indicadorIvaDefault: "V19", condicionPagoDefault: "N30" },
  { nit: "800987654-3", razonSocial: "Suministros del Caribe Ltda.", estado: "ACTIVO", indicadorIvaDefault: "V19", condicionPagoDefault: "N45" },
  { nit: "901555222-7", razonSocial: "Servicios Express S.A.S.", estado: "BLOQUEADO", indicadorIvaDefault: "V19", condicionPagoDefault: "N30" },
  { nit: "830111999-0", razonSocial: "Capacitación Pro S.A.S.", estado: "ACTIVO", indicadorIvaDefault: "V0", condicionPagoDefault: "N15" }
]);
w("maestros/centros-costo.json", [
  { codigo: "CC-1001", nombre: "Tecnología", subareas: ["Infraestructura", "Desarrollo"], lider: "ana.gomez@periferia.test", topeAprobacion: 20000000 },
  { codigo: "CC-2001", nombre: "Comercial", subareas: ["Ventas", "Mercadeo"], lider: "carlos.ruiz@periferia.test", topeAprobacion: 10000000 },
  { codigo: "CC-3001", nombre: "Talento Humano", subareas: ["Formación"], lider: "laura.diaz@periferia.test", topeAprobacion: 5000000 }
]);
w("maestros/indicadores-iva.json", [
  { codigo: "V19", descripcion: "IVA general 19%", tasa: 0.19 },
  { codigo: "V5", descripcion: "IVA reducido 5%", tasa: 0.05 },
  { codigo: "V0", descripcion: "Exento / excluido", tasa: 0 }
]);
w("maestros/condiciones-pago.json", [
  { codigo: "N15", dias: 15, descripcion: "Neto 15 días" },
  { codigo: "N30", dias: 30, descripcion: "Neto 30 días" },
  { codigo: "N45", dias: 45, descripcion: "Neto 45 días" }
]);

const caso = (id, { correo, solicitud, cotizacion, aprobacion, factura }) => {
  w(`solicitudes/${id}/correo.json`, correo);
  w(`solicitudes/${id}/solicitud.json`, solicitud);
  w(`solicitudes/${id}/cotizacion.txt`, cotizacion);
  w(`solicitudes/${id}/aprobacion.json`, aprobacion);
  if (factura) w(`solicitudes/${id}/factura.txt`, factura);
};
const cot = (nit, prov, sub, ivaPct, fecha) => {
  const iva = Math.round(sub * ivaPct);
  return `COTIZACIÓN No. Q-${fecha.replaceAll("-", "")}\nProveedor: ${prov}\nNIT: ${nit}\nFecha: ${fecha}\n\nSubtotal: $${sub.toLocaleString("es-CO")}\nIVA (${Math.round(ivaPct * 100)}%): $${iva.toLocaleString("es-CO")}\nTotal: $${(sub + iva).toLocaleString("es-CO")}\nValidez: 30 días\n`;
};

// sol-001: caso feliz
caso("sol-001", {
  correo: { de: "pedro.lopez@periferia.test", asunto: "Solicitud compra licencias", fecha: "2026-09-01" },
  solicitud: { id: "sol-001", solicitante: "pedro.lopez@periferia.test", nitProveedor: "900123456-1", centroCosto: "CC-1001", subarea: "Desarrollo", descripcion: "Licencias IDE x10", monto: 8000000, indicadorIva: "V19", condicionPago: "N30", fecha: "2026-09-01" },
  cotizacion: cot("900123456-1", "Tecnología Andina S.A.S.", 8000000, 0.19, "2026-08-30"),
  aprobacion: { aprobador: "ana.gomez@periferia.test", estado: "APROBADA", fecha: "2026-09-02", monto: 8000000 }
});
// sol-002: proveedor bloqueado
caso("sol-002", {
  correo: { de: "maria.perez@periferia.test", asunto: "Mensajería urgente", fecha: "2026-09-03" },
  solicitud: { id: "sol-002", solicitante: "maria.perez@periferia.test", nitProveedor: "901555222-7", centroCosto: "CC-2001", subarea: "Ventas", descripcion: "Servicio de mensajería", monto: 1500000, indicadorIva: "V19", condicionPago: "N30", fecha: "2026-09-03" },
  cotizacion: cot("901555222-7", "Servicios Express S.A.S.", 1500000, 0.19, "2026-09-02"),
  aprobacion: { aprobador: "carlos.ruiz@periferia.test", estado: "APROBADA", fecha: "2026-09-03", monto: 1500000 }
});
// sol-003: excede tope del líder
caso("sol-003", {
  correo: { de: "jorge.mora@periferia.test", asunto: "Campaña mercadeo Q4", fecha: "2026-09-05" },
  solicitud: { id: "sol-003", solicitante: "jorge.mora@periferia.test", nitProveedor: "800987654-3", centroCosto: "CC-2001", subarea: "Mercadeo", descripcion: "Material POP campaña Q4", monto: 14000000, indicadorIva: "V19", condicionPago: "N45", fecha: "2026-09-05" },
  cotizacion: cot("800987654-3", "Suministros del Caribe Ltda.", 14000000, 0.19, "2026-09-04"),
  aprobacion: { aprobador: "carlos.ruiz@periferia.test", estado: "APROBADA", fecha: "2026-09-06", monto: 14000000 }
});
// sol-004: aprobador no es líder del centro + monto difiere de cotización
caso("sol-004", {
  correo: { de: "sofia.leon@periferia.test", asunto: "Servidores", fecha: "2026-09-08" },
  solicitud: { id: "sol-004", solicitante: "sofia.leon@periferia.test", nitProveedor: "900123456-1", centroCosto: "CC-1001", subarea: "Infraestructura", descripcion: "2 servidores rack", monto: 12000000, indicadorIva: "V19", condicionPago: "N30", fecha: "2026-09-08" },
  cotizacion: cot("900123456-1", "Tecnología Andina S.A.S.", 13500000, 0.19, "2026-09-07"),
  aprobacion: { aprobador: "carlos.ruiz@periferia.test", estado: "APROBADA", fecha: "2026-09-09", monto: 12000000 }
});
// sol-005: retroactiva (factura anterior a la aprobación)
caso("sol-005", {
  correo: { de: "luis.vega@periferia.test", asunto: "Regularizar compra ya facturada", fecha: "2026-09-15" },
  solicitud: { id: "sol-005", solicitante: "luis.vega@periferia.test", nitProveedor: "830111999-0", centroCosto: "CC-3001", subarea: "Formación", descripcion: "Curso liderazgo (ya dictado)", monto: 3000000, indicadorIva: "V0", condicionPago: "N15", fecha: "2026-09-15" },
  cotizacion: cot("830111999-0", "Capacitación Pro S.A.S.", 3000000, 0, "2026-08-20"),
  aprobacion: { aprobador: "laura.diaz@periferia.test", estado: "APROBADA", fecha: "2026-09-16", monto: 3000000 },
  factura: "FACTURA ELECTRÓNICA FE-7781\nProveedor: Capacitación Pro S.A.S.\nNIT: 830111999-0\nFecha de emisión: 2026-09-01\nConcepto: Curso liderazgo\nTotal: $3.000.000\n"
});
// sol-006: IVA inconsistente y sin condición de pago (usa default)
caso("sol-006", {
  correo: { de: "pedro.lopez@periferia.test", asunto: "Insumos oficina", fecha: "2026-09-20" },
  solicitud: { id: "sol-006", solicitante: "pedro.lopez@periferia.test", nitProveedor: "800987654-3", centroCosto: "CC-1001", subarea: "Desarrollo", descripcion: "Insumos de oficina", monto: 2000000, indicadorIva: "V5", fecha: "2026-09-20" },
  cotizacion: cot("800987654-3", "Suministros del Caribe Ltda.", 2000000, 0.19, "2026-09-19"),
  aprobacion: { aprobador: "ana.gomez@periferia.test", estado: "APROBADA", fecha: "2026-09-21", monto: 2000000 }
});
console.log("Fixtures de ejemplo generados en", base);
