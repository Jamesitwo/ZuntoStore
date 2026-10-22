// Modal de la cuenta de Meta del usuario: pega su token, elige sus cuentas
// publicitarias, ve cuando vence y puede desconectarse. Cada usuario del
// panel tiene su propio espacio (productos, plan y caches); quien no
// conecta nada no ve datos de nadie.
import { useEffect, useState } from "react";
import { anuncios, fechaCorta, type CuentaMeta, type EstadoCuenta } from "../../api/anuncios";
import { errMsg } from "../../api/client";
import { Campo } from "../ui";
import { Modal } from "../Modal";
import { useToast } from "../Toast";

type Paso = "resumen" | "token" | "cuentas";

export function ConectarCuenta({
  open,
  estado,
  onClose,
  onCambio,
}: {
  open: boolean;
  estado: EstadoCuenta | null;
  onClose: () => void;
  /** El padre recarga estado y datos tras cada cambio. */
  onCambio: () => Promise<void> | void;
}) {
  const [paso, setPaso] = useState<Paso>("token");
  const [token, setToken] = useState("");
  const [candidatas, setCandidatas] = useState<CuentaMeta[] | null>(null);
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [trm, setTrm] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const toast = useToast();

  // al abrir, segun el estado del usuario: resumen si ya conecto, token si no
  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmar(false);
    setToken("");
    setTrm(String(estado?.trm ?? ""));
    setCandidatas(null);
    if (estado?.enUso === "propia") {
      const sel = estado.cuentas.filter((c) => c.seleccionada).map((c) => c.id);
      setElegidas(sel);
      setPaso(sel.length ? "resumen" : "cuentas");
    } else {
      setElegidas([]);
      setPaso("token");
    }
  }, [open, estado]);

  const lista = candidatas ?? (estado?.enUso === "propia" ? estado.cuentas : []);

  const conectar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const r = await anuncios.conectar(token.trim());
      setCandidatas(r.cuentas);
      setElegidas(r.cuentas.filter((c) => c.seleccionada).map((c) => c.id));
      setPaso("cuentas");
      toast.success(`Token de ${r.usuario.nombre || r.usuario.id} validado`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setGuardando(false);
    }
  };

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      await anuncios.guardarCuentas(elegidas, Number(trm.replace(",", ".")));
      toast.success(`${elegidas.length} cuenta(s) conectadas al análisis`);
      onClose();
      await onCambio();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setGuardando(false);
    }
  };

  const desconectar = async (borrar: boolean) => {
    setGuardando(true);
    setError(null);
    try {
      const r = await anuncios.desconectar(borrar);
      toast.success(r.msg);
      onClose();
      await onCambio();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setGuardando(false);
      setConfirmar(false);
    }
  };

  const alternar = (id: string) =>
    setElegidas((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));

  return (
    <Modal
      open={open}
      title="Cuenta de Meta"
      onClose={onClose}
      footer={
        paso === "token" ? (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void conectar()}
              disabled={guardando || token.trim().length < 20}
            >
              {guardando ? "Validando…" : "Conectar"}
            </button>
          </>
        ) : paso === "cuentas" ? (
          <>
            {estado?.enUso === "propia" ? (
              <button type="button" className="btn" onClick={() => setPaso("resumen")}>
                Atrás
              </button>
            ) : null}
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void guardar()}
              disabled={guardando || !elegidas.length}
            >
              {guardando ? "Guardando…" : "Guardar selección"}
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={onClose}>
            Cerrar
          </button>
        )
      }
    >
      {error ? <div className="banner error">{error}</div> : null}

      {paso === "token" ? (
        <>
          <p className="muted small">
            Pegá tu token de Meta (Graph API Explorer, permiso <code>ads_read</code> o{" "}
            <code>ads_mcp_management</code>). Vigencia típica: 60 días. El token se guarda solo en
            tu espacio y solo tú lo usas.
          </p>
          <Campo
            id="cta-token"
            label="Token de acceso de Meta"
            ayuda="Se guarda solo en tu espacio; caduca a los 60 días y se renueva pegando uno nuevo."
          >
            <input
              id="cta-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="EAA..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </Campo>
        </>
      ) : null}

      {paso === "cuentas" ? (
        <>
          <p className="muted small">
            Marcá las cuentas que entran al análisis ({elegidas.length} de {lista.length}).
          </p>
          <div className="ads-cuenta-lista">
            {lista.map((c) => (
              <label key={c.id} className="ads-cuenta-op">
                <input
                  type="checkbox"
                  checked={elegidas.includes(c.id)}
                  onChange={() => alternar(c.id)}
                />
                <span>{c.nombre}</span>
                <span className="muted small">{c.moneda}</span>
                <span className={`muted small${c.activa ? "" : " ads-malo"}`}>
                  {c.activa ? "activa" : "pausada"}
                </span>
                <span className="muted small">act_{c.id}</span>
              </label>
            ))}
            {!lista.length ? (
              <p className="muted">Meta no devolvió cuentas con este token.</p>
            ) : null}
          </div>
          <Campo
            id="cta-trm"
            label="TRM (USD → COP)"
            ayuda="Se aplica a las cuentas en USD; las de COP no se convierten."
          >
            <input
              id="cta-trm"
              type="number"
              min={1}
              step={0.01}
              value={trm}
              onChange={(e) => setTrm(e.target.value)}
            />
          </Campo>
        </>
      ) : null}

      {paso === "resumen" && estado ? (
        <>
          <p>
            <strong>{estado.nombre ?? "Tu cuenta de Meta"}</strong> · espacio propio de{" "}
            {estado.usuario ?? "este usuario"}.
          </p>
          <ul className="ads-cuenta-datos">
            <li>
              Token conectado {estado.conectado ? `el ${fechaCorta(estado.conectado)}` : ""}
              {estado.expira
                ? ` · vence el ${fechaCorta(estado.expira)}`
                : " · Meta no informa su vencimiento"}
            </li>
            <li>
              {estado.cuentas.filter((c) => c.seleccionada).length} cuenta(s) en el análisis:{" "}
              {estado.cuentas
                .filter((c) => c.seleccionada)
                .map((c) => `${c.nombre} (${c.moneda})`)
                .join(" · ") || "—"}
            </li>
            <li>TRM {estado.trm.toLocaleString("es-CO")}</li>
          </ul>

          <div className="ads-acciones">
            <button type="button" className="btn sm" onClick={() => setPaso("cuentas")}>
              Editar cuentas y TRM
            </button>
            <button type="button" className="btn sm" onClick={() => setPaso("token")}>
              Cambiar token
            </button>
            {!confirmar ? (
              <button type="button" className="btn sm danger" onClick={() => setConfirmar(true)}>
                Desconectar
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn sm danger"
                  onClick={() => void desconectar(true)}
                  disabled={guardando}
                >
                  {guardando ? "…" : "Sí, borrar todo"}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void desconectar(false)}
                  disabled={guardando}
                >
                  Solo quitar el token
                </button>
                <button type="button" className="btn sm" onClick={() => setConfirmar(false)}>
                  Cancelar
                </button>
              </>
            )}
          </div>
          {confirmar ? (
            <p className="muted small">
              <strong>Solo quitar el token</strong> te devuelve al espacio compartido y conserva
              tus productos y tu plan. <strong>Borrar todo</strong> elimina también esos datos.
            </p>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
