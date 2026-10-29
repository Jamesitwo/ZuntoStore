// TopView por el conector MCP: OAuth (descubrimiento, registro, PKCE, token)
// y llamadas a herramientas por JSON-RPC (respuestas JSON y SSE).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearCreadorCampanas } from "../creadorCampanas.js";

function servidorFalso() {
  const llamadas = [];
  let reto = null;
  let refrescos = 0;
  const resp = (status, body, headers = {}) => ({
    ok: status < 400,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
  });
  const fetcher = async (url, op = {}) => {
    const u = new URL(String(url));
    const auth = op.headers?.authorization ?? "";
    llamadas.push({ url: u.toString(), metodo: op.method ?? "GET", auth, body: op.body });
    if (u.href === "https://mcp.topview.ai/mcp") {
      if (!auth) return resp(401, { error: "unauthorized" }, { "www-authenticate": 'Bearer resource_metadata="https://mcp.topview.ai/.well-known/oauth-protected-resource/mcp"' });
      if (auth !== "Bearer AT2" && auth !== "Bearer AT1") return resp(401, {});
      const m = JSON.parse(op.body);
      if (m.method === "initialize") return resp(200, { jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }, { "mcp-session-id": "S1", "content-type": "application/json" });
      if (m.method === "notifications/initialized") return resp(202, "");
      assert.equal(op.headers["mcp-session-id"], "S1");
      const { name, arguments: a } = m.params;
      let r;
      if (name === "topview_get_credit") r = { code: "200", result: { remainCredit: 74.86 } };
      else if (name === "ta_upload_credential") r = { fileId: "F1", uploadUrl: "https://s3.test/put" };
      else if (name === "ta_upload_check_file") r = { code: "200", result: true };
      else if (name === "topview_generate_image") {
        assert.equal(a.req.taskType, "image_edit");
        assert.deepEqual(a.req.inputImageFileIds, ["F1"]);
        r = { code: "200", result: { taskId: "TI" } };
      } else if (name === "topview_generate_video") {
        assert.equal(a.req.model, "Seedance 2.5");
        r = { code: "200", result: { taskId: "TV" } };
      } else if (name === "topview_query_task") {
        r = a.req.taskType === "omni_reference"
          ? { code: "200", result: { status: "success", videos: [{ status: "success", filePath: "https://cdn.test/v.mp4", coverPath: "https://cdn.test/c.jpg" }] } }
          : { code: "200", result: { status: "success", images: [{ status: "success", filePath: "https://cdn.test/i.jpg" }] } };
      }
      // respuesta en SSE, como suelen contestar los servidores MCP
      const sse = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: JSON.stringify(r) }] } })}\n\n`;
      return resp(200, sse, { "content-type": "text/event-stream" });
    }
    if (u.href === "https://mcp.topview.ai/.well-known/oauth-protected-resource/mcp") {
      return resp(200, { resource: "https://mcp.topview.ai/mcp", authorization_servers: ["https://auth.topview.test"], scopes_supported: ["mcp"] });
    }
    if (u.href === "https://auth.topview.test/.well-known/oauth-authorization-server") {
      return resp(200, { authorization_endpoint: "https://auth.topview.test/authorize", token_endpoint: "https://auth.topview.test/token", registration_endpoint: "https://auth.topview.test/register", code_challenge_methods_supported: ["S256"] });
    }
    if (u.href === "https://auth.topview.test/register") {
      const b = JSON.parse(op.body);
      assert.equal(b.token_endpoint_auth_method, "none");
      return resp(201, { client_id: "CLIENTE1" });
    }
    if (u.href === "https://auth.topview.test/token") {
      const b = Object.fromEntries(op.body);
      if (b.grant_type === "authorization_code") {
        assert.equal(b.code, "CODIGO");
        assert.equal(b.client_id, "CLIENTE1");
        // PKCE: el verificador corresponde al reto que se mando
        const calc = crypto.createHash("sha256").update(b.code_verifier).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        assert.equal(calc, reto);
        return resp(200, { access_token: "AT1", refresh_token: "RT1", expires_in: 1 });
      }
      if (b.grant_type === "refresh_token") {
        refrescos++;
        return resp(200, { access_token: "AT2", expires_in: 3600 });
      }
    }
    if (u.href.startsWith("https://s3.test/") || u.href.startsWith("https://fotos.test/")) return resp(200, {});
    return resp(404, { error: "no esperado " + u.href });
  };
  return { fetcher, llamadas, fijarReto: (r) => (reto = r), refrescos: () => refrescos };
}

test("conectar TopView con la cuenta (OAuth) y generar por el conector MCP", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tvmcp-"));
  const f = servidorFalso();
  const creador = crearCreadorCampanas({ baseDir: dir, credencialMeta: () => null, fetcher: f.fetcher, log: { warn() {} } });
  const c = creador.para("ana@zunto.co", {});

  const { url } = await c.conectarTopView("https://zunto.store/api/creador/topview/callback");
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://auth.topview.test/authorize");
  assert.equal(u.searchParams.get("client_id"), "CLIENTE1");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("redirect_uri"), "https://zunto.store/api/creador/topview/callback");
  assert.equal(u.searchParams.get("resource"), "https://mcp.topview.ai/mcp");
  f.fijarReto(u.searchParams.get("code_challenge"));

  // estado falso o repetido: no sirve
  await assert.rejects(creador.completarTopView("otro", "CODIGO"), /venció/);
  const r = await creador.completarTopView(u.searchParams.get("state"), "CODIGO");
  assert.equal(r.creditos, 74.86, "prueba con los creditos del plan");
  await assert.rejects(creador.completarTopView(u.searchParams.get("state"), "CODIGO"), /venció/, "un solo uso");
  assert.ok(f.refrescos() >= 1, "el token de 1 s se renueva solo");

  const aj = c.ajustes();
  assert.equal(aj.topview.modo, "cuenta");
  assert.equal(aj.topview.configurada, true);
  assert.ok(!JSON.stringify(aj).includes("AT1") && !JSON.stringify(aj).includes("RT1"), "los tokens no salen al panel");

  // generar y consultar por el conector
  const p = c.crear({ producto: { nombre: "Taladro", precio: 199900 }, fotos: ["https://fotos.test/1.jpg"], imagenes: 1, videos: 1 });
  // los prompts los escribiria la IA: aqui se ponen a mano en el archivo
  const slugDir = fs.readdirSync(path.join(dir, "creador")).find((x) => x !== "oauth-clientes.json");
  const archivo = path.join(dir, "creador", slugDir, "proyectos", `${p.id}.json`);
  const conPrompts = JSON.parse(fs.readFileSync(archivo, "utf8"));
  conPrompts.creativos = [
    { id: "img1", tipo: "imagen", angulo: "a", prompt: "foto Image1", copy: { texto: "", titulo: "", descripcion: "" }, incluir: true, estado: "borrador" },
    { id: "vid1", tipo: "video", angulo: "b", prompt: "video <<<Image1>>>", copy: { texto: "", titulo: "", descripcion: "" }, incluir: true, estado: "borrador" },
  ];
  fs.writeFileSync(archivo, JSON.stringify(conPrompts));
  const gen = await c.generar(p.id);
  assert.deepEqual(gen.creativos.map((x) => x.estado), ["generando", "generando"]);
  assert.deepEqual(gen.creativos.map((x) => x.tarea.tipo), ["image_edit", "omni_reference"]);
  await creador.revisarTareas();
  const fin = c.get(p.id);
  assert.deepEqual(fin.creativos.map((x) => x.resultado?.url), ["https://cdn.test/i.jpg", "https://cdn.test/v.mp4"]);
  assert.ok(f.llamadas.filter((l) => l.url === "https://mcp.topview.ai/mcp" && l.auth).every((l) => l.auth === "Bearer AT2"));

  c.guardarAjustes({ desconectarTopview: true });
  assert.equal(c.ajustes().topview.configurada, false);
  creador.detener();
  fs.rmSync(dir, { recursive: true, force: true });
});
