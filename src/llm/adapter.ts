// Interfaz propia del proveedor de LLM (PRD 6.1). El ciclo del agente solo conoce estos tipos:
// cambiar de proveedor = escribir otra implementación de `AdaptadorLLM`, sin tocar el ciclo.

export interface Llamada { id: string; nombre: string; args: unknown }
export type Mensaje =
  | { rol: "user"; texto: string }
  | { rol: "assistant"; texto: string; llamadas: Llamada[] }
  | { rol: "tool"; resultados: Array<{ id: string; nombre: string; contenido: string }> };

export interface DefinicionHerramienta { nombre: string; descripcion: string; schema: Record<string, unknown> }

export interface RespuestaLLM {
  texto: string;
  llamadas: Llamada[];
  uso: { entrada: number; salida: number };
}

export interface AdaptadorLLM {
  readonly proveedor: string;
  readonly modelo: string;
  enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], sistema: string): Promise<RespuestaLLM>;
}
