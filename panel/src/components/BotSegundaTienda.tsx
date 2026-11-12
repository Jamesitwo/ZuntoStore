// Segunda tienda en otro Lucid Bot: Zunto copia desde el bot de Zunto (que
// llena LucidSales) los campos de cada producto de la nueva tienda, y escribe
// los campos de la tienda que se definan aqui.
import { useEffect, useMemo, useState } from "react";
import { backend, backendSuave } from "../api/backend";
import { errMsg } from "../api/client";
import { useToast } from "./Toast";
import { CamposTienda } from "./CamposTiendaBot";

interface Vuelta {
  desde: string;
  motivo: string;
  ok?: boolean;
  escritosNueva: string[];
  escritosZunto: string[];
  sinCambios: number;
  errores: string[];
}
interface Estado {
  activo: boolean;
  nombre: string;
  cadaMin: number;
  filtrarZunto: boolean;
  productosNueva: string[];
  idsZunto: Record<string, string>;
  idsNueva: Record<string, string>;
  camposTienda: Record<string, string>;
  tokenConfigurado: boolean;
  tokenVista: string;
  tokenZuntoConfigurado: boolean;
  camposZunto: number;
  camposNueva: number;
  productos: string[];
  camposPorProducto: string[];
  historial: Vuelta[];
  sincronizando: boolean;
}

const clave = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const fecha = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** De la exportacion solo salen id y nombre: los valores (con secretos) no se envian. */
function soloIds(texto: string): { campos: Array<{ id: string; name: string }> } {
  const j = JSON.parse(texto);
  const lista = Array.isArray(j) ? j : Array.isArray(j?.campos) ? j.campos : Array.isArray(j?.data) ? j.data : null;
  if (!lista) throw new Error("No encontré la lista de campos en el JSON");
  const campos = lista
    .map((c: any) => ({ id: String(c?.id ?? "").trim(), name: String(c?.name ?? c?.nombre ?? "").trim() }))
    .filter((c: { id: string; name: string }) => /^\d+$/.test(c.id) && c.name);
  if (!campos.length) throw new Error("El JSON no trae campos con id y nombre");
  return { campos };
}

function Exportacion({ titulo, n, onListo }: { titulo: string; n: number; onListo: (v: ReturnType<typeof soloIds>) => void }) {
  const toast = useToast();
  const leer = async (f?: File | null) => {
    if (!f) return;
    try {
      onListo(soloIds(await f.text()));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="field">
      <label>{titulo}</label>
      <input type="file" accept=".json,application/json" onChange={(e) => void leer(e.target.files?.[0])} />
      <span className="campo-ayuda">{n ? `✅ ${n} campos cargados.` : "Sube la exportación de campos del bot (JSON). Solo se toman el ID y el nombre de cada campo; los valores no salen de tu equipo."}</span>
    </div>
  );
}

export function BotSegundaTienda() {
  const toast = useToast();
  const [e, setE] = useState<Estado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [token, setToken] = useState("");
  const [nombre, setNombre] = useState("");
  const [campos, setCampos] = useState<Record<string, string>>({});

  const aplicar = (x: any) => {
    if (!x?.ok) return;
    setE(x);
    setNombre(x.nombre ?? "");
    setCampos(x.camposTienda ?? {});
  };
  useEffect(() => {
    void backendSuave<any>("/api/bots-tienda").then(aplicar);
  }, []);

  const guardar = async (cambio: Record<string, unknown>, aviso = "Guardado") => {
    setOcupado(true);
    try {
      aplicar(await backend<any>("/api/bots-tienda", { method: "PUT", body: cambio }));
      toast.success(aviso);
      return true;
    } catch (err) {
      toast.error(errMsg(err));
      return false;
    } finally {
      setOcupado(false);
    }
  };
  const accion = async (ruta: "leer" | "sincronizar") => {
    setOcupado(true);
    try {
      const x = await backend<any>(`/api/bots-tienda/${ruta}`, { method: "POST" });
      aplicar(x);
      const r = x?.resultado;
      if (r?.ok === false && r?.detalle) toast.error(r.detalle);
      else if (r?.errores?.length) toast.error(`${r.errores.length} error(es): ${r.errores[0]}`);
      else toast.success(ruta === "leer" ? "Productos traídos del bot de Zunto" : "Sincronizado");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setOcupado(false);
    }
  };

  const copiarZunto = async () => {
    setOcupado(true);
    try {
      const r = await backend<any>("/api/bots-tienda/copiar-zunto", { method: "POST" });
      const valores: Record<string, string> = r?.valores ?? {};
      let n = 0;
      setCampos((c) => {
        const sig = { ...c };
        for (const [k, v] of Object.entries(valores)) {
          if (!String(sig[k] ?? "").trim() && String(v ?? "").trim()) {
            sig[k] = String(v);
            n++;
          }
        }
        return sig;
      });
      setTimeout(() => toast.success(`Se llenaron los campos vacíos con lo del bot de Zunto (${Object.keys(valores).length} leídos). Cambia lo que sea distinto y guarda.`), 0);
      if (r?.errores?.length) toast.error(`${r.errores.length} campo(s) no se pudieron leer: ${r.errores[0]}`);
      void n;
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setOcupado(false);
    }
  };

  // guarda los campos y los escribe ya en el bot nuevo (no espera la sincronizacion)
  const guardarYEscribir = async () => {
    setOcupado(true);
    try {
      aplicar(await backend<any>("/api/bots-tienda", { method: "PUT", body: { camposTienda: campos } }));
      if (!e?.tokenConfigurado) {
        toast.success("Guardado. Falta el X-ACCESS-TOKEN del bot nuevo para escribirlo allá.");
        return;
      }
      const x = await backend<any>("/api/bots-tienda/sincronizar?solo=tienda", { method: "POST" });
      aplicar(x);
      const r = x?.resultado;
      if (r?.ok === false && r?.detalle) toast.error(`Guardado en Zunto, pero no se escribió en el bot: ${r.detalle}`);
      else if (r?.errores?.length) toast.error(`Se escribieron ${r.escritosNueva?.length ?? 0} campo(s); ${r.errores.length} con error: ${r.errores[0]}`);
      else toast.success(`Listo: ${r?.escritosNueva?.length ?? 0} campo(s) escritos en el bot de ${e?.nombre || "la nueva tienda"}`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setOcupado(false);
    }
  };

  const deNueva = useMemo(() => new Set((e?.productosNueva ?? []).map(clave)), [e?.productosNueva]);
  // campos de la tienda: los del bot nuevo que no son por producto
  const camposTienda = useMemo(() => {
    const porProducto = new Set(e?.camposPorProducto ?? []);
    return Object.keys(e?.idsNueva ?? {})
      .filter((n) => !porProducto.has(n))
      .sort((a, b) => a.localeCompare(b, "es"));
  }, [e?.idsNueva, e?.camposPorProducto]);

  if (!e) return null;
  // mover un producto: se guarda y se sincronizan los dos bots de una vez
  const alternar = async (p: string) => {
    const k = clave(p);
    const vuelve = deNueva.has(k);
    const lista = vuelve ? e.productosNueva.filter((x) => clave(x) !== k) : [...e.productosNueva, p];
    const destino = vuelve ? "Zunto" : e.nombre || "la nueva tienda";
    setOcupado(true);
    try {
      aplicar(await backend<any>("/api/bots-tienda", { method: "PUT", body: { productosNueva: lista } }));
      if (!e.tokenConfigurado || !e.camposZunto || !e.camposNueva) {
        toast.success(`«${p}» quedó en ${destino}. Falta el token o las exportaciones para pasarlo a los bots.`);
        return;
      }
      const x = await backend<any>("/api/bots-tienda/sincronizar", { method: "POST" });
      aplicar(x);
      const r = x?.resultado;
      if (r?.ok === false && r?.detalle) toast.error(`«${p}» quedó en ${destino}, pero no se pudo sincronizar: ${r.detalle}`);
      else if (r?.errores?.length) toast.error(`«${p}» pasó a ${destino} con ${r.errores.length} error(es): ${r.errores[0]}`);
      else toast.success(`«${p}» pasó a ${destino}: ${r?.escritosNueva?.length ?? 0} campo(s) en ${e.nombre || "la nueva tienda"}, ${r?.escritosZunto?.length ?? 0} en Zunto`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setOcupado(false);
    }
  };
  const nNueva = e.productos.filter((p) => deNueva.has(clave(p))).length;

  return (
    <section className="card">
      <div className="card-title">Segunda tienda en otro Lucid Bot</div>
      <p className="muted small" style={{ marginTop: 0 }}>
        LucidSales solo se conecta al bot de Zunto. Zunto copia al bot de la nueva tienda los datos de sus productos (catálogo,
        multimedia, mensajes iniciales, anuncios, integración y posventa) y escribe los campos de la tienda que pongas aquí.
        {e.filtrarZunto ? " El bot de Zunto queda solo con los productos de Zunto." : ""}
      </p>
      {!e.tokenZuntoConfigurado ? <p className="banner warn small">Falta el X-ACCESS-TOKEN del bot de Zunto (sección Lucid Bot).</p> : null}

      <label className="switch" htmlFor="bt-activo">
        <input id="bt-activo" type="checkbox" checked={e.activo} disabled={ocupado} onChange={(x) => void guardar({ activo: x.target.checked })} />
        <span className="switch-pista" aria-hidden="true" />
        <span className="switch-texto">{e.activo ? `Activa: se sincroniza cada ${e.cadaMin} min` : "Apagada"}</span>
      </label>

      <div className="grid-2 bt-grid" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="bt-nombre">Nombre de la nueva tienda</label>
          <input id="bt-nombre" value={nombre} placeholder="Ej.: Pizdo" onChange={(x) => setNombre(x.target.value)} onBlur={() => nombre !== e.nombre && void guardar({ nombre })} />
        </div>
        <div className="field">
          <label htmlFor="bt-token">X-ACCESS-TOKEN del bot nuevo</label>
          <div className="row" style={{ gap: 6 }}>
            <input
              id="bt-token"
              type="password"
              autoComplete="off"
              value={token}
              placeholder={e.tokenConfigurado ? `Guardado (${e.tokenVista})` : "Pega el token"}
              onChange={(x) => setToken(x.target.value)}
            />
            <button type="button" className="btn sm" disabled={ocupado || !token.trim()} onClick={() => void guardar({ token }, "Token guardado").then((ok) => ok && setToken(""))}>
              Guardar
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="bt-cada">Sincronizar cada</label>
          <select id="bt-cada" value={e.cadaMin} disabled={ocupado} onChange={(x) => void guardar({ cadaMin: Number(x.target.value) })}>
            {[5, 15, 30, 60, 180].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${m / 60} h`}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <label className="switch" htmlFor="bt-filtrar">
            <input id="bt-filtrar" type="checkbox" checked={e.filtrarZunto} disabled={ocupado} onChange={(x) => void guardar({ filtrarZunto: x.target.checked })} />
            <span className="switch-pista" aria-hidden="true" />
            <span className="switch-texto small">Quitar del bot de Zunto los productos de la nueva tienda</span>
          </label>
        </div>
      </div>

      <div className="grid-2 bt-grid">
        <Exportacion titulo="Campos del bot de Zunto" n={e.camposZunto} onListo={(v) => void guardar({ exportZunto: v }, "Campos del bot de Zunto cargados")} />
        <Exportacion titulo="Campos del bot nuevo" n={e.camposNueva} onListo={(v) => void guardar({ exportNueva: v }, "Campos del bot nuevo cargados")} />
      </div>

      <div className="card-subtitle" style={{ marginTop: 16 }}>
        Productos ({nNueva} de {e.productos.length} en {e.nombre || "la nueva tienda"})
      </div>
      {e.productos.length ? (
        <ul className="bt-productos">
          {e.productos.map((p) => {
            const nueva = deNueva.has(clave(p));
            return (
              <li key={p}>
                <span>{p}</span>
                <div className="bt-tienda" role="group" aria-label={`Tienda de ${p}`}>
                  <button type="button" className={`btn sm${!nueva ? " primary" : ""}`} disabled={ocupado || !nueva} onClick={() => void alternar(p)}>
                    Zunto
                  </button>
                  <button type="button" className={`btn sm${nueva ? " primary" : ""}`} disabled={ocupado || nueva} onClick={() => void alternar(p)}>
                    {e.nombre || "Nueva"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">Carga los campos del bot de Zunto y trae los productos.</p>
      )}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn sm" disabled={ocupado || !e.camposZunto} onClick={() => void accion("leer")}>
          Traer productos de LucidSales
        </button>
      </div>

      <CamposTienda
        disponibles={camposTienda}
        campos={campos}
        setCampos={setCampos}
        ocupado={ocupado}
        nombreTienda={e.nombre}
        onCopiar={copiarZunto}
        onGuardar={() => void guardarYEscribir()}
      />

      <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn primary sm" disabled={ocupado || !e.tokenConfigurado || !e.camposZunto || !e.camposNueva} onClick={() => void accion("sincronizar")}>
          {ocupado ? "Sincronizando…" : "Sincronizar ahora"}
        </button>
      </div>

      {e.historial.length ? (
        <ul className="small catalogo-corridas">
          {e.historial.slice(0, 5).map((h) => (
            <li key={h.desde}>
              <strong>{fecha.format(new Date(h.desde))}</strong> {h.ok ? "✅" : "⚠️"} {h.motivo} · nueva tienda: {h.escritosNueva.length} campo(s)
              {h.escritosZunto.length ? ` · Zunto filtrado: ${h.escritosZunto.length}` : ""}
              {h.errores.length ? <span style={{ color: "#b91c1c" }}> · {h.errores[0]}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
