// Configuracion del backend propio.
// Orden de precedencia: variables de entorno > archivo server/.env > defectos.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

function leerEnvArchivo(ruta) {
  try {
    const texto = fs.readFileSync(ruta, "utf8");
    const salida = {};
    for (const linea of texto.split(/\r?\n/)) {
      const t = linea.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const clave = t.slice(0, i).trim();
      let valor = t.slice(i + 1).trim();
      if (
        (valor.startsWith('"') && valor.endsWith('"') && valor.length > 1) ||
        (valor.startsWith("'") && valor.endsWith("'") && valor.length > 1)
      ) {
        valor = valor.slice(1, -1);
      }
      salida[clave] = valor;
    }
    return salida;
  } catch {
    return {};
  }
}

export function cargarConfig(env = process.env) {
  const archivo = leerEnvArchivo(path.join(dir, ".env"));
  const g = (clave, defecto) => env[clave] ?? archivo[clave] ?? defecto;

  return {
    /** Puerto HTTP del backend (el proxy de Vite apunta aqui). */
    PORT: Number(g("PORT", "8787")) || 8787,
    /** En produccion, enlaza este host solo a la red privada del proxy. */
    HOST: String(g("HOST", "127.0.0.1")),
    NODE_ENV: String(g("NODE_ENV", "development")),
    /**
     * Clave para integraciones servidor-a-servidor (p. ej. el bot). El PANEL
     * no la usa: entra con la sesion de LucidSales (ver sesionPanel.js).
     */
    API_KEY: String(g("API_KEY", "")),
    /** Credenciales de la cuenta de servicio contra LucidSales. */
    LUCID_EMAIL: String(g("LUCID_EMAIL", "")),
    LUCID_PASSWORD: String(g("LUCID_PASSWORD", "")),
    /** Tienda por defecto; si no se indica se usa la primera de la cuenta. */
    LUCID_TIENDA: String(g("LUCID_TIENDA", "")),
    LUCID_BASE: String(g("LUCID_BASE", "https://panel.lucidsales.co/b")).replace(/\/+$/, ""),
    /** API publica de Inter Rapidisisimo (oficinas por municipio). */
    INTER_BASE: String(
      g("INTER_BASE", "https://www3.interrapidisimo.com/Apicanalesventa/api"),
    ).replace(/\/+$/, ""),
    /** Origen exacto permitido por CORS. En produccion no se admite "*". */
    CORS_ORIGIN: String(g("CORS_ORIGIN", String(g("NODE_ENV", "development")) === "production" ? "" : "*")).trim(),
    /** Registro de cambios (JSONL, una linea por cambio). */
    HISTORIAL: String(g("HISTORIAL", path.join(dir, "historial.jsonl"))),
    /** Conversacion de cada pedido (chat de WhatsApp, JSONL). */
    CONVERSACION: String(g("CONVERSACION", path.join(dir, "conversacion.jsonl"))),
    /** Config + registro de la subida automatica a Dropi (JSON). */
    SUBIDA_AUTO: String(g("SUBIDA_AUTO", path.join(dir, "subidaAutomatica.json"))),
    /** Token y acciones para notificar resultados de Dropi a Lucid Bot. */
    LUCIDBOT_CONTACTOS_CONFIG: String(g("LUCIDBOT_CONTACTOS_CONFIG", path.join(dir, "config", "lucidbot-contactos.json"))),
    /**
     * LLM para leer el chat del pedido (SOLO extraccion de datos; la decision
     * la toma el codigo en agente.js). Habla con la API compatible con OpenAI.
     */
    LLM_API_KEY: String(g("LLM_API_KEY", "")),
    LLM_BASE: String(g("LLM_BASE", "https://api.openai.com/v1")).replace(/\/+$/, ""),
    LLM_MODELO: String(g("LLM_MODELO", "gpt-5-mini")),
    // los modelos de razonamiento (gpt-5*) tardan: 90 s de margen
    LLM_TIMEOUT_MS: Number(g("LLM_TIMEOUT_MS", "90000")) || 90000,
    /** API key / proveedor / modelo guardados desde el panel (JSON, 600). */
    LLM_CONFIG: String(g("LLM_CONFIG", path.join(dir, "config", "llm.json"))),
    /** Validador de direcciones: API key de Google Maps (Geocoding). */
    GOOGLE_MAPS_KEY: String(g("GOOGLE_MAPS_KEY", "")),
    MAPAS_CONFIG: String(g("MAPAS_CONFIG", path.join(dir, "config", "mapas.json"))),
    /**
     * Dropi: subida de pedidos con seguro antidevoluciones (campo `insurance`).
     * DROPI_TOKEN es el token de sesion del panel de Dropi (x-authorization).
     */
    DROPI_BASE: String(g("DROPI_BASE", "https://api.dropi.co/api")).replace(/\/+$/, ""),
    DROPI_TOKEN: String(g("DROPI_TOKEN", "")),
    /** Cabecera x-captcha-token. Vacia cuando Dropi no exige captcha. */
    DROPI_CAPTCHA_TOKEN: String(g("DROPI_CAPTCHA_TOKEN", "")),
    DROPI_TIMEOUT_MS: Number(g("DROPI_TIMEOUT_MS", "20000")) || 20000,
    /** Defaults de la cuenta Dropi para crear pedidos. */
    DROPI_USER_ID: Number(g("DROPI_USER_ID", "0")) || 0,
    DROPI_SUPPLIER_ID: Number(g("DROPI_SUPPLIER_ID", "0")) || 0,
    DROPI_SHOP_ID: String(g("DROPI_SHOP_ID", "")),
    DROPI_WAREHOUSE_ID: String(g("DROPI_WAREHOUSE_ID", "")),
    /** El seguro antidevoluciones va siempre activado (1) o nunca (0). */
    DROPI_SEGURO: ["1", "true", "si", "sí", "on"].includes(
      String(g("DROPI_SEGURO", "1")).toLowerCase(),
    ),
    /**
     * Automatizacion por navegador (la API de Dropi no acepta clientes externos).
     * DROPI_PERFIL = carpeta del perfil de Chrome donde vives la sesion de Dropi.
     */
    DROPI_PERFIL: String(g("DROPI_PERFIL", path.join(dir, ".dropi-perfil"))),
    DROPI_CHROME: String(
      g(
        "DROPI_CHROME",
        process.platform === "win32"
          ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
          : "/usr/bin/chromium",
      ),
    ),
    DROPI_HEADLESS: ["1", "true", "si", "on"].includes(String(g("DROPI_HEADLESS", "0")).toLowerCase()),
    DROPI_NAVEGADOR_MS: Number(g("DROPI_NAVEGADOR_MS", "30000")) || 30000,
    /**
     * Google Sheets (publicado como CSV) con el mapa producto -> link de Dropi.
     * Columnas: par, Nombre, idProductoDropi, nameProductoDropi, dropiLink, transportadora.
     * La subida automatica navega directo al `dropiLink` de cada producto.
     */
    DROPI_PRODUCTOS_CSV: String(g("DROPI_PRODUCTOS_CSV", "")),
    /** Link del sheet guardado desde el panel (manda sobre DROPI_PRODUCTOS_CSV). */
    DROPI_PRODUCTOS_CONFIG: String(g("DROPI_PRODUCTOS_CONFIG", path.join(dir, "config", "productosDropi.json"))),
    /** Horarios de usuarios y asignacion de pedidos (JSON). */
    ASIGNACION: String(g("ASIGNACION", path.join(dir, "asignacion.json"))),
    /** Credenciales que guarda el panel para el backend (JSON, 600). */
    CREDENCIALES: String(g("CREDENCIALES", path.join(dir, "credenciales.json"))),
    /** Rentabilidad de anuncios de Meta: donde quedan los datos y los ajustes. */
    ANUNCIOS_DIR: String(g("ANUNCIOS_DIR", path.join(dir, "anuncios"))),
    ANUNCIOS_CONFIG: String(g("ANUNCIOS_CONFIG", path.join(dir, "config", "anuncios.json"))),
    /** Zona horaria con la que se evaluan los horarios de los usuarios. */
    TZ_ASIGNACION: String(g("TZ_ASIGNACION", "America/Bogota")),
    /** Reparto automatico: semilla inicial (luego manda el panel/JSON). */
    REPARTO_AUTOMATICO:
      ["1", "true", "si", "sí", "on"].includes(String(g("REPARTO_AUTOMATICO", "")).toLowerCase()),
    /** Cada cuantos segundos mira pedidos nuevos (10..3600). */
    REPARTO_CADA: Math.max(10, Math.min(Number(g("REPARTO_CADA", "60")) || 60, 3600)),
    /** Timeout de cada llamada a LucidSales. */
    TIMEOUT_MS: Number(g("TIMEOUT_MS", "15000")) || 15000,
    /**
     * Timeout de las consultas LENTAS a Inter Rapidisisimo (listado y
     * horarios: 13-25 s medidos). Van en segundo plano, por eso es largo.
     */
    TIMEOUT_INTER_LENTO_MS: Number(g("TIMEOUT_INTER_LENTO_MS", "45000")) || 45000,
  };
}

/** Faltantes que impiden cambiar estados (no impiden arrancar). */
export function faltantesDeConfig(config) {
  const faltan = [];
  if (!config.LUCID_EMAIL || !config.LUCID_PASSWORD) {
    faltan.push("LUCID_EMAIL / LUCID_PASSWORD (credenciales de LucidSales)");
  }
  return faltan;
}
