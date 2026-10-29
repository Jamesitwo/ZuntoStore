// Creador de campañas IA: del producto a la campaña de Meta a WhatsApp.
//
//   /creador        proyectos, nuevo proyecto y ajustes (TopView, Meta)
//   /creador/:id    plan de la IA, creativos de TopView y campaña (pausada)
//
// Todo pasa en el servidor (server/creadorCampanas.js); aquí se edita lo que
// propone la IA, se aprueban los creativos y se confirma cada paso que cuesta
// dinero (créditos de TopView, activar la campaña).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { creador, CREATIVIDADES, pesos, type Creatividad, type AjustesCreador, type Creativo, type Proyecto, type ResumenProyecto } from "../api/creador";
import { productos } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { Combo, type OpcionCombo } from "../components/Combo";
import { Modal } from "../components/Modal";
import { SubirMedia } from "../components/SubirMedia";
import { useToast } from "../components/Toast";
import { Campo, ErrorBanner, PageHeader, Spinner } from "../components/ui";
import { prodId, prodImg, prodImgs, prodName, prodPrice, useCatalogo } from "../lib/catalogo";

const arreglo = (v: unknown): any[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
};
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const fecha = (iso?: string) => (iso ? new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "");

const ESTADO_PROYECTO: Record<string, string> = {
  nuevo: "Nuevo",
  plan: "Plan listo",
  creativos: "Creativos",
  campana: "Campaña",
};
const ESTADO_CAMPANA: Record<string, string> = {
  creando: "Creando en Meta…",
  creada: "Pausada en Meta",
  activa: "Activa",
  error: "Con error",
};

/** Copia al portapapeles con aviso. */
function useCopiar() {
  const toast = useToast();
  return (t: string) => {
    void navigator.clipboard?.writeText(t).then(
      () => toast.success("Copiado"),
      () => toast.error("No se pudo copiar"),
    );
  };
}

export function CreadorPage() {
  const { id } = useParams();
  return id ? <DetalleProyecto id={id} /> : <InicioCreador />;
}

// =================================================================== inicio

function InicioCreador() {
  const [pestana, setPestana] = useState<"proyectos" | "nuevo" | "ajustes">("proyectos");
  const [ajustes, setAjustes] = useState<AjustesCreador | null>(null);
  const [lista, setLista] = useState<ResumenProyecto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [a, l] = await Promise.all([creador.ajustes(), creador.lista()]);
      setAjustes(a);
      setLista(l.proyectos);
      if (!a.topview.configurada) setPestana((p) => (p === "proyectos" && !l.proyectos.length ? "ajustes" : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const listo = ajustes?.topview.configurada && ajustes?.meta.conectada;

  return (
    <div className="creador-page">
      <PageHeader
        title="Creador IA"
        subtitle="Del producto a la campaña de Meta a WhatsApp: la IA escribe, TopView genera los creativos y la campaña queda pausada para que la revises."
      />
      <ErrorBanner error={error} />
      {ajustes && !listo ? (
        <div className="banner warn">
          {!ajustes.meta.conectada ? (
            <>
              Conecta tu cuenta de Meta en <Link to="/anuncios">Anuncios</Link> (el token necesita el permiso{" "}
              <code>ads_management</code> para crear campañas).{" "}
            </>
          ) : null}
          {!ajustes.topview.configurada ? (
            <>
              Falta la API key de TopView:{" "}
              <button type="button" className="btn-link" onClick={() => setPestana("ajustes")}>
                configúrala en Ajustes
              </button>
              .
            </>
          ) : null}
        </div>
      ) : null}

      <div className="tabs" role="tablist" aria-label="Secciones del creador">
        {(
          [
            ["proyectos", `Proyectos${lista?.length ? ` (${lista.length})` : ""}`],
            ["nuevo", "+ Nuevo producto"],
            ["ajustes", "Ajustes"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={pestana === k}
            className={`tab${pestana === k ? " active" : ""}`}
            onClick={() => setPestana(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {pestana === "proyectos" ? (
        <ListaProyectos lista={lista} onNuevo={() => setPestana("nuevo")} />
      ) : pestana === "nuevo" ? (
        ajustes ? <NuevoProyecto ajustes={ajustes} /> : <Spinner />
      ) : ajustes ? (
        <AjustesPanel ajustes={ajustes} onCambio={setAjustes} />
      ) : (
        <Spinner />
      )}
    </div>
  );
}

function ListaProyectos({ lista, onNuevo }: { lista: ResumenProyecto[] | null; onNuevo: () => void }) {
  if (!lista) return <Spinner />;
  if (!lista.length) {
    return (
      <div className="card creador-vacio">
        <h3>Aún no hay campañas creadas con IA</h3>
        <p className="muted">
          Elige un producto, sus fotos reales y el presupuesto. La IA propone 4 imágenes y 3 videos con su copy, tú los
          revisas y Zunto arma la campaña en Meta.
        </p>
        <button type="button" className="btn primary" onClick={onNuevo}>
          Crear la primera
        </button>
      </div>
    );
  }
  return (
    <div className="creador-lista">
      {lista.map((p) => (
        <Link key={p.id} to={`/creador/${p.id}`} className="card creador-item">
          <div className="creador-item-img">{p.portada ? <img src={p.portada} alt="" loading="lazy" /> : null}</div>
          <div className="creador-item-info">
            <strong>{p.producto}</strong>
            <span className="muted small">{fecha(p.actualizado)}</span>
            <div className="chips">
              <span className="badge">{ESTADO_PROYECTO[p.estado] ?? p.estado}</span>
              {p.creativos ? (
                <span className="badge">
                  {p.listos}/{p.creativos} creativos
                </span>
              ) : null}
              {p.campana ? (
                <span className={`badge${p.campana === "activa" ? " ok" : p.campana === "error" ? " danger" : ""}`}>
                  {ESTADO_CAMPANA[p.campana] ?? p.campana}
                </span>
              ) : null}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// =================================================================== nuevo

function NuevoProyecto({ ajustes }: { ajustes: AjustesCreador }) {
  const { session } = useAuth();
  const idEmpresa = session!.tiendaActiva;
  const { catalogo, cargando } = useCatalogo(idEmpresa);
  const navigate = useNavigate();
  const toast = useToast();

  const [productoId, setProductoId] = useState("");
  const [cargandoFicha, setCargandoFicha] = useState(false);
  const [form, setForm] = useState({ nombre: "", precio: "", descripcion: "", contenido: "", variantes: "", notas: "" });
  const [disponibles, setDisponibles] = useState<string[]>([]);
  const [fotos, setFotos] = useState<string[]>([]);
  const [imagenes, setImagenes] = useState(4);
  const [videos, setVideos] = useState(3);
  const [conPersonaje, setConPersonaje] = useState(Boolean(ajustes.fotoModelo));
  const [creatividad, setCreatividad] = useState<Creatividad>("equilibrada");
  const [presupuesto, setPresupuesto] = useState(String(ajustes.presupuesto));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opciones: OpcionCombo[] = useMemo(
    () =>
      catalogo.map((p) => {
        const precio = prodPrice(p);
        return { id: prodId(p), nombre: prodName(p), nota: precio ? pesos(precio) : undefined, img: prodImg(p) || undefined };
      }),
    [catalogo],
  );

  const elegir = async (id: string | null) => {
    setProductoId(id ?? "");
    if (!id) return;
    setCargandoFicha(true);
    setError(null);
    try {
      const r: any = await productos.get(id);
      const p = r?.product ?? r?.producto ?? r?.data ?? r;
      const variantes = arreglo(p?.variantes)
        .map((v: any) => `${texto(v?.nombre)}: ${arreglo(v?.opciones ?? v?.items ?? v?.valores).map((o: any) => texto(o?.nombre ?? o)).join(", ")}`)
        .filter((x: string) => x.replace(/[:\s,]/g, ""))
        .join(" · ");
      setForm((f) => ({
        ...f,
        nombre: texto(p?.Nombre) || prodName(p),
        precio: texto(p?.Precio ?? prodPrice(p)),
        descripcion: [texto(p?.Descripcion), texto(p?.CaracteristicasTecnicas)].filter(Boolean).join("\n\n"),
        contenido: texto(p?.ContenidoPaquete),
        variantes,
      }));
      const urls = [
        ...prodImgs(p),
        ...arreglo(p?.bundle).flatMap((b: any) => arreglo(b?.imagenes)),
      ]
        .map((u) => String(u ?? "").trim())
        .filter((u) => /^https:\/\//i.test(u));
      const unicas = [...new Set(urls)];
      setDisponibles(unicas);
      setFotos(unicas.slice(0, 3));
    } catch (e) {
      setError(`No se pudo cargar el producto: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCargandoFicha(false);
    }
  };

  const alternar = (u: string) =>
    setFotos((f) => (f.includes(u) ? f.filter((x) => x !== u) : f.length >= 6 ? f : [...f, u]));

  const crear = async () => {
    setEnviando(true);
    setError(null);
    try {
      const r = await creador.crear({
        producto: { id: productoId || null, ...form },
        fotos,
        imagenes,
        videos,
        conPersonaje,
        creatividad,
        presupuesto: Number(presupuesto),
        notas: form.notas,
      });
      await creador.planear(r.proyecto.id);
      toast.success("Proyecto creado: la IA está escribiendo el plan");
      navigate(`/creador/${r.proyecto.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  const costo = imagenes * ajustes.costos.imagen + videos * ajustes.costos.video;

  return (
    <div className="card creador-nuevo">
      <h3 className="card-title">1. El producto</h3>
      <Combo
        label="Producto del catálogo"
        opciones={opciones}
        valor={productoId}
        onChange={(id) => void elegir(id)}
        cargando={cargando}
        placeholder="Busca el producto…"
        ayuda="Trae nombre, precio, descripción y fotos. Puedes corregir todo antes de seguir."
      />
      {cargandoFicha ? <Spinner label="Cargando la ficha…" /> : null}

      <div className="form-grid">
        <Campo id="cr-nombre" label="Nombre">
          <input id="cr-nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </Campo>
        <Campo id="cr-precio" label="Precio de venta" ayuda="El que sale en los creativos">
          <input id="cr-precio" inputMode="numeric" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} />
        </Campo>
      </div>
      <Campo id="cr-desc" label="Descripción y datos técnicos" ayuda="La IA solo usa lo que esté aquí: no inventa cifras">
        <textarea id="cr-desc" rows={4} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
      </Campo>
      <div className="form-grid">
        <Campo id="cr-cont" label="Contenido del paquete">
          <input id="cr-cont" value={form.contenido} onChange={(e) => setForm({ ...form, contenido: e.target.value })} placeholder="1 taladro + 2 baterías + cargador" />
        </Campo>
        <Campo id="cr-var" label="Variantes">
          <input id="cr-var" value={form.variantes} onChange={(e) => setForm({ ...form, variantes: e.target.value })} placeholder="Color: negro, amarillo" />
        </Campo>
      </div>

      <h3 className="card-title">2. Fotos reales ({fotos.length}/6)</h3>
      <p className="muted small">
        TopView genera a partir de estas fotos: mejor el producto solo, el kit completo y el empaque. Toca para elegir.
      </p>
      <div className="creador-fotos">
        {[...new Set([...disponibles, ...fotos])].map((u) => (
          <button
            key={u}
            type="button"
            className={`creador-foto${fotos.includes(u) ? " elegida" : ""}`}
            onClick={() => alternar(u)}
            aria-pressed={fotos.includes(u)}
            aria-label={fotos.includes(u) ? "Quitar foto" : "Usar foto"}
          >
            <img src={u} alt="" loading="lazy" />
            {fotos.includes(u) ? <span className="creador-foto-n">{fotos.indexOf(u) + 1}</span> : null}
          </button>
        ))}
        <div className="creador-foto subir">
          <SubirMedia
            texto="⬆ Subir fotos"
            onSubido={(urls) => {
              setDisponibles((d) => [...d, ...urls]);
              setFotos((f) => [...f, ...urls].slice(0, 6));
            }}
          />
        </div>
      </div>

      <h3 className="card-title">3. Creativos y presupuesto</h3>
      <div className="form-grid">
        <Campo id="cr-img" label="Imágenes (4:5)">
          <input id="cr-img" type="number" min={0} max={6} value={imagenes} onChange={(e) => setImagenes(Math.max(0, Math.min(6, Number(e.target.value) || 0)))} />
        </Campo>
        <Campo id="cr-vid" label="Videos (9:16, 12 s)">
          <input id="cr-vid" type="number" min={0} max={4} value={videos} onChange={(e) => setVideos(Math.max(0, Math.min(4, Number(e.target.value) || 0)))} />
        </Campo>
        <Campo id="cr-pres" label="Presupuesto diario (COP)">
          <input id="cr-pres" inputMode="numeric" value={presupuesto} onChange={(e) => setPresupuesto(e.target.value.replace(/\D/g, ""))} />
        </Campo>
      </div>
      <label className="check-linea">
        <input type="checkbox" checked={conPersonaje} disabled={!ajustes.fotoModelo} onChange={(e) => setConPersonaje(e.target.checked)} />
        Videos con la modelo {ajustes.fotoModelo ? "" : "(sube su foto en Ajustes)"}
      </label>
      <div className="field">
        <label>Libertad creativa</label>
        <div className="creador-niveles" role="radiogroup" aria-label="Libertad creativa">
          {CREATIVIDADES.map((n) => (
            <button
              key={n.id}
              type="button"
              role="radio"
              aria-checked={creatividad === n.id}
              className={`creador-nivel${creatividad === n.id ? " activo" : ""}`}
              onClick={() => setCreatividad(n.id)}
            >
              <strong>{n.nombre}</strong>
              <span>{n.ayuda}</span>
            </button>
          ))}
        </div>
        <p className="campo-ayuda">
          La IA analiza el producto y decide los estilos que mejor lo venden; siempre respeta marca, precio, WhatsApp y la forma real
          del producto, y no repite los estilos de tus campañas recientes.
        </p>
      </div>
      <Campo id="cr-notas" label="Indicaciones para la IA (opcional)">
        <textarea
          id="cr-notas"
          rows={2}
          value={form.notas}
          onChange={(e) => setForm({ ...form, notas: e.target.value })}
          placeholder="Ej.: es para temporada navideña, resaltar que es inalámbrico, público: maestros de obra"
        />
      </Campo>

      <ErrorBanner error={error} />
      <div className="row gap creador-acciones">
        <button type="button" className="btn primary" disabled={enviando || !form.nombre || !form.precio || !fotos.length} onClick={() => void crear()}>
          {enviando ? "Creando…" : "Crear y pedir el plan a la IA"}
        </button>
        <span className="muted small">
          Escribir el plan no gasta créditos de TopView. Generar estos creativos costará unos {costo.toFixed(1)} créditos.
        </span>
      </div>
    </div>
  );
}

// ================================================================= ajustes

function AjustesPanel({ ajustes, onCambio }: { ajustes: AjustesCreador; onCambio: (a: AjustesCreador) => void }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [uid, setUid] = useState(ajustes.topview.uid);
  const [iaProveedor, setIaProveedor] = useState(ajustes.ia.proveedor);
  const [claudeKey, setClaudeKey] = useState("");
  const [claudeModelo, setClaudeModelo] = useState(ajustes.ia.claude.modelo);
  const [pruebaIA, setPruebaIA] = useState<string | null>(null);
  const [cuentaId, setCuentaId] = useState(ajustes.cuentaId);
  const [paginaId, setPaginaId] = useState(ajustes.paginaId);
  const [paginas, setPaginas] = useState<Array<{ id: string; nombre: string }>>(
    ajustes.paginaId ? [{ id: ajustes.paginaId, nombre: ajustes.paginaNombre || ajustes.paginaId }] : [],
  );
  const [presupuesto, setPresupuesto] = useState(String(ajustes.presupuesto));
  const [marca, setMarca] = useState(ajustes.marca);
  const [fotoModelo, setFotoModelo] = useState(ajustes.fotoModelo);
  const [contraEntrega, setContraEntrega] = useState(ajustes.contraEntrega);
  const [guardando, setGuardando] = useState(false);
  const [creditos, setCreditos] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ajustes.meta.conectada) return;
    creador
      .paginas()
      .then((r) => setPaginas(r.paginas))
      .catch((e) => setError(`Páginas de Facebook: ${e instanceof Error ? e.message : String(e)}`));
  }, [ajustes.meta.conectada]);

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const a = await creador.guardarAjustes({
        ...(key.trim() ? { topviewKey: key.trim() } : {}),
        ...(claudeKey.trim() ? { claudeKey: claudeKey.trim() } : {}),
        claudeModelo,
        iaProveedor,
        topviewUid: uid,
        cuentaId,
        paginaId,
        paginaNombre: paginas.find((p) => p.id === paginaId)?.nombre ?? "",
        presupuesto: Number(presupuesto),
        marca,
        fotoModelo,
        contraEntrega,
      });
      onCambio(a);
      setKey("");
      setClaudeKey("");
      toast.success("Ajustes guardados");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  const probar = async () => {
    setCreditos("…");
    try {
      const r = await creador.creditos();
      setCreditos(r.creditos === null ? "conectado" : `${r.creditos} créditos disponibles`);
    } catch (e) {
      setCreditos(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const probarIA = async () => {
    setPruebaIA("…");
    try {
      setPruebaIA((await creador.probarIA()).msg);
    } catch (e) {
      setPruebaIA(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="creador-ajustes">
      <div className="card">
        <h3 className="card-title">IA que escribe los prompts y copys</h3>
        <p className="muted small">
          Con Claude, la IA <strong>mira las fotos del producto</strong> antes de escribir: describe sus piezas tal como son y TopView
          lo deforma menos. La API key sale de{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            console.anthropic.com → API keys
          </a>{" "}
          (se paga aparte de claude.ai) y se guarda cifrada solo para tu usuario.
        </p>
        <div className="form-grid">
          <Campo id="ia-prov" label="Usar">
            <select id="ia-prov" value={iaProveedor} onChange={(e) => setIaProveedor(e.target.value as "claude" | "zunto")}>
              <option value="claude">Claude (Anthropic)</option>
              <option value="zunto">
                La IA de Zunto{ajustes.ia.zunto.modelo ? ` (${ajustes.ia.zunto.modelo})` : ""}
              </option>
            </select>
          </Campo>
          {iaProveedor === "claude" ? (
            <>
              <Campo
                id="ia-key"
                label="API key de Claude"
                ayuda={ajustes.ia.claude.key ? `Guardada: ${ajustes.ia.claude.key}. Déjala vacía para no cambiarla.` : undefined}
              >
                <input
                  id="ia-key"
                  type="password"
                  autoComplete="off"
                  value={claudeKey}
                  onChange={(e) => setClaudeKey(e.target.value)}
                  placeholder={ajustes.ia.claude.key ? "••••••••" : "sk-ant-…"}
                />
              </Campo>
              <Campo id="ia-modelo" label="Modelo">
                <select id="ia-modelo" value={claudeModelo} onChange={(e) => setClaudeModelo(e.target.value)}>
                  {ajustes.ia.modelosClaude.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
            </>
          ) : null}
        </div>
        {iaProveedor === "claude" ? (
          <div className="row gap">
            <button type="button" className="btn ghost" disabled={!ajustes.ia.claude.configurada} onClick={() => void probarIA()}>
              Probar Claude
            </button>
            {pruebaIA ? <span className="badge ok">{pruebaIA}</span> : null}
          </div>
        ) : !ajustes.ia.zunto.configurada ? (
          <div className="banner warn">La IA de Zunto no tiene API key (Ajustes → Subida a Dropi → IA que lee los chats).</div>
        ) : null}
      </div>

      <div className="card">
        <h3 className="card-title">TopView</h3>
        <p className="muted small">
          La API key y el UID salen de{" "}
          <a href="https://www.topview.ai/api-settings" target="_blank" rel="noreferrer">
            topview.ai → API settings
          </a>
          . Se guardan cifradas y solo para tu usuario. Imágenes con {ajustes.modelos.imagen} (~{ajustes.costos.imagen} créditos) y
          videos con {ajustes.modelos.video} (~{ajustes.costos.video} créditos cada uno).
        </p>
        <div className="form-grid">
          <Campo id="tv-key" label="API key" ayuda={ajustes.topview.key ? `Guardada: ${ajustes.topview.key}. Déjala vacía para no cambiarla.` : undefined}>
            <input id="tv-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={ajustes.topview.key ? "••••••••" : "Pega tu API key"} />
          </Campo>
          <Campo id="tv-uid" label="UID (Topview-Uid)">
            <input id="tv-uid" value={uid} onChange={(e) => setUid(e.target.value)} />
          </Campo>
        </div>
        <div className="row gap">
          <button type="button" className="btn ghost" disabled={!ajustes.topview.configurada} onClick={() => void probar()}>
            Probar conexión
          </button>
          {creditos ? <span className="badge ok">{creditos}</span> : null}
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Meta</h3>
        {!ajustes.meta.conectada ? (
          <p className="muted">
            Primero conecta tu token en <Link to="/anuncios">Anuncios</Link>. Para crear campañas necesita los permisos{" "}
            <code>ads_management</code>, <code>ads_read</code> y <code>pages_show_list</code>.
          </p>
        ) : null}
        <div className="form-grid">
          <Campo id="mt-cuenta" label="Cuenta publicitaria">
            <select id="mt-cuenta" value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
              <option value="">— Elegir —</option>
              {ajustes.meta.cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} ({c.moneda}){c.activa ? "" : " · inactiva"}
                </option>
              ))}
            </select>
          </Campo>
          <Campo id="mt-pagina" label="Página de Facebook (con WhatsApp conectado)">
            <select id="mt-pagina" value={paginaId} onChange={(e) => setPaginaId(e.target.value)}>
              <option value="">— Elegir —</option>
              {paginas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo id="mt-pres" label="Presupuesto diario por defecto (COP)">
            <input id="mt-pres" inputMode="numeric" value={presupuesto} onChange={(e) => setPresupuesto(e.target.value.replace(/\D/g, ""))} />
          </Campo>
          <Campo id="mt-marca" label="Marca en los creativos">
            <input id="mt-marca" value={marca} onChange={(e) => setMarca(e.target.value)} />
          </Campo>
        </div>
        <label className="check-linea">
          <input type="checkbox" checked={contraEntrega} onChange={(e) => setContraEntrega(e.target.checked)} />
          Ofrecemos pago contra entrega (la IA lo puede mencionar)
        </label>
      </div>

      <div className="card">
        <h3 className="card-title">Modelo de los videos</h3>
        <p className="muted small">Foto de frente de la persona que presenta los productos en los videos (opcional).</p>
        <div className="row gap creador-modelo">
          {fotoModelo ? <img src={fotoModelo} alt="Modelo" /> : <div className="creador-modelo-vacia">Sin foto</div>}
          <SubirMedia texto={fotoModelo ? "Cambiar foto" : "⬆ Subir foto"} multiple={false} onSubido={(u) => u[0] && setFotoModelo(u[0])} />
          {fotoModelo ? (
            <button type="button" className="btn ghost" onClick={() => setFotoModelo("")}>
              Quitar
            </button>
          ) : null}
        </div>
      </div>

      <ErrorBanner error={error} />
      <button type="button" className="btn primary" disabled={guardando} onClick={() => void guardar()}>
        {guardando ? "Guardando…" : "Guardar ajustes"}
      </button>
    </div>
  );
}

// ================================================================= detalle

function DetalleProyecto({ id }: { id: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const copiar = useCopiar();
  const [p, setP] = useState<Proyecto | null>(null);
  const [ajustes, setAjustes] = useState<AjustesCreador | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<null | "generar" | "campana" | "activar" | "borrar" | "replanear">(null);
  const [creditos, setCreditos] = useState<number | null>(null);
  const [editando, setEditando] = useState<Creativo | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await creador.get(id);
      setP(r.proyecto);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    void cargar();
    creador.ajustes().then(setAjustes).catch(() => undefined);
  }, [cargar]);

  // mientras algo corre en el servidor, se consulta cada 4 s
  const corriendo = Boolean(
    p && (p.planeando || p.campana?.estado === "creando" || p.creativos.some((c) => c.estado === "generando")),
  );
  useEffect(() => {
    if (!corriendo) return;
    const t = window.setInterval(() => void cargar(), 4000);
    return () => window.clearInterval(t);
  }, [corriendo, cargar]);

  const accion = async (nombre: string, fn: () => Promise<{ proyecto?: Proyecto }>, ok?: string) => {
    setTrabajando(nombre);
    setError(null);
    try {
      const r = await fn();
      if (r.proyecto) setP(r.proyecto);
      if (ok) toast.success(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrabajando(null);
    }
  };

  /** Guarda un cambio de un creativo (copy, incluir, prompt). */
  const cambiarCreativo = (cid: string, cambio: Partial<Creativo>) => {
    setP((x) => (x ? { ...x, creativos: x.creativos.map((c) => (c.id === cid ? { ...c, ...cambio } : c)) } : x));
  };
  const guardarCreativo = (cid: string, cambio: Record<string, unknown>) =>
    void creador.editar(id, { creativos: [{ id: cid, ...cambio }] }).catch((e) => setError(e instanceof Error ? e.message : String(e)));

  if (!p) {
    return (
      <div className="creador-page">
        <ErrorBanner error={error} />
        {!error ? <Spinner /> : null}
      </div>
    );
  }

  const porGenerar = p.creativos.filter((c) => c.incluir && c.estado !== "listo" && c.estado !== "generando");
  const costo = ajustes
    ? porGenerar.reduce((a, c) => a + (c.tipo === "video" ? ajustes.costos.video : ajustes.costos.imagen), 0)
    : null;
  const listos = p.creativos.filter((c) => c.incluir && c.estado === "listo");
  const generando = p.creativos.filter((c) => c.estado === "generando").length;
  const camp = p.campana;
  const campanaHecha = camp?.estado === "creada" || camp?.estado === "activa";

  const abrirGenerar = async () => {
    setConfirmar("generar");
    setCreditos(null);
    try {
      setCreditos((await creador.creditos()).creditos);
    } catch {
      /* sin saldo visible */
    }
  };

  return (
    <div className="creador-page">
      <PageHeader
        title={p.producto.nombre}
        subtitle={`${pesos(p.producto.precio)} · ${p.cantidades.imagenes} imágenes + ${p.cantidades.videos} videos · ${pesos(p.presupuesto)}/día`}
        actions={
          <>
            <Link to="/creador" className="btn ghost">
              ← Proyectos
            </Link>
            <button type="button" className="btn ghost" onClick={() => setConfirmar("borrar")} disabled={camp?.estado === "activa"}>
              Borrar
            </button>
          </>
        }
      />

      <ol className="creador-pasos" aria-label="Pasos">
        <li className={p.creativos.length ? "hecho" : "actual"}>Plan de la IA</li>
        <li className={listos.length ? "hecho" : p.creativos.length ? "actual" : ""}>Creativos</li>
        <li className={campanaHecha ? "hecho" : listos.length ? "actual" : ""}>Campaña en Meta</li>
      </ol>

      <ErrorBanner error={error} />

      {/* ------------------------------------------------ plan */}
      {p.planeando ? (
        <div className="card">
          <Spinner label="La IA está escribiendo los ángulos, prompts y copys (1–2 minutos)…" />
        </div>
      ) : null}
      {p.errorPlan ? (
        <div className="banner error">
          La IA no pudo escribir el plan: {p.errorPlan}{" "}
          <button type="button" className="btn-link" onClick={() => void accion("plan", () => creador.planear(id))}>
            Reintentar
          </button>
        </div>
      ) : null}
      {p.concepto && p.creativos.length ? (
        <div className="card creador-concepto">
          <span className="creador-concepto-etiqueta">Concepto</span>
          <p>{p.concepto}</p>
          <div className="row gap creador-concepto-pie">
            <span className="muted small">
              {p.ia ? `Plan escrito por ${p.ia}` : ""}
              {p.creatividad ? ` · libertad ${CREATIVIDADES.find((n) => n.id === p.creatividad)?.nombre.toLowerCase() ?? ""}` : ""}
            </span>
            {!campanaHecha && !generando && !p.planeando ? (
              <button type="button" className="btn ghost sm" onClick={() => setConfirmar("replanear")}>
                ↻ Otras ideas
              </button>
            ) : null}
          </div>
        </div>
      ) : p.ia && p.creativos.length ? (
        <p className="muted small">Plan escrito por {p.ia}.</p>
      ) : null}
      {p.faltan?.length ? (
        <div className="banner warn">
          <strong>La IA no inventó estos datos (agrégalos al copy si los tienes):</strong> {p.faltan.join(" · ")}
        </div>
      ) : null}

      {/* ------------------------------------------------ creativos */}
      {p.creativos.length ? (
        <section className="card">
          <div className="creador-seccion-cab">
            <h3 className="card-title">Creativos</h3>
            <div className="row gap">
              {generando ? <span className="badge">{generando} generándose en TopView…</span> : null}
              <button
                type="button"
                className="btn primary"
                disabled={!porGenerar.length || Boolean(trabajando) || campanaHecha}
                onClick={() => void abrirGenerar()}
              >
                {trabajando === "generar" ? "Enviando a TopView…" : `Generar ${porGenerar.length || ""} creativo${porGenerar.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
          <p className="muted small">
            Revisa a ojo que se vea la marca, el precio correcto y que el producto no esté deformado. Desmarca los que no quieras en la campaña.
          </p>
          <div className="creador-grid">
            {p.creativos.map((c) => (
              <TarjetaCreativo
                key={c.id}
                c={c}
                bloqueado={campanaHecha}
                onCambio={(cambio) => cambiarCreativo(c.id, cambio)}
                onGuardar={(cambio) => guardarCreativo(c.id, cambio)}
                onPrompt={() => setEditando(c)}
                onRegenerar={() => void accion("generar", () => creador.generar(id, [c.id]), "Enviado a TopView")}
                onCopiar={copiar}
              />
            ))}
          </div>
          {!campanaHecha ? (
            <div className="row gap">
              <button type="button" className="btn ghost sm" onClick={() => void accion("agregar", () => creador.agregarCreativo(id, "imagen"))}>
                + Imagen
              </button>
              <button type="button" className="btn ghost sm" onClick={() => void accion("agregar", () => creador.agregarCreativo(id, "video"))}>
                + Video
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------------ textos */}
      {p.creativos.length ? (
        <section className="card">
          <h3 className="card-title">Mensajes de WhatsApp y ficha</h3>
          <Campo id="pd-predef" label="Mensaje con el que llega el cliente" ayuda="Lo envía el cliente al tocar el anuncio (va en todos los anuncios)">
            <input
              id="pd-predef"
              value={p.mensajePredefinido ?? ""}
              disabled={campanaHecha}
              onChange={(e) => setP({ ...p, mensajePredefinido: e.target.value })}
              onBlur={(e) => void creador.editar(id, { mensajePredefinido: e.target.value })}
            />
          </Campo>
          <TextoCopiable
            titulo="Bienvenida para responder (Lucid Bot / mensaje inicial)"
            valor={p.bienvenida ?? ""}
            onCambio={(v) => setP({ ...p, bienvenida: v })}
            onGuardar={(v) => void creador.editar(id, { bienvenida: v })}
            onCopiar={copiar}
          />
          {(["descripcion", "modoUso", "caracteristicas", "contenido"] as const).map((k) => (
            <TextoCopiable
              key={k}
              titulo={{ descripcion: "Descripción", modoUso: "Modo de uso", caracteristicas: "Características técnicas", contenido: "Contenido del paquete" }[k]}
              valor={p.ficha?.[k] ?? ""}
              onCambio={(v) => setP({ ...p, ficha: { ...(p.ficha ?? { descripcion: "", modoUso: "", caracteristicas: "", contenido: "" }), [k]: v } })}
              onGuardar={(v) => void creador.editar(id, { ficha: { [k]: v } })}
              onCopiar={copiar}
            />
          ))}
        </section>
      ) : null}

      {/* ------------------------------------------------ campana */}
      {p.creativos.length ? (
        <section className="card">
          <h3 className="card-title">Campaña en Meta</h3>
          <ul className="creador-estructura">
            <li>
              <strong>Campaña:</strong> Ventas, presupuesto de campaña de {pesos(p.presupuesto)} diarios
            </li>
            <li>
              <strong>Conjunto:</strong> destino WhatsApp, maximizar conversaciones, Colombia sin San Andrés, Amazonas ni Mitú, público
              Advantage+
            </li>
            <li>
              <strong>Anuncios:</strong> uno por creativo listo y marcado ({listos.length})
            </li>
          </ul>
          {!campanaHecha ? (
            <div className="form-grid">
              <Campo id="pd-pres" label="Presupuesto diario (COP)">
                <input
                  id="pd-pres"
                  inputMode="numeric"
                  value={String(p.presupuesto)}
                  onChange={(e) => setP({ ...p, presupuesto: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                  onBlur={() => p.presupuesto > 0 && void creador.editar(id, { presupuesto: p.presupuesto })}
                />
              </Campo>
              <Campo id="pd-cuenta" label="Cuenta publicitaria">
                <select
                  id="pd-cuenta"
                  value={p.meta.cuentaId || ajustes?.cuentaId || ""}
                  onChange={(e) => void accion("meta", () => creador.editar(id, { cuentaId: e.target.value }))}
                >
                  <option value="">— Elegir —</option>
                  {(ajustes?.meta.cuentas ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} ({c.moneda})
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
          ) : null}
          {!(p.meta.paginaId || ajustes?.paginaId) ? (
            <div className="banner warn">
              Elige la página de Facebook en{" "}
              <Link to="/creador">Creador IA → Ajustes</Link>.
            </div>
          ) : null}

          {camp?.pasos?.length ? (
            <ol className="creador-progreso">
              {camp.pasos.map((x, i) => (
                <li key={i} className={x.ok ? "ok" : "mal"}>
                  {x.texto}
                </li>
              ))}
              {camp.estado === "creando" ? (
                <li>
                  <Spinner label="Trabajando en Meta…" />
                </li>
              ) : null}
            </ol>
          ) : null}

          {camp?.revision ? (
            <p className="small">
              En Meta: <strong>{camp.revision.estado}</strong>
              {camp.revision.presupuestoDiario ? ` · ${pesos(camp.revision.presupuestoDiario)} ${camp.cuenta?.moneda ?? ""} diarios` : ""}
              {camp.revision.problemas?.length ? ` · ⚠ ${camp.revision.problemas.join("; ")}` : ""}
            </p>
          ) : null}

          <div className="row gap creador-acciones">
            {!campanaHecha ? (
              <button
                type="button"
                className="btn primary"
                disabled={!listos.length || generando > 0 || camp?.estado === "creando" || Boolean(trabajando)}
                onClick={() => setConfirmar("campana")}
              >
                {camp?.estado === "error" ? "Reintentar crear la campaña" : `Crear campaña en Meta (pausada) con ${listos.length} anuncio${listos.length === 1 ? "" : "s"}`}
              </button>
            ) : null}
            {camp?.estado === "creada" ? (
              <button type="button" className="btn ok" disabled={Boolean(trabajando)} onClick={() => setConfirmar("activar")}>
                Activar campaña
              </button>
            ) : null}
            {camp?.estado === "activa" ? (
              <button
                type="button"
                className="btn ghost"
                disabled={Boolean(trabajando)}
                onClick={() => void accion("pausar", () => creador.activar(id, true), "Campaña pausada")}
              >
                Pausar campaña
              </button>
            ) : null}
            {camp?.enlace ? (
              <a className="btn ghost" href={camp.enlace} target="_blank" rel="noreferrer">
                Abrir en Ads Manager ↗
              </a>
            ) : null}
          </div>
          {campanaHecha ? (
            <p className="muted small">
              Recomendación: déjala correr 3–4 días y apaga en Ads Manager los anuncios con mayor costo por conversación. Los creativos son
              hechos con IA: si Meta lo pide, márcalo en cada anuncio.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------------ modales */}
      <Modal
        open={confirmar === "generar"}
        title="Generar creativos en TopView"
        onClose={() => setConfirmar(null)}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setConfirmar(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setConfirmar(null);
                void accion("generar", () => creador.generar(id), "Enviado a TopView: las imágenes tardan ~1 min y los videos 3–5 min");
              }}
            >
              Generar
            </button>
          </>
        }
      >
        <p>
          Se van a generar <strong>{porGenerar.filter((c) => c.tipo === "imagen").length} imágenes</strong> y{" "}
          <strong>{porGenerar.filter((c) => c.tipo === "video").length} videos</strong>.
        </p>
        <p>
          Costo aproximado: <strong>{costo?.toFixed(1)} créditos</strong>
          {creditos !== null ? ` · tienes ${creditos}` : ""}.
        </p>
        {creditos !== null && costo !== null && creditos < costo ? <div className="banner warn">No te alcanzan los créditos para todos.</div> : null}
      </Modal>

      <Modal
        open={confirmar === "campana"}
        title="Crear la campaña en Meta"
        onClose={() => setConfirmar(null)}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setConfirmar(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setConfirmar(null);
                void accion("campana", () => creador.crearCampana(id));
              }}
            >
              Crear (pausada)
            </button>
          </>
        }
      >
        <p>
          Se suben {listos.length} creativos a tu cuenta publicitaria y se crea la campaña con {pesos(p.presupuesto)} diarios.{" "}
          <strong>Todo queda pausado</strong>: no gasta nada hasta que la actives.
        </p>
      </Modal>

      <Modal
        open={confirmar === "activar"}
        title="Activar la campaña"
        onClose={() => setConfirmar(null)}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setConfirmar(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                setConfirmar(null);
                void accion("activar", () => creador.activar(id), "Campaña activada");
              }}
            >
              Sí, activar y empezar a gastar
            </button>
          </>
        }
      >
        <p>
          La campaña empieza a gastar hasta <strong>{pesos(camp?.revision?.presupuestoDiario ?? p.presupuesto)} diarios</strong> en la cuenta{" "}
          {camp?.cuenta?.nombre ?? ""}. ¿Ya revisaste los creativos y los copys?
        </p>
      </Modal>

      <Modal
        open={confirmar === "replanear"}
        title="Pedir otras ideas"
        onClose={() => setConfirmar(null)}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setConfirmar(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setConfirmar(null);
                void accion("plan", async () => {
                  await creador.editar(id, { creatividad: p.creatividad ?? "equilibrada", notas: p.notas });
                  return creador.planear(id);
                });
              }}
            >
              Pedir otras ideas
            </button>
          </>
        }
      >
        <p>
          La IA escribe un plan nuevo con estilos distintos a los de ahora. <strong>Se reemplazan los creativos y copys actuales</strong>{" "}
          (los ya generados en TopView siguen en tu cuenta de TopView).
        </p>
        <div className="creador-niveles" role="radiogroup" aria-label="Libertad creativa">
          {CREATIVIDADES.map((n) => (
            <button
              key={n.id}
              type="button"
              role="radio"
              aria-checked={(p.creatividad ?? "equilibrada") === n.id}
              className={`creador-nivel${(p.creatividad ?? "equilibrada") === n.id ? " activo" : ""}`}
              onClick={() => setP({ ...p, creatividad: n.id })}
            >
              <strong>{n.nombre}</strong>
              <span>{n.ayuda}</span>
            </button>
          ))}
        </div>
        <Campo id="rp-notas" label="Indicaciones (opcional)">
          <textarea id="rp-notas" rows={2} value={p.notas ?? ""} onChange={(e) => setP({ ...p, notas: e.target.value })} placeholder="Ej.: más humor, algo navideño, sin modelo" />
        </Campo>
      </Modal>

      <Modal
        open={confirmar === "borrar"}
        title="Borrar proyecto"
        onClose={() => setConfirmar(null)}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setConfirmar(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                setConfirmar(null);
                void creador
                  .borrar(id)
                  .then(() => navigate("/creador"))
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)));
              }}
            >
              Borrar
            </button>
          </>
        }
      >
        <p>Se borra el proyecto de Zunto. Lo que ya esté en Meta o en TopView no se toca.</p>
      </Modal>

      <Modal
        open={Boolean(editando)}
        title={`Prompt · ${editando?.angulo ?? ""}`}
        wide
        onClose={() => setEditando(null)}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setEditando(null)}>
              Cerrar
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={campanaHecha}
              onClick={() => {
                if (!editando) return;
                cambiarCreativo(editando.id, { prompt: editando.prompt, angulo: editando.angulo });
                guardarCreativo(editando.id, { prompt: editando.prompt, angulo: editando.angulo });
                setEditando(null);
                toast.success("Prompt guardado: dale Regenerar para usarlo");
              }}
            >
              Guardar
            </button>
          </>
        }
      >
        {editando ? (
          <>
            <Campo id="ed-angulo" label="Ángulo">
              <input id="ed-angulo" value={editando.angulo} onChange={(e) => setEditando({ ...editando, angulo: e.target.value })} />
            </Campo>
            <Campo
              id="ed-prompt"
              label={`Prompt para TopView (${editando.tipo === "video" ? "fotos: <<<Image1>>>, <<<Image2>>>…" : "fotos: Image1, Image2…"})`}
            >
              <textarea id="ed-prompt" rows={16} value={editando.prompt} onChange={(e) => setEditando({ ...editando, prompt: e.target.value })} />
            </Campo>
          </>
        ) : null}
      </Modal>
    </div>
  );
}

function TarjetaCreativo({
  c,
  bloqueado,
  onCambio,
  onGuardar,
  onPrompt,
  onRegenerar,
  onCopiar,
}: {
  c: Creativo;
  bloqueado: boolean;
  onCambio: (cambio: Partial<Creativo>) => void;
  onGuardar: (cambio: Record<string, unknown>) => void;
  onPrompt: () => void;
  onRegenerar: () => void;
  onCopiar: (t: string) => void;
}) {
  const copyCompleto = `${c.copy.texto}\n\nTítulo: ${c.copy.titulo}\nDescripción: ${c.copy.descripcion}`;
  return (
    <article className={`creador-creativo${c.incluir ? "" : " fuera"}`}>
      <div className={`creador-medio ${c.tipo}`}>
        {c.estado === "listo" && c.resultado?.url ? (
          c.tipo === "video" ? (
            <video src={c.resultado.url} poster={c.resultado.portada ?? undefined} controls preload="none" playsInline />
          ) : (
            <a href={c.resultado.url} target="_blank" rel="noreferrer">
              <img src={c.resultado.url} alt={c.angulo} loading="lazy" />
            </a>
          )
        ) : (
          <div className={`creador-medio-estado ${c.estado}`}>
            {c.estado === "generando" ? (
              <Spinner label={c.tipo === "video" ? "Generando video (3–5 min)…" : "Generando imagen…"} />
            ) : c.estado === "fallo" ? (
              <span>⚠ {c.error ?? "Falló"}</span>
            ) : (
              <span>{c.tipo === "video" ? "🎬 Video 9:16" : "🖼 Imagen 4:5"} sin generar</span>
            )}
          </div>
        )}
      </div>
      <div className="creador-creativo-cab">
        <label className="check-linea">
          <input
            type="checkbox"
            checked={c.incluir}
            disabled={bloqueado}
            onChange={(e) => {
              onCambio({ incluir: e.target.checked });
              onGuardar({ incluir: e.target.checked });
            }}
          />
          <strong>{c.angulo}</strong>
        </label>
        <span className="badge">{c.tipo === "video" ? "Video" : "Imagen"}</span>
      </div>
      {c.estilo || c.porque ? (
        <p className="creador-porque">
          {c.estilo ? <span className="creador-estilo">{c.estilo}</span> : null}
          {c.porque ? <span className="muted"> {c.porque}</span> : null}
        </p>
      ) : null}
      <div className="row gap creador-mini-acciones">
        <button type="button" className="btn ghost sm" onClick={onPrompt}>
          Prompt
        </button>
        {!bloqueado && c.estado !== "generando" && c.prompt ? (
          <button type="button" className="btn ghost sm" onClick={onRegenerar}>
            {c.estado === "listo" ? "Regenerar" : c.estado === "fallo" ? "Reintentar" : "Generar"}
          </button>
        ) : null}
        <button type="button" className="btn ghost sm" onClick={() => onCopiar(copyCompleto)}>
          Copiar copy
        </button>
      </div>
      <textarea
        aria-label={`Texto principal de ${c.angulo}`}
        rows={6}
        value={c.copy.texto}
        disabled={bloqueado}
        onChange={(e) => onCambio({ copy: { ...c.copy, texto: e.target.value } })}
        onBlur={(e) => onGuardar({ copy: { texto: e.target.value } })}
      />
      <input
        aria-label={`Título de ${c.angulo}`}
        maxLength={40}
        value={c.copy.titulo}
        disabled={bloqueado}
        placeholder="Título (máx. 40)"
        onChange={(e) => onCambio({ copy: { ...c.copy, titulo: e.target.value } })}
        onBlur={(e) => onGuardar({ copy: { titulo: e.target.value } })}
      />
      <input
        aria-label={`Descripción de ${c.angulo}`}
        value={c.copy.descripcion}
        disabled={bloqueado}
        placeholder="Descripción"
        onChange={(e) => onCambio({ copy: { ...c.copy, descripcion: e.target.value } })}
        onBlur={(e) => onGuardar({ copy: { descripcion: e.target.value } })}
      />
    </article>
  );
}

function TextoCopiable({
  titulo,
  valor,
  onCambio,
  onGuardar,
  onCopiar,
}: {
  titulo: string;
  valor: string;
  onCambio: (v: string) => void;
  onGuardar: (v: string) => void;
  onCopiar: (t: string) => void;
}) {
  return (
    <details className="creador-texto">
      <summary>
        <span>{titulo}</span>
        <button
          type="button"
          className="btn ghost sm"
          onClick={(e) => {
            e.preventDefault();
            onCopiar(valor);
          }}
        >
          Copiar
        </button>
      </summary>
      <textarea rows={8} value={valor} onChange={(e) => onCambio(e.target.value)} onBlur={(e) => onGuardar(e.target.value)} />
    </details>
  );
}
