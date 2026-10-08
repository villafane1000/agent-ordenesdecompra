// Matriz de controles: funciones puras, deterministas, sin LLM.
// Cada control devuelve OK, ALERTA (requiere revisión humana explícita) o BLOQUEO (no se crea OC).
// MAÑANA: alinear IDs, textos y severidades con las "reglas de validación obligatorias" del PRD.
import { maestros, normNit, type Caso } from "../data/repo.js";
import { extraerCotizacion, extraerFactura } from "./extraccion.js";

export type Resultado = "OK" | "ALERTA" | "BLOQUEO";
export interface ResultadoControl { id: string; control: string; resultado: Resultado; detalle: string }
export type Decision = "LISTA_PARA_OC" | "REQUIERE_REVISION" | "RECHAZADA";

export interface Evaluacion {
  solicitudId: string;
  decision: Decision;
  retroactiva: boolean;
  controles: ResultadoControl[];
  valores: { subtotal: number; tasaIva: number; iva: number; total: number; indicadorIva: string; condicionPago: string; proveedor: string | null };
}

const TOLERANCIA = Number(process.env.TOLERANCIA_MONTO ?? 0.01); // 1 %
const cop = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
const correoEq = (a?: string, b?: string) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

export function evaluarSolicitud(caso: Caso): Evaluacion {
  const m = maestros();
  const s = caso.solicitud;
  const cot = extraerCotizacion(caso.cotizacionTxt);
  const fac = caso.facturaTxt ? extraerFactura(caso.facturaTxt) : null;
  const out: ResultadoControl[] = [];
  const add = (id: string, control: string, resultado: Resultado, detalle: string) => out.push({ id, control, resultado, detalle });

  // C01 Proveedor existe y está activo
  const prov = m.proveedores.find((p) => normNit(p.nit) === normNit(s.nitProveedor));
  if (!prov) add("C01", "Proveedor en maestro", "BLOQUEO", `NIT ${s.nitProveedor} no existe en el maestro de proveedores`);
  else if (prov.estado.toUpperCase() !== "ACTIVO") add("C01", "Proveedor en maestro", "BLOQUEO", `${prov.razonSocial} está en estado ${prov.estado}`);
  else add("C01", "Proveedor en maestro", "OK", `${prov.razonSocial} activo`);

  // C02 NIT de la cotización coincide con la solicitud
  if (!cot.nit) add("C02", "NIT cotización = solicitud", "ALERTA", "La cotización no trae NIT legible");
  else if (normNit(cot.nit) !== normNit(s.nitProveedor)) add("C02", "NIT cotización = solicitud", "BLOQUEO", `Cotización ${cot.nit} vs solicitud ${s.nitProveedor}`);
  else add("C02", "NIT cotización = solicitud", "OK", "Coinciden");

  // C03 Centro de costo y subárea válidos
  const cc = m.centros.find((c) => c.codigo === s.centroCosto);
  if (!cc) add("C03", "Centro de costo", "BLOQUEO", `Centro ${s.centroCosto} no existe`);
  else if (s.subarea && cc.subareas && !cc.subareas.includes(s.subarea)) add("C03", "Centro de costo", "BLOQUEO", `Subárea ${s.subarea} no pertenece a ${cc.codigo}`);
  else add("C03", "Centro de costo", "OK", `${cc.codigo} ${cc.nombre}${s.subarea ? " / " + s.subarea : ""}`);

  // C04 Aprobación: existe, aprobada y la dio el líder del centro
  const ap = caso.aprobacion;
  if (!ap) add("C04", "Aprobación del líder", "BLOQUEO", "No hay evidencia de aprobación");
  else if (ap.estado.toUpperCase() !== "APROBADA") add("C04", "Aprobación del líder", "BLOQUEO", `Estado de aprobación: ${ap.estado}`);
  else if (cc && !correoEq(ap.aprobador, cc.lider)) add("C04", "Aprobación del líder", "BLOQUEO", `Aprobó ${ap.aprobador}, pero el líder de ${cc.codigo} es ${cc.lider}`);
  else add("C04", "Aprobación del líder", "OK", `Aprobada por ${ap.aprobador} el ${ap.fecha}`);

  // C05 Monto dentro del tope del aprobador
  const subtotal = cot.subtotal ?? s.monto;
  if (cc && subtotal > cc.topeAprobacion) add("C05", "Tope de aprobación", "BLOQUEO", `${cop(subtotal)} supera el tope de ${cop(cc.topeAprobacion)} de ${cc.codigo}; requiere escalar`);
  else if (cc) add("C05", "Tope de aprobación", "OK", `${cop(subtotal)} ≤ ${cop(cc.topeAprobacion)}`);

  // C06 Monto solicitud vs cotización (y vs monto aprobado)
  if (cot.subtotal === null) add("C06", "Monto vs cotización", "ALERTA", "No se pudo leer el subtotal de la cotización");
  else {
    const dif = Math.abs(cot.subtotal - s.monto) / Math.max(s.monto, 1);
    if (dif > TOLERANCIA) add("C06", "Monto vs cotización", "BLOQUEO", `Solicitud ${cop(s.monto)} vs cotización ${cop(cot.subtotal)} (${(dif * 100).toFixed(1)} %)`);
    else if (ap?.monto !== undefined && cot.subtotal > ap.monto * (1 + TOLERANCIA)) add("C06", "Monto vs cotización", "BLOQUEO", `Cotización ${cop(cot.subtotal)} supera lo aprobado ${cop(ap.monto)}`);
    else add("C06", "Monto vs cotización", "OK", `Diferencia ${(dif * 100).toFixed(2)} %`);
  }

  // C07 Indicador de IVA válido y consistente con la cotización
  const indicador = s.indicadorIva ?? prov?.indicadorIvaDefault ?? "";
  const ind = m.iva.find((i) => i.codigo === indicador);
  const tasa = ind?.tasa ?? 0;
  if (!ind) add("C07", "Indicador de IVA", "BLOQUEO", `Indicador ${indicador || "(vacío)"} no existe`);
  else if (cot.ivaPct !== null && Math.abs(cot.ivaPct - tasa) > 0.0001) add("C07", "Indicador de IVA", "ALERTA", `Solicitud ${ind.codigo} (${tasa * 100} %) vs cotización ${cot.ivaPct * 100} %`);
  else add("C07", "Indicador de IVA", "OK", `${ind.codigo} ${tasa * 100} %${s.indicadorIva ? "" : " (default del proveedor)"}`);

  // C08 Condición de pago válida (default del proveedor si falta)
  const cpCod = s.condicionPago ?? prov?.condicionPagoDefault ?? "";
  const cp = m.pagos.find((p) => p.codigo === cpCod);
  if (!cp) add("C08", "Condición de pago", "BLOQUEO", `Condición ${cpCod || "(vacía)"} no existe`);
  else add("C08", "Condición de pago", "OK", `${cp.codigo} ${cp.descripcion ?? cp.dias + " días"}${s.condicionPago ? "" : " (default del proveedor)"}`);

  // C09 Compra retroactiva: factura emitida antes de la aprobación (o de la solicitud)
  let retroactiva = false;
  if (fac?.fechaEmision) {
    const ref = ap?.fecha ?? s.fecha;
    if (fac.fechaEmision < ref) {
      retroactiva = true;
      add("C09", "Compra retroactiva", "ALERTA", `Factura ${fac.numero ?? ""} emitida ${fac.fechaEmision}, antes de la aprobación (${ref}). La OC regulariza un gasto ya incurrido`);
    } else add("C09", "Compra retroactiva", "OK", "Factura posterior a la aprobación");
  } else add("C09", "Compra retroactiva", "OK", "Sin factura previa");

  const iva = Math.round(subtotal * tasa);
  const decision: Decision = out.some((c) => c.resultado === "BLOQUEO") ? "RECHAZADA" : out.some((c) => c.resultado === "ALERTA") ? "REQUIERE_REVISION" : "LISTA_PARA_OC";
  return {
    solicitudId: s.id ?? caso.id,
    decision, retroactiva, controles: out,
    valores: { subtotal, tasaIva: tasa, iva, total: subtotal + iva, indicadorIva: indicador, condicionPago: cpCod, proveedor: prov?.razonSocial ?? null },
  };
}
