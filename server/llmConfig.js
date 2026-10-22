// Configuracion de la IA que lee los chats (API key, proveedor y modelo),
// editable desde el panel.
//
// Se guarda en un archivo aparte (config/llm.json, permisos 600) y se pega en
// memoria en el objeto `config`: el extractor la lee en cada llamada, asi que
// el cambio es inmediato sin reiniciar. Si el archivo no existe se usa lo del
// .env (LLM_API_KEY, LLM_BASE, LLM_MODELO).
//
// La API key nunca se devuelve: solo una vista enmascarada (sk-p…aHAA).
import fs from "node:fs";
import path from "node:path";
import { ErrorApi } from "./errores.js";
import { PROMPT_DEFECTO } from "./llm.js";

const PROMPT_MIN = 50;
const PROMPT_MAX = 20000;

/** Proveedores compatibles con la API de OpenAI (/chat/completions). */
export const PROVEEDORES_LLM = {
  openai: { nombre: "OpenAI", base: "https://api.openai.com/v1", modelo: "gpt-5-mini" },
  gemini: { nombre: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", modelo: "gemini-2.5-flash" },
  groq: { nombre: "Groq", base: "https://api.groq.com/openai/v1", modelo: "llama-3.3-70b-versatile" },
  deepseek: { nombre: "DeepSeek", base: "https://api.deepseek.com/v1", modelo: "deepseek-chat" },
  openrouter: { nombre: "OpenRouter", base: "https://openrouter.ai/api/v1", modelo: "openai/gpt-5-mini" },
};

function enmascarar(clave) {
  const k = String(clave ?? "");
  if (!k) return "";
  if (k.length <= 10) return "…" + k.slice(-2);
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

function proveedorDeBase(base) {
  const b = String(base ?? "").replace(/\/+$/, "");
  const par = Object.entries(PROVEEDORES_LLM).find(([, p]) => p.base === b);
  return par ? par[0] : b ? "otro" : "openai";
}

export function crearConfigLLM({ ruta, config }) {
  // lo del .env, para poder volver a ello al borrar
  const delEnv = {
    LLM_API_KEY: config.LLM_API_KEY ?? "",
    LLM_BASE: config.LLM_BASE ?? "",
    LLM_MODELO: config.LLM_MODELO ?? "",
  };

  /** ¿La API key en uso esta guardada desde el panel (en el archivo)? */
  function keyEnDisco() {
    if (!ruta) return false;
    try {
      return Boolean(JSON.parse(fs.readFileSync(ruta, "utf8"))?.apiKey);
    } catch {
      return false;
    }
  }

  /** La key se escribe en el archivo solo si no es la misma del .env. */
  function keyDelPanel() {
    return Boolean(config.LLM_API_KEY) && (config.LLM_API_KEY !== delEnv.LLM_API_KEY || keyEnDisco());
  }

  function escribir(datos) {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    const tmp = `${ruta}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...datos, actualizado: new Date().toISOString() }, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmp, ruta);
    try {
      fs.chmodSync(ruta, 0o600);
    } catch {
      /* en Windows no aplica */
    }
  }

  /** Al arrancar: si hay archivo, manda sobre el .env. */
  function cargar() {
    if (!ruta) return false;
    try {
      const j = JSON.parse(fs.readFileSync(ruta, "utf8"));
      if (j && typeof j === "object") {
        if (typeof j.apiKey === "string" && j.apiKey) config.LLM_API_KEY = j.apiKey;
        if (typeof j.base === "string" && j.base) config.LLM_BASE = j.base;
        if (typeof j.modelo === "string" && j.modelo) config.LLM_MODELO = j.modelo;
        if (typeof j.prompt === "string" && j.prompt.trim()) config.LLM_PROMPT = j.prompt;
        return true;
      }
    } catch {
      /* no existe o ilegible: se queda lo del .env */
    }
    return false;
  }
  cargar();

  function estado() {
    const base = String(config.LLM_BASE || PROVEEDORES_LLM.openai.base).replace(/\/+$/, "");
    return {
      configurada: Boolean(config.LLM_API_KEY),
      apiKeyVista: enmascarar(config.LLM_API_KEY),
      proveedor: proveedorDeBase(base),
      base,
      modelo: String(config.LLM_MODELO || "gpt-5-mini"),
      origen: config.LLM_API_KEY ? (keyEnDisco() ? "panel" : ".env") : null,
      // instrucciones de la IA: las guardadas o las predeterminadas
      prompt: String(config.LLM_PROMPT || "").trim() || PROMPT_DEFECTO,
      promptPersonalizado: Boolean(String(config.LLM_PROMPT || "").trim()),
      promptDefecto: PROMPT_DEFECTO,
      proveedores: PROVEEDORES_LLM,
    };
  }

  /** Valida y normaliza lo que manda el panel. Lanza ErrorApi 400 si no sirve. */
  function normalizar(patch = {}) {
    const salida = {};
    if (patch.apiKey !== undefined && String(patch.apiKey).trim()) {
      const k = String(patch.apiKey).trim();
      if (k.length < 20 || /\s/.test(k)) throw new ErrorApi(400, "La API key no parece válida (muy corta o con espacios)");
      salida.apiKey = k;
    }
    let base = patch.base;
    if (patch.proveedor && patch.proveedor !== "otro") {
      const p = PROVEEDORES_LLM[patch.proveedor];
      if (!p) throw new ErrorApi(400, `Proveedor desconocido: ${patch.proveedor}`);
      base = p.base;
    }
    if (base !== undefined) {
      const b = String(base).trim().replace(/\/+$/, "");
      if (!/^https:\/\/[^\s/]+\.[^\s]+$/.test(b)) throw new ErrorApi(400, "La URL del proveedor debe empezar por https://");
      salida.base = b;
    }
    if (patch.prompt !== undefined) {
      // null / "" / igual al predeterminado = volver al predeterminado
      const t = patch.prompt === null ? "" : String(patch.prompt).replace(/\r\n/g, "\n").trim();
      if (t && t !== PROMPT_DEFECTO.trim()) {
        if (t.length < PROMPT_MIN) throw new ErrorApi(400, `Las instrucciones son demasiado cortas (mínimo ${PROMPT_MIN} caracteres)`);
        if (t.length > PROMPT_MAX) throw new ErrorApi(400, `Las instrucciones son demasiado largas (máximo ${PROMPT_MAX} caracteres)`);
        salida.prompt = t;
      } else {
        salida.prompt = "";
      }
    }
    if (patch.modelo !== undefined) {
      const m = String(patch.modelo).trim();
      if (!m || m.length > 100 || /\s/.test(m)) throw new ErrorApi(400, "Indica un modelo válido (sin espacios)");
      salida.modelo = m;
    }
    return salida;
  }

  /** Lo que quedaria si se guardara `patch` (para probar antes de guardar). */
  function vistaPrevia(patch = {}) {
    const n = normalizar(patch);
    return {
      apiKey: n.apiKey ?? config.LLM_API_KEY,
      base: n.base ?? (config.LLM_BASE || PROVEEDORES_LLM.openai.base),
      modelo: n.modelo ?? (config.LLM_MODELO || "gpt-5-mini"),
    };
  }

  return {
    estado,
    cargar,
    vistaPrevia,

    guardar(patch = {}) {
      const n = normalizar(patch);
      // en memoria: efectivo ya
      if (n.apiKey) config.LLM_API_KEY = n.apiKey;
      if (n.base) config.LLM_BASE = n.base;
      if (n.modelo) config.LLM_MODELO = n.modelo;
      if (n.prompt !== undefined) config.LLM_PROMPT = n.prompt;
      // solo cambiar las instrucciones no exige tener la key
      const soloPrompt = Object.keys(n).every((k) => k === "prompt");
      if (!config.LLM_API_KEY && !soloPrompt) throw new ErrorApi(400, "Pega la API key del proveedor");
      if (!ruta) return { ...estado(), aviso: "Sin archivo de configuración: solo en memoria" };
      try {
        fs.mkdirSync(path.dirname(ruta), { recursive: true });
        const tmp = `${ruta}.tmp`;
        fs.writeFileSync(
          tmp,
          JSON.stringify(
            {
              // la key solo se guarda si vino del panel (no se copia la del .env)
              ...(keyDelPanel() ? { apiKey: config.LLM_API_KEY } : {}),
              base: config.LLM_BASE || PROVEEDORES_LLM.openai.base,
              modelo: config.LLM_MODELO || "gpt-5-mini",
              ...(config.LLM_PROMPT ? { prompt: config.LLM_PROMPT } : {}),
              actualizado: new Date().toISOString(),
            },
            null,
            2,
          ),
          { encoding: "utf8", mode: 0o600 },
        );
        fs.renameSync(tmp, ruta);
        try {
          fs.chmodSync(ruta, 0o600);
        } catch {
          /* en Windows no aplica */
        }
      } catch (e) {
        return { ...estado(), aviso: `Quedó en memoria pero no en disco: ${e?.message ?? e}` };
      }
      return estado();
    },

    /**
     * Borra la key/proveedor/modelo guardados desde el panel y vuelve a lo
     * del .env. Las instrucciones (prompt) personalizadas se conservan.
     */
    borrar() {
      config.LLM_API_KEY = delEnv.LLM_API_KEY;
      config.LLM_BASE = delEnv.LLM_BASE;
      config.LLM_MODELO = delEnv.LLM_MODELO;
      if (ruta) {
        try {
          if (config.LLM_PROMPT) escribir({ prompt: config.LLM_PROMPT });
          else fs.unlinkSync(ruta);
        } catch {
          /* no existia */
        }
      }
      return estado();
    },
  };
}
