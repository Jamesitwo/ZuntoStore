// Credenciales de LucidSales que usa el backend para lo que hace servidor
// contra servidor: cambio de estado (si el panel lo delega), «Probar ahora»
// y el reparto automatico.
//
// Se guardan en un archivo aparte (server/credenciales.json) y ademas se
// pegan en memoria en el objeto `config`, asi que el cambio es inmediato:
// no hay que reiniciar nada ni tocar el .env a mano.
//
// Nunca se devuelven: el GET solo enseña el correo enmascarado
// (a***z@dominio.com) y ni la clave ni el correo completos salen del servidor.
import fs from "node:fs";
import path from "node:path";
import { escribirJsonSeguro, leerJsonSeguro } from "./secretos.js";

export function crearCredenciales({ ruta, config }) {
  /** Al arrancar: si el archivo ya existe, manda el sobre el .env. */
  function cargar() {
    if (!ruta) return false;
    try {
      const j = leerJsonSeguro(ruta);
      if (j && typeof j.email === "string" && j.email) {
        config.LUCID_EMAIL = j.email;
        config.LUCID_PASSWORD = String(j.password ?? "");
        return true;
      }
    } catch {
      /* no existe o ilegible: se queda lo del .env */
    }
    return false;
  }
  cargar();

  function enmascarar(email) {
    const [usuario, dominio] = String(email ?? "").split("@");
    if (!dominio) return "";
    const u =
      usuario.length <= 2
        ? "*".repeat(Math.max(usuario.length, 1))
        : usuario[0] + "*".repeat(usuario.length - 2) + usuario[usuario.length - 1];
    return `${u}@${dominio}`;
  }

  function estado() {
    const hay = Boolean(config.LUCID_EMAIL && config.LUCID_PASSWORD);
    return {
      guardadas: hay,
      email: hay ? enmascarar(config.LUCID_EMAIL) : null,
      origen: hay ? (ruta && existeEnDisco() ? "archivo" : ".env") : null,
    };
  }

  function existeEnDisco() {
    if (!ruta) return false;
    try {
      fs.accessSync(ruta);
      return true;
    } catch {
      return false;
    }
  }

  return {
    estado,
    cargar,

    /** null si el par no sirve; si sirve, la cadena del error. */
    validar(email, password) {
      const e = String(email ?? "").trim();
      const p = String(password ?? "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
        return "El correo no parece un correo valido de LucidSales";
      }
      if (p.length < 4) return "La contraseña es demasiado corta (minimo 4)";
      return null;
    },

    guardar(email, password) {
      const e = String(email).trim();
      const p = String(password);
      // 1) en memoria: efectivo ya, sin reiniciar
      config.LUCID_EMAIL = e;
      config.LUCID_PASSWORD = p;
      if (!ruta) return { ...estado(), aviso: "Sin archivo de credenciales: solo en memoria" };
      try {
        escribirJsonSeguro(ruta, { email: e, password: p, actualizado: new Date().toISOString() });
        try {
          fs.chmodSync(ruta, 0o600);
        } catch {
          /* en Windows no aplica */
        }
      } catch (err) {
        return {
          ...estado(),
          aviso: `Quedaron en memoria pero no en disco: ${err?.message ?? err}`,
        };
      }
      return estado();
    },

    borrar() {
      config.LUCID_EMAIL = "";
      config.LUCID_PASSWORD = "";
      if (ruta) {
        try {
          fs.unlinkSync(ruta);
        } catch {
          /* no existia */
        }
      }
      return estado();
    },
  };
}
