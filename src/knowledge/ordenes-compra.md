## Proceso de órdenes de compra (Periferia IT Group)

Cada compra llega por correo con tres piezas: la solicitud (Excel, aquí `solicitud.json`), la cotización del proveedor (`cotizacion.txt`) y el correo de aprobación del líder (`aprobacion.json`). En algunos casos llega además la factura (`factura.txt`). La OC en SAP se crea con sociedad 1000 y organización de compras 1000; el correo de aprobación se adjunta como evidencia (texto y PDF con su sha256).

## Reglas de control

| Regla | Qué verifica | Efecto |
|---|---|---|
| RC1 | El proveedor existe en el maestro (por NIT; sin NIT, por nombre normalizado) y está activo | Bloqueo |
| RC2 | Hay aprobación, dice "Aprobado" y la envió un aprobador del centro de costo | Bloqueo |
| RC3 | El valor total no supera el tope del aprobador en ese centro | Bloqueo |
| RC4 | La subárea pertenece al centro de costo | Bloqueo |
| RC5 | Total de la cotización vs valor total de la solicitud ≤ 2 % (sin cotización: confirmar) | Confirmación |
| RC6 | Si falta el indicador de IVA, se toma el del proveedor | Confirmación + derivado |
| RC7 | Si faltan condiciones de pago, se toman las del proveedor | Derivado (informativo) |
| RC8 | Factura con fecha anterior a la solicitud → OC retroactiva | Confirmación + marca en control |
| RC9 | La fecha de aprobación no puede ser anterior a la solicitud | Confirmación |
| RC10 | Cantidad × valor unitario = valor total (±1) | Bloqueo |

## Acciones sugeridas típicas

- Proveedor inexistente o inactivo: pedir a compras la homologación en SAP o corregir el NIT.
- Aprobador sin autoridad o tope insuficiente: reenviar al aprobador autorizado del centro (o a uno con tope mayor).
- Subárea inválida o aritmética inconsistente: devolver la solicitud al solicitante para corregirla.
- Cotización distinta: la OC se crea con el valor de la solicitud aprobada; si el valor real es el de la cotización, se necesita nueva aprobación.

## Por qué importan las retroactivas

Una OC creada después de la factura convierte un control preventivo en un trámite posterior: el gasto ya ocurrió sin cotización comparada ni aprobación previa. La dirección quiere medir su frecuencia; por eso cada caso queda marcado en `control.csv`.

## Glosario

- **Indicadores de IVA:** C0 excluido, C1 IVA 19 %, C2 IVA 5 %.
- **Condiciones de pago:** Z000 inmediato, Z015, Z030 y Z060 días fecha factura.
- **Unidades:** UN unidad, H hora, MES mes.
