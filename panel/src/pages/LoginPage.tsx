import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { errMsg } from "../api/client";
import { etiquetaTienda, useNombresTiendas } from "../lib/tiendas";

export function LoginPage() {
  const { pending, login, activarTienda, expirada } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otraTienda, setOtraTienda] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // nombres reales de las tiendas (aun sin sesion: se manda el token del login)
  const nombres = useNombresTiendas(pending?.idEmpresa ?? [], pending?.token);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  const activar = async (id: number) => {
    setError(null);
    setLoading(true);
    try {
      await activarTienda(id);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  // Paso 2: elegir tienda
  if (pending) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Activa tu tienda</h1>
          <p className="muted">
            Hola {pending.user.name || pending.user.email}. Elige la tienda con la que quieres
            trabajar. Este paso es obligatorio para obtener un token funcional.
          </p>

          {pending.idEmpresa.length === 0 ? (
            <p className="muted small">
              Tu cuenta no trae tiendas asociadas. Ingresa el ID manualmente.
            </p>
          ) : (
            pending.idEmpresa.map((id) => (
              <button
                key={id}
                className="shop-option"
                onClick={() => activar(Number(id))}
                disabled={loading}
              >
                <span>
                  {etiquetaTienda(id, nombres)}
                  <span className="muted small"> · id {id}</span>
                </span>
                <span>Activar →</span>
              </button>
            ))
          )}

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="otra">Otro ID de tienda</label>
            <div className="row gap">
              <input
                id="otra"
                type="number"
                placeholder="ej. 3682"
                value={otraTienda}
                onChange={(e) => setOtraTienda(e.target.value)}
              />
              <button
                className="btn primary"
                disabled={!otraTienda || loading}
                onClick={() => activar(Number(otraTienda))}
              >
                Activar
              </button>
            </div>
          </div>

          {error && <div className="banner error">{error}</div>}
        </div>
      </div>
    );
  }

  // Paso 1: login
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>ZuntoStore</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          Inicia sesion en el panel de LucidSales
        </p>

        {expirada && !error && (
          <div className="banner info" style={{ marginBottom: 16 }}>
            Tu sesion expiro o el token dejo de ser valido. Vuelve a iniciar
            sesion para continuar donde ibas.
          </div>
        )}

        <div className="field">
          <label htmlFor="email">Correo</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Contrasena</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <div className="banner error">{error}</div>}

        <button className="btn primary block" disabled={loading} type="submit">
          {loading ? "Ingresando..." : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
