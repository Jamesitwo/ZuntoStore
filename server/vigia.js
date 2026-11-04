// Vigilante del servidor: si el hilo principal de Node se queda bloqueado
// (un ciclo que no termina), no responde a nadie y Railway da 502 sin que
// haya error en los logs. Un hilo aparte mira un latido que el principal
// marca cada segundo; si deja de latir VIGIA_SEG segundos, escribe en el log
// que estaba haciendo y termina el proceso para que Railway lo reinicie.
//
//   iniciarVigia({ segundos })   -> en index.js, al arrancar
//   actividad("subida: pedido 123") -> marca lo que se esta haciendo
import { Worker } from "node:worker_threads";

const TAM_TEXTO = 400;
let latido = null; // Int32Array [latido, largoTexto]
let texto = null; // Uint8Array con la actividad actual
const cod = new TextEncoder();

/** Lo que el servidor esta haciendo ahora (queda en el log si se bloquea). */
export function actividad(t) {
  if (!latido) return;
  const b = cod.encode(`${new Date().toISOString()} ${String(t ?? "")}`.slice(0, TAM_TEXTO));
  texto.fill(0);
  texto.set(b.subarray(0, TAM_TEXTO));
  Atomics.store(latido, 1, Math.min(b.length, TAM_TEXTO));
}

const CODIGO_HILO = `
const { workerData } = process.getBuiltinModule("node:worker_threads");
const fs = process.getBuiltinModule("node:fs");
const { latido, texto, segundos } = workerData;
const dec = new TextDecoder();
let ultimo = Atomics.load(latido, 0);
let quieto = 0;
setInterval(() => {
  const ahora = Atomics.load(latido, 0);
  if (ahora !== ultimo) { ultimo = ahora; quieto = 0; return; }
  quieto += 5;
  if (quieto < segundos) return;
  const n = Atomics.load(latido, 1);
  const que = dec.decode(new Uint8Array(texto.slice(0, n)));
  try {
    fs.writeSync(2, "[vigia] el servidor lleva " + quieto + " s bloqueado (sin responder). Ultima actividad: " + (que || "desconocida") + ". Se reinicia.\\n");
  } catch {}
  process.kill(process.pid, "SIGKILL");
}, 5000);
`;

/** Arranca el vigilante (una vez). segundos <= 0 lo apaga. */
export function iniciarVigia({ segundos = 120, log = console } = {}) {
  if (latido || !(segundos > 0)) return null;
  const sab = new SharedArrayBuffer(8);
  const sabTexto = new SharedArrayBuffer(TAM_TEXTO);
  latido = new Int32Array(sab);
  texto = new Uint8Array(sabTexto);
  const t = setInterval(() => Atomics.add(latido, 0, 1), 1000);
  t.unref?.();
  const w = new Worker(CODIGO_HILO, {
    eval: true,
    execArgv: [],
    workerData: { latido, texto: new Uint8Array(sabTexto), segundos },
  });
  w.unref();
  w.on("error", (e) => log.warn?.("[vigia] no se pudo vigilar:", e?.message ?? e));
  actividad("arranque");
  return { segundos };
}

