// Clave de la API para integraciones (Lucid Bot, n8n...), generada desde el
// panel (Ajustes). Se muestra UNA vez al generarla; en disco solo queda su
// huella sha256, asi que ni el archivo ni el panel la pueden volver a mostrar.
//
// La de la variable API_KEY (.env / Railway) sigue valiendo ademas de esta.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const huella = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

export function crearApiKeys({ ruta = null, claveEnv = "" } = {}) {
  let memoria = null; // sin ruta (pruebas): solo en memoria

  function leer() {
    if (!ruta) return memoria;
    try {
      const j = JSON.parse(fs.readFileSync(ruta, "utf8").replace(/^﻿/, ""));
      return j?.huella ? j : null;
    } catch {
      return null;
    }
  }

  function escribir(v) {
    if (!ruta) {
      memoria = v;
      return;
    }
    if (!v) {
      // no se puede borrar en todos los entornos: se deja vacio
      fs.mkdirSync(path.dirname(ruta), { recursive: true });
      fs.writeFileSync(ruta, "{}", { mode: 0o600 });
      return;
    }
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    const tmp = `${ruta}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, ruta);
  }

  return {
    /** Lo que ve el panel (nunca la clave). */
    estado() {
      const g = leer();
      return {
        generada: Boolean(g),
        vista: g?.vista ?? "",
        creada: g?.creada ?? null,
        creadaPor: g?.creadaPor ?? null,
        // hay otra en la variable API_KEY del servidor (.env / Railway)
        variableServidor: Boolean(claveEnv),
      };
    },

    /** Genera una nueva (reemplaza la anterior). Devuelve la clave UNA vez. */
    generar({ usuario = null } = {}) {
      const clave = `zs_${crypto.randomBytes(32).toString("base64url")}`;
      escribir({
        huella: huella(clave),
        vista: `${clave.slice(0, 6)}…${clave.slice(-4)}`,
        creada: new Date().toISOString(),
        creadaPor: usuario,
      });
      return { clave, ...this.estado() };
    },

    revocar() {
      escribir(null);
      return this.estado();
    },

    /** ¿La clave recibida es valida? (comparacion en tiempo constante) */
    valida(recibida) {
      const r = String(recibida ?? "");
      if (!r) return false;
      const h = Buffer.from(huella(r), "hex");
      const candidatas = [];
      const g = leer();
      if (g?.huella) candidatas.push(g.huella);
      if (claveEnv) candidatas.push(huella(claveEnv));
      let ok = false;
      for (const c of candidatas) {
        const b = Buffer.from(c, "hex");
        if (b.length === h.length && crypto.timingSafeEqual(b, h)) ok = true;
      }
      return ok;
    },
  };
}
