import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("el vigilante deja en el log que hacia y termina un servidor bloqueado", () => {
  const codigo = `
    import { iniciarVigia, actividad } from ${JSON.stringify(new URL("../vigia.js", import.meta.url).href)};
    iniciarVigia({ segundos: 5 });
    setTimeout(() => { actividad("subida: pedido 123"); for (;;) {} }, 1500);
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", codigo], { encoding: "utf8", timeout: 40000 });
  assert.equal(r.signal, "SIGKILL", "el proceso bloqueado se termina");
  assert.match(r.stderr, /\[vigia\].*bloqueado.*subida: pedido 123/);
});

test("el vigilante no toca un proceso sano", () => {
  const codigo = `
    import { iniciarVigia } from ${JSON.stringify(new URL("../vigia.js", import.meta.url).href)};
    iniciarVigia({ segundos: 5 });
    const t = setInterval(() => {}, 200);
    setTimeout(() => { clearInterval(t); console.log("vivo"); }, 12000);
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", codigo], { encoding: "utf8", timeout: 40000 });
  assert.equal(r.signal, null);
  assert.match(r.stdout, /vivo/);
});
