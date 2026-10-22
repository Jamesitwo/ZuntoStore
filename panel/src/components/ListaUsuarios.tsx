import { useEffect, useRef, useState } from "react";
import { errMsg, pickArray } from "../api/client";
import { backend, backendSuave } from "../api/backend";
import { ESTADOS_PEDIDO, usuarios } from "../api/endpoints";
import {
  NOMBRES_PERMISO,
  nombresDeRol,
  normalizaPermisos,
} from "../auth/permisos";
import { useAuth } from "../auth/AuthContext";
import { CODIGOS_PAIS, juntaTelefono, separaTelefono, verTelefonoPrefijo } from "../lib/paises";
import { useEtiquetaTienda } from "../lib/tiendas";
import { useToast } from "./Toast";
import { ConfirmDialog, Modal } from "./Modal";
import { Campo, CheckPermiso, ErrorBanner, Spinner } from "./ui";

/**
 * Lista de usuarios de la tienda.
 *
 * GET /users/list?  -> {ok, usuarios, totalRecords}
 * PUT /users/update/{id}  -> {nombre, telefono, direccion, permisos}
 * DELETE /users/delete/{id} -> {ok, msg}
 * (las tres vienen del chunk oficial AjustesUsuariosScreen, no del bundle principal)
 *
 * `tick` lo sube la pestaña de Ajustes tras crear un usuario para refrescar.
 */
export interface UsuarioFila {
  id: number | string;
  Nombre?: string;
  Usuario?: string;
  Telefono?: string;
  Direccion?: string;
  Permisos?: string | null;
  activo?: unknown;
}

const PAGINAS = [10, 20, 50];

/** Activo/Inactivo (el oficial pinta "Inactivo" si el campo falta; aqui se avisa). */
/** La lista usa el correo como identificador (el oficial compara `Usuario` con el correo). */
function claveUsuario(u: any): string {
  return String(u?.Usuario ?? u?.Correo ?? "").trim().toLowerCase();
}

/** [1,2,3,4,5] -> "L-V"  ·  [1..7] -> "L-D"  ·  resto -> "L M X" */
function textoDias(dias: unknown): string {
  const n = ["", "L", "M", "X", "J", "V", "S", "D"];
  const lista = (Array.isArray(dias) ? dias : [])
    .map(Number)
    .filter((d) => d >= 1 && d <= 7)
    .sort((a, b) => a - b);
  if (!lista.length) return "";
  if (lista.length === 7) return "L-D";
  if (lista.join(",") === "1,2,3,4,5") return "L-V";
  return lista.map((d) => n[d]).join(" ");
}

/** Chip con el horario del usuario (verde si esta en turno ahora mismo). */
function ChipHorario({ asig, usuario }: { asig: any; usuario: string }) {
  if (!asig) return <span className="muted small">—</span>;
  const h = asig.horarios?.[usuario];
  if (!h) return <span className="muted small">Sin horario</span>;
  const enTurno = Boolean(asig.enHorario?.[usuario]);
  const inactivo = h.activo === false;
  return (
    <span
      className={`chip${enTurno ? " ok" : ""}`}
      title={
        inactivo ? "Horario pausado" : enTurno ? "En turno ahora mismo" : "Fuera de turno ahora"
      }
    >
      {textoDias(h.dias)} {h.desde}–{h.hasta}
      {inactivo ? " · pausado" : ""}
    </span>
  );
}

/** Configuracion del reparto automatico -> estado del formulario. */
function normalizaConfig(c: any) {
  return {
    automatico: !!c?.automatico,
    cadaSegundos: Math.max(10, Number(c?.cadaSegundos) || 60),
    modo: c?.modo === "todos" ? "todos" : "horario",
    tiendas: (Array.isArray(c?.tiendas) ? c.tiendas : []).map(String),
    estados: (Array.isArray(c?.estados) ? c.estados : []).map(Number),
    // null = sin restriccion (todos dentro); lista = los que estan dentro
    usuarios: Array.isArray(c?.usuarios) ? c.usuarios.map(String) : null,
  };
}

function EstadoUsuario({ v }: { v: unknown }) {
  if (v === undefined || v === null || v === "") return <span className="muted">—</span>;
  const on = v === true || v === 1 || v === "1" || v === "true";
  return (
    <span className={`badge${on ? " ok" : ""}`}>{on ? "Activo" : "Inactivo"}</span>
  );
}

/** Permisos como chips con el nombre oficial de cada numero. */
function ChipsPermisos({ valor }: { valor: unknown }) {
  const texto = nombresDeRol(valor);
  if (texto === "—") return <span className="muted">—</span>;
  if (texto === "Acceso total") return <span className="chip ok">{texto}</span>;
  return (
    <span className="chips">
      {normalizaPermisos(valor).map((n) => (
        <span key={n} className="chip" title={`Permiso ${n}`}>
          {NOMBRES_PERMISO[n] ?? `Permiso ${n}`}
        </span>
      ))}
    </span>
  );
}

export function ListaUsuarios({ tick = 0 }: { tick?: number }) {
  const { session } = useAuth();
  const toast = useToast();

  const [filas, setFilas] = useState<UsuarioFila[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(20);
  const [texto, setTexto] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // edicion
  const [editando, setEditando] = useState<UsuarioFila | null>(null);
  const [form, setForm] = useState({
    nombre: "",
    usuario: "",
    codigo: "CO",
    digitos: "",
    direccion: "",
    permisos: [] as string[],
  });
  const [guardando, setGuardando] = useState(false);
  const [errEdit, setErrEdit] = useState<string | null>(null);

  // borrado
  const [borrando, setBorrando] = useState<UsuarioFila | null>(null);
  const [okBorrando, setOkBorrando] = useState(false);

  const refrescar = () => setRecarga((r) => r + 1);

  /* -------- horarios (backend propio; si no responde, la lista sigue igual) -------- */
  const [asig, setAsig] = useState<{ horarios: any; enHorario: any } | null>(null);
  const [notaAsig, setNotaAsig] = useState<string | null>(null);
  const [recargaAsig, setRecargaAsig] = useState(0);
  const [horarioDe, setHorarioDe] = useState<{ usuario: string; nombre: string } | null>(null);
  const [formHorario, setFormHorario] = useState({
    activo: true,
    dias: [1, 2, 3, 4, 5],
    desde: "08:00",
    hasta: "17:00",
  });
  const [guardandoHorario, setGuardandoHorario] = useState(false);
  const [errHorario, setErrHorario] = useState<string | null>(null);

  // reparto automatico (backend propio)
  const etiqueta = useEtiquetaTienda();
  const [configAuto, setConfigAuto] = useState<any>(null);
  const [ultimo, setUltimo] = useState<any>(null);
  const [formConfig, setFormConfig] = useState({
    automatico: false,
    cadaSegundos: 60,
    modo: "horario",
    tiendas: [] as string[],
    estados: [] as number[],
    // null = sin restriccion (todos dentro); lista = los que estan dentro
    usuarios: null as string[] | null,
  });
  const [usuariosConfig, setUsuariosConfig] = useState<any[]>([]);
  const [guardandoConfig, setGuardandoConfig] = useState(false);
  const [probando, setProbando] = useState(false);
  const [errConfig, setErrConfig] = useState<string | null>(null);
  const configCargado = useRef(false);

  // credenciales del backend (para el reparto, probar ahora y cambios de estado)
  const [cred, setCred] = useState<{ guardadas: boolean; email: string | null } | null>(null);
  const [credForm, setCredForm] = useState({ email: "", password: "" });
  const [guardandoCred, setGuardandoCred] = useState(false);
  const [errCred, setErrCred] = useState<string | null>(null);
  const [recargaCred, setRecargaCred] = useState(0);

  /* -------- carga (igual que el oficial: page, itemsPerPage, search, filters) -------- */
  useEffect(() => {
    let cancel = false;
    (async () => {
      setCargando(true);
      setError(null);
      try {
        const r: any = await usuarios.list({
          page: pagina,
          itemsPerPage: porPagina,
          search: busqueda,
        });
        if (cancel) return;
        if (r && r.ok === false) throw new Error(r.msg || "No se pudo cargar la lista");
        setFilas(pickArray(r, ["usuarios"]));
        setTotal(Number(r?.totalRecords ?? 0));
      } catch (e) {
        if (cancel) return;
        setFilas([]);
        setTotal(0);
        setError(errMsg(e));
      } finally {
        if (!cancel) setCargando(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [pagina, porPagina, busqueda, recarga, tick]);

  /* -------- horarios: GET /api/asignacion (backend propio) -------- */
  useEffect(() => {
    let cancel = false;
    void (async () => {
      const r = await backendSuave<any>("/api/asignacion");
      if (cancel) return;
      if (!r || r.ok === false) {
        setAsig(null);
        setNotaAsig(
          (r && typeof r.msg === "string" && r.msg) ||
            "Backend propio no disponible: aqui no se veran los horarios (arranca server/ con npm start).",
        );
        return;
      }
      setAsig({ horarios: r.horarios ?? {}, enHorario: r.enHorario ?? {} });
      setNotaAsig(null);
      setConfigAuto(r.config ?? null);
      setUltimo(r.ultimo ?? null);
      if (!configCargado.current && r.config) {
        configCargado.current = true;
        setFormConfig(normalizaConfig(r.config));
      }
    })();
    return () => {
      cancel = true;
    };
  }, [recargaAsig]);

  /* -------- credenciales del backend (GET /api/credenciales) -------- */
  useEffect(() => {
    let cancel = false;
    void (async () => {
      const r = await backendSuave<any>("/api/credenciales");
      if (cancel) return;
      if (!r || r.ok === false) {
        setCred(null);
        return;
      }
      setCred({ guardadas: !!r.guardadas, email: (r.email as string) ?? null });
    })();
    return () => {
      cancel = true;
    };
  }, [recargaCred]);

  /* -------- usuarios participantes (los usa la tarjeta del reparto) -------- */  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const r: any = await usuarios.list({ page: 1, itemsPerPage: 100, search: "" });
        if (cancel) return;
        const filas = pickArray(r, ["usuarios"]);
        setUsuariosConfig(filas.filter((u) => u?.Usuario));
      } catch {
        /* sin la lista no se puede elegir: la tarjeta lo avisa */
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const desde = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const hasta = Math.min(pagina * porPagina, total);

  const buscar = () => {
    const s = texto.trim();
    if (s === busqueda && pagina === 1) refrescar();
    else {
      setPagina(1);
      setBusqueda(s);
    }
  };

  /* -------- editar -------- */
  const abrir = (u: UsuarioFila) => {
    const sep = separaTelefono(u.Telefono);
    setEditando(u);
    setErrEdit(null);
    setForm({
      nombre: u.Nombre ?? "",
      usuario: u.Usuario ?? "",
      codigo: sep.codigo,
      digitos: sep.digitos,
      direccion: u.Direccion ?? "",
      permisos: normalizaPermisos(u.Permisos),
    });
  };

  const alternaPermiso = (n: string, on: boolean) =>
    setForm((f) => ({
      ...f,
      permisos: on ? [...new Set([...f.permisos, n])] : f.permisos.filter((x) => x !== n),
    }));

  const guardar = async () => {
    if (!editando) return;
    if (!form.nombre.trim()) {
      setErrEdit("Escribe el nombre completo");
      return;
    }
    if (!form.permisos.length) {
      setErrEdit("Marca al menos un permiso (sin permisos no verá nada)");
      return;
    }
    setGuardando(true);
    setErrEdit(null);
    try {
      // igual que el oficial: permisos como array serializado en string
      const r: any = await usuarios.update(editando.id, {
        nombre: form.nombre.trim(),
        telefono: juntaTelefono(form.codigo, form.digitos),
        direccion: form.direccion.trim(),
        permisos: JSON.stringify(form.permisos),
      });
      if (r && r.ok === false) throw new Error(r.msg || "No se pudo actualizar el usuario");
      toast.success("Usuario actualizado");
      setEditando(null);
      refrescar();
    } catch (e) {
      const m = errMsg(e);
      setErrEdit(m);
      toast.error(m);
    } finally {
      setGuardando(false);
    }
  };

  /* -------- eliminar -------- */
  const eliminar = async () => {
    if (!borrando) return;
    setOkBorrando(true);
    try {
      const r: any = await usuarios.remove(borrando.id);
      if (r && r.ok === false) throw new Error(r.msg || "No se pudo eliminar el usuario");
      toast.success("Usuario eliminado");
      setBorrando(null);
      // si acabamos de vaciar la ultima pagina, volvemos una atras
      if (filas.length === 1 && pagina > 1) setPagina(pagina - 1);
      else refrescar();
    } catch (e) {
      const m = errMsg(e);
      toast.error(m);
      setBorrando(null);
    } finally {
      setOkBorrando(false);
    }
  };

  const miCorreo = (session?.user.email ?? "").toLowerCase();
  const miId = String(session?.user.id ?? "");

  /* -------- horario de un usuario -------- */
  const abrirHorario = (u: any) => {
    const k = claveUsuario(u);
    const h = asig?.horarios?.[k];
    setErrHorario(null);
    setHorarioDe({ usuario: k, nombre: u?.Nombre || u?.Usuario || k });
    setFormHorario(
      h
        ? {
            activo: h.activo !== false,
            dias: Array.isArray(h.dias) && h.dias.length ? h.dias.map(Number) : [1, 2, 3, 4, 5],
            desde: String(h.desde ?? "08:00"),
            hasta: String(h.hasta ?? "17:00"),
          }
        : { activo: true, dias: [1, 2, 3, 4, 5], desde: "08:00", hasta: "17:00" },
    );
  };

  const guardarHorario = async (quitar = false) => {
    if (!horarioDe) return;
    setGuardandoHorario(true);
    setErrHorario(null);
    try {
      await backend("/api/asignacion/horario", {
        method: "PUT",
        body: {
          usuario: horarioDe.usuario,
          nombre: horarioDe.nombre,
          horario: quitar
            ? null
            : {
                activo: formHorario.activo,
                dias: formHorario.dias,
                desde: formHorario.desde,
                hasta: formHorario.hasta,
              },
        },
      });
      toast.success(quitar ? "Horario quitado" : "Horario guardado");
      setHorarioDe(null);
      setRecargaAsig((x) => x + 1);
    } catch (e) {
      const m = errMsg(e);
      setErrHorario(m);
      toast.error(m);
    } finally {
      setGuardandoHorario(false);
    }
  };

  const alternaDia = (d: number) =>
    setFormHorario((f) => ({
      ...f,
      dias: f.dias.includes(d)
        ? f.dias.filter((x) => x !== d)
        : [...f.dias, d].sort((a, b) => a - b),
    }));

  /* -------- reparto automatico -------- */
  /** Guarda las credenciales en el servidor (no se devuelven nunca). */
  const guardarCredenciales = async () => {
    setGuardandoCred(true);
    setErrCred(null);
    try {
      const r: any = await backend("/api/credenciales", {
        method: "PUT",
        body: { email: credForm.email.trim(), password: credForm.password },
      });
      setCred({ guardadas: !!r.guardadas, email: r.email ?? null });
      setCredForm({ email: "", password: "" });
      toast.success("Credenciales guardadas: el backend ya puede consultar LucidSales");
      setRecargaCred((x) => x + 1);
      setRecargaAsig((x) => x + 1); // por si «Probar ahora» venia fallando
    } catch (e) {
      const m = errMsg(e);
      setErrCred(m);
      toast.error(m);
    } finally {
      setGuardandoCred(false);
    }
  };

  const borrarCredenciales = async () => {
    setGuardandoCred(true);
    setErrCred(null);
    try {
      const r: any = await backend("/api/credenciales", { method: "DELETE" });
      setCred({ guardadas: !!r.guardadas, email: r.email ?? null });
      toast.success("Credenciales quitadas del servidor");
    } catch (e) {
      const m = errMsg(e);
      setErrCred(m);
      toast.error(m);
    } finally {
      setGuardandoCred(false);
    }
  };

  /** ¿Esta dentro? `null` (sin restriccion) = todos dentro. */
  const participa = (k: string) =>
    formConfig.usuarios === null || formConfig.usuarios.includes(k);

  /** Al primer clic se concreta la lista (todos -> los que quedan marcados). */
  const alternaParticipante = (k: string) =>
    setFormConfig((f) => {
      const base =
        f.usuarios === null
          ? usuariosConfig.map((u) => claveUsuario(u)).filter(Boolean)
          : f.usuarios;
      return {
        ...f,
        usuarios: base.includes(k) ? base.filter((x) => x !== k) : [...base, k],
      };
    });

  const guardarConfig = async () => {
    setGuardandoConfig(true);
    setErrConfig(null);
    try {
      const r: any = await backend("/api/asignacion/config", {
        method: "PUT",
        body: { ...formConfig },
      });
      setConfigAuto(r?.config ?? null);
      if (r?.config) setFormConfig(normalizaConfig(r.config));
      toast.success("Configuración del reparto guardada");
    } catch (e) {
      const m = errMsg(e);
      setErrConfig(m);
      toast.error(m);
    } finally {
      setGuardandoConfig(false);
    }
  };

  /** Ejecuta una vuelta ahora mismo (aunque este apagado). */
  const probarAhora = async () => {
    setProbando(true);
    setErrConfig(null);
    try {
      const r: any = await backend("/api/asignacion/probar", { method: "POST", body: {} });
      if (r?.ok === false) throw new Error(r.msg || "El reparto no pudo ejecutarse");
      if (r?.resultado?.saltado === "en curso") {
        toast.info("Ya hay una vuelta en curso");
        return;
      }
      setUltimo(r?.ultimo ?? r?.resultado ?? null);
      const n = Number(r?.resultado?.repartidos ?? 0);
      const omit = Number(r?.resultado?.omitidos ?? 0);
      toast.success(
        n
          ? `${n} pedido(s) repartidos${omit ? ` · ${omit} omitidos` : ""}`
          : "Vuelta ejecutada: no había nada que repartir",
      );
      setRecargaAsig((x) => x + 1);
    } catch (e) {
      const m = errMsg(e);
      setErrConfig(m);
      toast.error(m);
    } finally {
      setProbando(false);
    }
  };

  const DIAS_CORTOS: Array<[number, string]> = [
    [1, "Lun"],
    [2, "Mar"],
    [3, "Mié"],
    [4, "Jue"],
    [5, "Vie"],
    [6, "Sáb"],
    [7, "Dom"],
  ];

  return (
    <>
      {/* -------- credenciales del backend (sin tocar el .env) -------- */}
      <section className="card">
        <div className="row between wrap">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Conexión del backend con LucidSales
          </div>
          <span className={`chip${cred?.guardadas ? " ok" : ""}`}>
            {cred === null
              ? "sin conectar"
              : cred.guardadas
                ? `guardadas · ${cred.email}`
                : "sin credenciales"}
          </span>
        </div>

        <p className="muted small" style={{ marginTop: 8 }}>
          El backend hace de servidor contra servidor para el <strong>reparto automático</strong>,
          <strong> Probar ahora</strong> y (si lo usas) los cambios de estado. Se guardan en el
          servidor y <strong>nunca se devuelven</strong>: aquí solo se ve el correo enmascarado.
          No hace falta tocar el <code>.env</code> ni reiniciar nada.
        </p>
        {cred === null ? (
          <p className="muted small">
            El backend no contesta: arráncalo con <code>cd server && npm start</code>.
          </p>
        ) : null}

        <div className="form-grid">
          <Campo
            id="cred-email"
            label="Correo de LucidSales"
            ayuda={
              cred?.guardadas
                ? `Guardado: ${cred.email}. Escribe otros para cambiarlos.`
                : "La cuenta de servicio con la que consulta el backend."
            }
          >
            <input
              id="cred-email"
              type="email"
              autoComplete="username"
              placeholder="tu-cuenta@lucidsales.co"
              value={credForm.email}
              onChange={(e) => setCredForm((f) => ({ ...f, email: e.target.value }))}
            />
          </Campo>
          <Campo
            id="cred-pass"
            label="Contraseña"
            ayuda="Se guarda en el servidor (archivo con permisos de lectura para el dueño) y no se vuelve a mostrar."
          >
            <input
              id="cred-pass"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={credForm.password}
              onChange={(e) => setCredForm((f) => ({ ...f, password: e.target.value }))}
            />
          </Campo>
        </div>

        <div className="acciones-form">
          <button
            className="btn primary"
            onClick={() => void guardarCredenciales()}
            disabled={guardandoCred || !credForm.email.trim() || !credForm.password}
          >
            {guardandoCred
              ? "Guardando..."
              : cred?.guardadas
                ? "Actualizar credenciales"
                : "Guardar credenciales"}
          </button>
          <button
            className="btn"
            onClick={() => void borrarCredenciales()}
            disabled={guardandoCred || !cred?.guardadas}
          >
            Quitar credenciales
          </button>
        </div>
        <ErrorBanner error={errCred} />
      </section>

      {/* -------- reparto automatico (backend propio) -------- */}
      <section className="card">
        <div className="row between wrap">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Reparto automático de pedidos
          </div>
          <span className={`chip${configAuto?.automatico ? " ok" : ""}`}>
            {configAuto === null
              ? "sin conectar"
              : configAuto.automatico
                ? "ACTIVO"
                : "apagado"}
          </span>
        </div>

        <p className="muted small" style={{ marginTop: 8 }}>
          Con <strong>el reparto encendido</strong>, el backend mira cada N segundos los pedidos
          recientes sin asignar de las tiendas marcadas y los reparte equitativamente entre los
          usuarios activos (si el modo es <em>horario</em>, solo entre los que están en turno).
          Con él <strong>apagado</strong> no toca nada: el reparto solo ocurre al pulsar
          «Asignar pedidos» en la lista de Pedidos.
        </p>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="auto-on">Reparto automático</label>
            <label className="switch" htmlFor="auto-on">
              <input
                id="auto-on"
                type="checkbox"
                disabled={!configAuto}
                checked={formConfig.automatico}
                onChange={(e) => setFormConfig((f) => ({ ...f, automatico: e.target.checked }))}
              />
              <span className="switch-pista" aria-hidden="true" />
              <span className="switch-texto">
                {formConfig.automatico ? "Encendido" : "Apagado"}
              </span>
            </label>
            <p className="campo-ayuda">
              Se hace efectivo al guardar. El chip de arriba refleja lo que hay guardado
              ahora mismo.
            </p>
          </div>
          <div className="field">
            <label htmlFor="auto-modo">Modo de reparto</label>
            <select
              id="auto-modo"
              value={formConfig.modo}
              disabled={!configAuto}
              onChange={(e) =>
                setFormConfig((f) => ({ ...f, modo: e.target.value as "todos" | "horario" }))
              }
            >
              <option value="horario">Solo quien esté en horario</option>
              <option value="todos">Entre todos los usuarios</option>
            </select>
          </div>
          <Campo
            id="auto-cada"
            label="Cada cuánto (segundos)"
            ayuda="Entre 10 y 3600. Solo mira pedidos nuevos: nunca reasigna."
          >
            <input
              id="auto-cada"
              type="number"
              min={10}
              max={3600}
              disabled={!configAuto}
              value={formConfig.cadaSegundos}
              onChange={(e) =>
                setFormConfig((f) => ({ ...f, cadaSegundos: Number(e.target.value) }))
              }
            />
          </Campo>
        </div>

        <Campo
          id="auto-tiendas"
          label="Tiendas que revisa"
          ayuda="Si no marcas ninguna, el backend usa su LUCID_TIENDA."
        >
          <div className="permisos-grid">
            {(session?.idEmpresa ?? []).map((t) => (
              <label className="check-permiso" key={t} htmlFor={`auto-t-${t}`}>
                <input
                  id={`auto-t-${t}`}
                  type="checkbox"
                  disabled={!configAuto}
                  checked={formConfig.tiendas.includes(String(t))}
                  onChange={() =>
                    setFormConfig((f) => ({
                      ...f,
                      tiendas: f.tiendas.includes(String(t))
                        ? f.tiendas.filter((x) => x !== String(t))
                        : [...f.tiendas, String(t)],
                    }))
                  }
                />
                <span>
                  <strong>{etiqueta(t)}</strong>
                </span>
              </label>
            ))}
          </div>
        </Campo>

        <Campo
          id="auto-estados"
          label="Estados que considera pendientes"
          ayuda="Por defecto solo «Por confirmar» (0). Si no marcas ninguno, reparte cualquiera."
        >
          <div className="permisos-grid">
            {Object.entries(ESTADOS_PEDIDO).map(([code, label]) => (
              <label className="check-permiso" key={code} htmlFor={`auto-e-${code}`}>
                <input
                  id={`auto-e-${code}`}
                  type="checkbox"
                  disabled={!configAuto}
                  checked={formConfig.estados.includes(Number(code))}
                  onChange={() =>
                    setFormConfig((f) => ({
                      ...f,
                      estados: f.estados.includes(Number(code))
                        ? f.estados.filter((x) => x !== Number(code))
                        : [...f.estados, Number(code)].sort((a, b) => a - b),
                    }))
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </Campo>

        <Campo
          id="auto-usuarios"
          label="Usuarios que participan"
          ayuda={
            usuariosConfig.length === 0
              ? "No se pudo leer la lista de usuarios."
              : formConfig.usuarios === null
                ? "Sin restricción: participan todos los activos (están todos marcados). Desmarca a quien quieras FUERA; si desmarcas a todos, no se reparte nada."
                : `${formConfig.usuarios.length} de ${usuariosConfig.length} dentro. Los que estén fuera no recibirán pedidos.`
          }
        >
          {usuariosConfig.length === 0 ? (
            <p className="muted small">No se pudieron cargar los usuarios.</p>
          ) : (
            <div className="permisos-grid">
              {usuariosConfig.map((u) => {
                const k = claveUsuario(u);
                const inactivo =
                  u.activo === false || u.activo === 0 || u.activo === "0";
                return (
                  <label className="check-permiso" key={k} htmlFor={`auto-u-${k}`}>
                    <input
                      id={`auto-u-${k}`}
                      type="checkbox"
                      disabled={!configAuto}
                      checked={participa(k)}
                      onChange={() => alternaParticipante(k)}
                    />
                    <span>
                      <strong>{u.Nombre || k}</strong>{" "}
                      <span className="muted small">
                        {u.Usuario}
                        {inactivo ? " · inactivo" : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </Campo>

        <p className="muted small">
          {ultimo
            ? `Última vuelta: ${new Date(ultimo.ts).toLocaleString("es-CO")} → ${
                ultimo.ok === false
                  ? `error: ${ultimo.msg ?? "desconocido"}`
                  : `${Number(ultimo.repartidos ?? 0)} repartidos${
                      Number(ultimo.omitidos ?? 0) ? ` · ${ultimo.omitidos} omitidos` : ""
                    }`
              }`
            : "Todavía no ha ejecutado ninguna vuelta."}
        </p>

        <div className="acciones-form">
          <button
            className="btn primary"
            onClick={() => void guardarConfig()}
            disabled={guardandoConfig || !configAuto}
          >
            {guardandoConfig ? "Guardando..." : "Guardar configuración"}
          </button>
          <button
            className="btn"
            onClick={() => void probarAhora()}
            disabled={probando || !configAuto}
            title="Ejecuta una vuelta ahora mismo, aunque el reparto este apagado"
          >
            {probando ? "Ejecutando..." : "Probar ahora"}
          </button>
        </div>
        <ErrorBanner error={errConfig} />
      </section>

      <section className="card">
        <div className="row between wrap">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Usuarios de la tienda
          </div>
          <div className="row gap">
            <input
              id="us-buscar"
              placeholder="Buscar usuario"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && buscar()}
              autoComplete="off"
              aria-label="Buscar usuario"
            />
            <button className="btn" onClick={buscar} disabled={cargando}>
              Buscar
            </button>
            <button className="btn ghost" onClick={refrescar} disabled={cargando}>
              Recargar
            </button>
          </div>
        </div>

        <p className="muted small" style={{ marginTop: 8 }}>
          GET /users/list · {total} en total
          {busqueda ? ` · filtrando por «${busqueda}»` : ""}
        </p>

        <ErrorBanner error={error} />
        {notaAsig ? <p className="muted small">{notaAsig}</p> : null}

        {cargando ? (
          <Spinner label="Cargando usuarios..." />
        ) : filas.length === 0 ? (
          <p className="muted">
            {error
              ? "No se pudo cargar la lista."
              : busqueda
                ? `Ningún usuario coincide con «${busqueda}».`
                : "Todavía no hay usuarios en esta tienda."}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo electrónico</th>
                  <th className="hide-sm">Teléfono</th>
                  <th>Permisos</th>
                  <th className="hide-sm">Estado</th>
                  <th className="hide-sm">Horario</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((u, i) => {
                  const yo =
                    String(u.Usuario ?? "").toLowerCase() === miCorreo && miCorreo !== "";
                  const esMiId = String(u.id) === miId;
                  return (
                    <tr key={u.id !== undefined && u.id !== null ? String(u.id) : `u${i}`}>
                      <td className="wrap">
                        <strong>{u.Nombre || "—"}</strong>
                      </td>
                      <td className="wrap">
                        {yo ? (
                          <span title="Tu cuenta" aria-label="Tu cuenta">
                            👤{" "}
                          </span>
                        ) : null}
                        {u.Usuario || "—"}
                        {yo ? <span className="muted"> (tu)</span> : null}
                      </td>
                      <td className="hide-sm">{verTelefonoPrefijo(u.Telefono) || "—"}</td>
                      <td className="wrap">
                        <ChipsPermisos valor={u.Permisos} />
                      </td>
                      <td className="hide-sm">
                        <EstadoUsuario v={u.activo} />
                      </td>
                      <td className="hide-sm">
                        <ChipHorario asig={asig} usuario={claveUsuario(u)} />
                      </td>
                      <td>
                        <span className="row gap">
                          <button
                            className="btn sm"
                            disabled={!asig}
                            title={asig ? "Asignar horario de trabajo" : notaAsig ?? ""}
                            onClick={() => abrirHorario(u)}
                          >
                            Horario
                          </button>
                          {!yo ? (
                            <>
                              <button className="btn sm" onClick={() => abrir(u)}>
                                Editar
                              </button>
                              {!esMiId ? (
                                <button
                                  className="btn sm danger"
                                  onClick={() => setBorrando(u)}
                                >
                                  Eliminar
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <span className="muted small">tu cuenta</span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="pagination">
          <div className="pages">
            <span>
              {total ? `${desde}–${hasta} de ${total}` : "0 usuarios"} · por página
            </span>
            <select
              aria-label="Usuarios por página"
              value={porPagina}
              onChange={(e) => {
                setPorPagina(Number(e.target.value));
                setPagina(1);
              }}
            >
              {PAGINAS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="pages">
            <button
              className="btn sm"
              disabled={pagina <= 1 || cargando}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
            >
              ← Anterior
            </button>
            <span>
              Página {Math.min(pagina, paginas)} de {paginas}
            </span>
            <button
              className="btn sm"
              disabled={pagina >= paginas || cargando}
              onClick={() => setPagina((p) => p + 1)}
            >
              Siguiente →
            </button>
          </div>
        </div>
      </section>

      {/* -------- editar -------- */}
      <Modal
        open={!!editando}
        title={`Editar usuario${editando ? `: ${editando.Nombre || editando.Usuario || ""}` : ""}`}
        onClose={() => setEditando(null)}
        wide
        footer={
          <>
            <button className="btn ghost" onClick={() => setEditando(null)} disabled={guardando}>
              Cancelar
            </button>
            <button className="btn primary" onClick={guardar} disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            guardar();
          }}
        >
          <div className="form-grid">
            <Campo id="ed-nombre" label="Nombre completo">
              <input
                id="ed-nombre"
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              />
            </Campo>
            <Campo
              id="ed-email"
              label="Correo electrónico"
              ayuda="El correo no se modifica: el panel oficial no lo envía en users/update."
            >
              <input id="ed-email" value={form.usuario} disabled autoComplete="off" />
            </Campo>
            <Campo
              id="ed-tel"
              label="Teléfono"
              ayuda="Se guarda con el prefijo del país y sin + (ej. 573001234567)."
            >
              <div className="row gap">
                <select
                  id="ed-pais"
                  aria-label="Prefijo del país"
                  value={form.codigo}
                  onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                  style={{ maxWidth: 150 }}
                >
                  {CODIGOS_PAIS.map(([c, prefijo, n]) => (
                    <option key={c} value={c}>
                      +{prefijo} {n}
                    </option>
                  ))}
                </select>
                <input
                  id="ed-tel"
                  value={form.digitos}
                  onChange={(e) => setForm({ ...form, digitos: e.target.value })}
                  placeholder="3001234567"
                  inputMode="numeric"
                />
              </div>
            </Campo>
            <Campo id="ed-dir" label="Dirección">
              <input
                id="ed-dir"
                value={form.direccion}
                onChange={(e) => setForm({ ...form, direccion: e.target.value })}
              />
            </Campo>
          </div>

          <h4 className="subtitulo-form">Permisos</h4>
          <p className="muted small">
            Cada casilla es un módulo del panel de LucidSales (nombre oficial del formulario).
            Si marcas todos se guarda como acceso total.
          </p>
          <div className="permisos-grid">
            {Object.entries(NOMBRES_PERMISO)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([numero, nombre]) => (
                <CheckPermiso
                  key={numero}
                  id={`ed-perm-${numero}`}
                  numero={numero}
                  nombre={nombre}
                  marcado={form.permisos.includes(numero)}
                  onChange={(v) => alternaPermiso(numero, v)}
                />
              ))}
          </div>
          <ErrorBanner error={errEdit} />
        </form>
      </Modal>

      {/* -------- eliminar -------- */}
      <ConfirmDialog
        open={!!borrando}
        title="Eliminar usuario"
        danger
        loading={okBorrando}
        confirmLabel="Eliminar"
        message={
          <>
            Se eliminará <strong>{borrando?.Nombre || borrando?.Usuario}</strong> (
            {borrando?.Usuario}) de esta tienda. Esta acción no se puede deshacer.
          </>
        }
        onConfirm={eliminar}
        onCancel={() => setBorrando(null)}
      />

      {/* -------- horario de trabajo -------- */}
      <Modal
        open={!!horarioDe}
        title={`Horario de ${horarioDe?.nombre || horarioDe?.usuario || ""}`}
        onClose={() => setHorarioDe(null)}
        footer={
          <>
            <button
              className="btn ghost"
              onClick={() => void guardarHorario(true)}
              disabled={guardandoHorario || !asig?.horarios?.[horarioDe?.usuario ?? ""]}
            >
              Quitar horario
            </button>
            <button
              className="btn ghost"
              onClick={() => setHorarioDe(null)}
              disabled={guardandoHorario}
            >
              Cancelar
            </button>
            <button
              className="btn primary"
              onClick={() => void guardarHorario(false)}
              disabled={guardandoHorario}
            >
              {guardandoHorario ? "Guardando..." : "Guardar horario"}
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void guardarHorario(false);
          }}
        >
          <p className="muted small" style={{ marginTop: 0 }}>
            Es el horario que usa el reparto <strong>solo en horario</strong>. Días: 1 = lunes … 7
            = domingo, en hora de Colombia.
          </p>

          <label className="switch" htmlFor="hor-activo" style={{ marginBottom: 12 }}>
            <input
              id="hor-activo"
              type="checkbox"
              checked={formHorario.activo}
              onChange={(e) => setFormHorario((f) => ({ ...f, activo: e.target.checked }))}
            />
            <span className="switch-pista" aria-hidden="true" />
            <span className="switch-texto">
              {formHorario.activo ? "Horario activo" : "Horario pausado"}
            </span>
          </label>

          <Campo id="hor-dias" label="Días de trabajo">
            <div className="permisos-grid">
              {DIAS_CORTOS.map(([d, n]) => (
                <label className="check-permiso" key={d} htmlFor={`hor-dia-${d}`}>
                  <input
                    id={`hor-dia-${d}`}
                    type="checkbox"
                    checked={formHorario.dias.includes(d)}
                    onChange={() => alternaDia(d)}
                  />
                  <span>
                    <strong>{n}</strong>
                  </span>
                </label>
              ))}
            </div>
          </Campo>

          <div className="form-grid">
            <Campo id="hor-desde" label="Desde">
              <input
                id="hor-desde"
                type="time"
                value={formHorario.desde}
                onChange={(e) => setFormHorario((f) => ({ ...f, desde: e.target.value }))}
              />
            </Campo>
            <Campo id="hor-hasta" label="Hasta">
              <input
                id="hor-hasta"
                type="time"
                value={formHorario.hasta}
                onChange={(e) => setFormHorario((f) => ({ ...f, hasta: e.target.value }))}
              />
            </Campo>
          </div>
          <ErrorBanner error={errHorario} />
        </form>
      </Modal>
    </>
  );
}
