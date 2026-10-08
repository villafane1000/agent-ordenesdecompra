// Matriz de controles RC1–RC10 (PRD 7.3). Funciones puras: misma entrada, misma salida. Sin LLM.
import { normNit, normNombre, parseFecha } from "./extraccion.js";
import type { Derivados, Hallazgo, Maestros, Paquete, Validacion } from "./tipos.js";

export const TOLERANCIA_COTIZACION = 0.02; // RC5: 2 %
export const TOLERANCIA_ARITMETICA = 1;     // RC10: ±1 unidad monetaria

const fmt = (n: number, moneda = "COP") => `${moneda} ${Math.round(n * 100) / 100 === Math.round(n) ? Math.round(n).toLocaleString("es-CO") : n.toLocaleString("es-CO")}`;
const fecha = (s: string | null | undefined) => parseFecha(s ?? null);
const mismoCorreo = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** Extrae el email de "Nombre <correo@x.com>" o devuelve el texto tal cual. */
export const emailDe = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim();

export function validar(p: Paquete, m: Maestros): Validacion {
  const s = p.solicitud;
  const bloqueos: Hallazgo[] = [];
  const confirmaciones: Hallazgo[] = [];
  const derivados: Derivados = {};

  // RC1 · proveedor existe (por NIT; si no hay NIT, por nombre normalizado) y está activo
  const nitSol = s.proveedor_nit ? normNit(s.proveedor_nit) : null;
  const prov = nitSol
    ? m.proveedores.find((x) => normNit(x.nit) === nitSol)
    : m.proveedores.find((x) => normNombre(x.nombre) === normNombre(s.proveedor_nombre));
  if (!prov) {
    bloqueos.push({ regla: "RC1", detalle: `El proveedor "${s.proveedor_nombre}"${s.proveedor_nit ? ` (NIT ${s.proveedor_nit})` : ""} no existe en el maestro de proveedores.`, accion: "Solicitar a compras la creación/homologación del proveedor en SAP o corregir el NIT en la solicitud." });
  } else if (!prov.activo) {
    bloqueos.push({ regla: "RC1", detalle: `El proveedor ${prov.nombre} (NIT ${prov.nit}) está inactivo.`, accion: "Reactivar el proveedor con compras o usar un proveedor activo." });
  } else {
    derivados.proveedor = { codigo_sap: prov.codigo_sap, nit: prov.nit, nombre: prov.nombre };
  }

  // RC4 · centro de costo existe y la subárea le pertenece
  const cc = m.centros.find((c) => c.centro_costo === s.centro_costo);
  if (!cc) bloqueos.push({ regla: "RC4", detalle: `El centro de costo ${s.centro_costo} no existe.`, accion: "Corregir el centro de costo en la solicitud." });
  else if (!cc.subareas.includes(s.subarea)) bloqueos.push({ regla: "RC4", detalle: `La subárea "${s.subarea}" no pertenece al centro ${cc.centro_costo} (válidas: ${cc.subareas.join(", ")}).`, accion: "Corregir la subárea con el solicitante." });

  // RC2 · aprobación existe, dice "Aprobado" y la envió un aprobador del centro
  const a = p.aprobacion;
  const aprobador = a && cc ? cc.aprobadores.find((x) => mismoCorreo(x.email, emailDe(a.de))) : undefined;
  if (!a) bloqueos.push({ regla: "RC2", detalle: "No hay correo de aprobación en el paquete.", accion: "Pedir al líder del centro de costo la aprobación por correo." });
  else if (!a.aprobado) bloqueos.push({ regla: "RC2", detalle: `El correo de aprobación de ${a.de} no contiene "Aprobado".`, accion: "Pedir al líder una aprobación explícita." });
  else if (cc && !aprobador) bloqueos.push({ regla: "RC2", detalle: `${emailDe(a.de)} no es aprobador del centro ${cc.centro_costo} (aprobadores: ${cc.aprobadores.map((x) => x.email).join(", ")}).`, accion: "Reenviar la solicitud a un aprobador autorizado del centro." });

  // RC3 · el valor no supera el tope del aprobador para ese centro
  if (aprobador) {
    derivados.aprobador = { email: aprobador.email, tope: aprobador.tope };
    if (s.valor_total > aprobador.tope) bloqueos.push({ regla: "RC3", detalle: `${fmt(s.valor_total, s.moneda)} supera el tope de ${aprobador.email} (${fmt(aprobador.tope, s.moneda)}) en ${cc?.centro_costo}.`, accion: "Escalar la aprobación a un aprobador con tope suficiente." });
  }

  // RC10 · cantidad × valor unitario = valor total (±1)
  const calculado = s.cantidad * s.valor_unitario;
  if (Math.abs(calculado - s.valor_total) > TOLERANCIA_ARITMETICA) bloqueos.push({ regla: "RC10", detalle: `${s.cantidad} × ${fmt(s.valor_unitario, s.moneda)} = ${fmt(calculado, s.moneda)}, pero la solicitud dice ${fmt(s.valor_total, s.moneda)}.`, accion: "Corregir cantidad, valor unitario o total en la solicitud." });

  // RC5 · cotización vs solicitud (≤ 2 %); sin cotización → confirmación
  const c = p.cotizacion;
  if (!c) confirmaciones.push({ regla: "RC5", detalle: "El paquete no trae cotización.", accion: "Confirmar que se crea la OC sin cotización (desvío de proceso)." });
  else {
    // PRD RC5: se compara el TOTAL de la cotización con valor_total de la solicitud (ambos con IVA incluido en los fixtures).
    const ref = c.total;
    const dif = Math.abs(ref - s.valor_total) / s.valor_total;
    if (dif > TOLERANCIA_COTIZACION) confirmaciones.push({
      regla: "RC5",
      detalle: `Solicitud ${fmt(s.valor_total, s.moneda)} vs cotización ${fmt(ref, c.moneda)} (diferencia ${fmt(Math.abs(ref - s.valor_total), s.moneda)}, ${(dif * 100).toFixed(1)} %; tolerancia 2 %).`,
      accion: "Confirmar que la OC se crea con el valor de la solicitud aprobada; si el valor real es el de la cotización, se requiere nueva aprobación.",
      comparacion: { campo: "Valor total (IVA incluido)", solicitud: fmt(s.valor_total, s.moneda), cotizacion: fmt(ref, c.moneda), diferencia: `${fmt(Math.abs(ref - s.valor_total), s.moneda)} (${(dif * 100).toFixed(1)} %)` },
    });
  }

  // RC6 · IVA ausente → se deriva del proveedor y se pide confirmación
  if (!s.indicador_iva) {
    const def = prov?.indicador_iva_default;
    if (def) {
      derivados.indicador_iva = { valor: def, fuente: "maestro.proveedores.indicador_iva_default" };
      confirmaciones.push({ regla: "RC6", detalle: `La solicitud no informa indicador de IVA; se propone ${def} (default del proveedor${ivaDesc(m, def)}).`, accion: `Confirmar el indicador ${def}.` });
    } else confirmaciones.push({ regla: "RC6", detalle: "La solicitud no informa indicador de IVA y el proveedor no tiene default.", accion: "Indicar el código de IVA." });
  } else if (!m.iva.some((i) => i.codigo === s.indicador_iva)) {
    confirmaciones.push({ regla: "RC6", detalle: `El indicador de IVA ${s.indicador_iva} no existe en el maestro.`, accion: "Confirmar o corregir el indicador." });
  }

  // RC7 · condiciones de pago ausentes → se derivan del proveedor (solo informa)
  if (!s.condiciones_pago && prov?.condiciones_pago_default) derivados.condiciones_pago = { valor: prov.condiciones_pago_default, fuente: "maestro.proveedores.condiciones_pago_default" };

  // RC8 · factura anterior a la solicitud → retroactiva (confirmación + registro)
  const fSol = fecha(s.fecha_solicitud);
  const retroactiva = !!(p.factura && fSol && p.factura.fecha < fSol);
  if (retroactiva && p.factura) confirmaciones.push({ regla: "RC8", detalle: `OC retroactiva: la factura ${p.factura.numero} (${p.factura.fecha}) es anterior a la solicitud (${fSol}). Se omitió la cotización previa.`, accion: "Confirmar la creación; quedará marcada retroactiva = true en el log de control." });

  // RC9 · la aprobación no puede ser anterior a la solicitud
  const fApr = fecha(a?.fecha);
  if (a && fApr && fSol && fApr < fSol) confirmaciones.push({ regla: "RC9", detalle: `La aprobación (${fApr}) es anterior a la solicitud (${fSol}).`, accion: "Confirmar que la aprobación corresponde a esta solicitud." });

  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva };
}

function ivaDesc(m: Maestros, codigo: string) {
  const i = m.iva.find((x) => x.codigo === codigo);
  return i ? `: ${i.descripcion ?? `${Math.round(i.tasa * 100)} %`}` : "";
}
