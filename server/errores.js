// Error con codigo HTTP: el servidor lo captura y responde {ok:false, msg}.
export class ErrorApi extends Error {
  constructor(status, msg, detalle) {
    super(msg);
    this.name = "ErrorApi";
    this.status = status;
    this.detalle = detalle;
  }
}

export const validacion = (msg) => new ErrorApi(400, msg);
export const noEncontrado = (msg) => new ErrorApi(404, msg);
export const noDisponible = (msg) => new ErrorApi(503, msg);
