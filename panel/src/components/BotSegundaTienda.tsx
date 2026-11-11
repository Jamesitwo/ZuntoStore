// Segunda tienda en otro Lucid Bot: Zunto copia desde el bot de Zunto (que
// llena LucidSales) los campos de cada producto de la nueva tienda, y escribe
// los campos de la tienda que se definan aqui.
import { useEffect, useMemo, useState } from "react";
import { backend, backendSuave } from "../api/backend";
import { errMsg } from "../api/client";
import { useToast } from "./Toast";

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
  const [filtro, setFiltro] = useState("");

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

  const deNueva = useMemo(() => new Set((e?.productosNueva ?? []).map(clave)), [e?.productosNueva]);
  // campos de la tienda: los del bot nuevo que no son por producto
  const camposTienda = useMemo(() => {
    const porProducto = new Set(e?.camposPorProducto ?? []);
    return Object.keys(e?.idsNueva ?? {})
      .filter((n) => !porProducto.has(n))
      .sort((a, b) => a.localeCompare(b, "es"));
  }, [e?.idsNueva, e?.camposPorProducto]);

  if (!e) return null;
  const alternar = (p: string) => {
    const k = clave(p);
    const lista = deNueva.has(k) ? e.productosNueva.filter((x) => clave(x) !== k) : [...e.productosNueva, p];
    void guardar({ productosNueva: lista }, deNueva.has(k) ? `«${p}» vuelve a Zunto` : `«${p}» pasa a ${e.nombre || "la nueva tienda"}`);
  };
  const visibles = camposTienda.filter((n) => !filtro || clave(n).includes(clave(filtro)));
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

      <div className="grid-2" style={{ marginTop: 12 }}>
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

      <div className="grid-2">
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
                  <button type="button" className={`btn sm${!nueva ? " primary" : ""}`} disabled={ocupado || !nueva} onClick={() => alternar(p)}>
                    Zunto
                  </button>
                  <button type="button" className={`btn sm${nueva ? " primary" : ""}`} disabled={ocupado || nueva} onClick={() => alternar(p)}>
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

      {camposTienda.length ? (
        <details style={{ marginTop: 16 }}>
          <summary className="card-subtitle">
            Campos de la tienda en el bot nuevo ({Object.keys(e.camposTienda).length} con valor)
          </summary>
          <p className="muted small">Los que dejes vacíos no se tocan en el bot nuevo. Se escriben en cada sincronización si cambiaron.</p>
          <input type="search" placeholder="Buscar campo…" value={filtro} onChange={(x) => setFiltro(x.target.value)} style={{ marginBottom: 8 }} />
          {visibles.map((n) => (
            <div className="field" key={n}>
              <label htmlFor={`bt-c-${n}`}>{n}</label>
              <textarea id={`bt-c-${n}`} rows={(campos[n] ?? "").length > 120 ? 5 : 2} value={campos[n] ?? ""} onChange={(x) => setCampos((c) => ({ ...c, [n]: x.target.value }))} />
            </div>
          ))}
          <button type="button" className="btn primary sm" disabled={ocupado} onClick={() => void guardar({ camposTienda: campos }, "Campos de la tienda guardados")}>
            Guardar campos de la tienda
          </button>
        </details>
      ) : null}

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
