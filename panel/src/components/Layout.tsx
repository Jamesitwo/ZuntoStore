import type { ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { puede, type Seccion } from "../auth/permisos";
import { useEtiquetaTienda } from "../lib/tiendas";

// `permiso`: si no esta, el enlace es para todos (Inicio).
// Mismo criterio que el menu lateral del panel oficial.
const NAV: Array<{ to: string; label: string; icon: string; permiso?: Seccion | Seccion[] }> = [
  { to: "/", label: "Inicio", icon: "home" },
  { to: "/pedidos", label: "Pedidos", icon: "orders", permiso: "pedidos" },
  { to: "/productos", label: "Productos", icon: "products", permiso: "productos" },
  { to: "/clientes", label: "Clientes", icon: "customers", permiso: "clientes" },
  { to: "/metricas", label: "Métricas", icon: "metrics", permiso: "metricas" },
  { to: "/anuncios", label: "Anuncios", icon: "ads", permiso: "rentabilidad" },
  { to: "/creador", label: "Creador IA", icon: "spark", permiso: "rentabilidad" },
  {
    to: "/ajustes",
    label: "Ajustes",
    icon: "settings",
    permiso: ["ajustesGeneral", "ajustesUsuarios"],
  },
];

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-6h6v6"/></>,
    orders: <><path d="M5 4h14v17H5z"/><path d="M9 4V2h6v2M8 9h8M8 13h8M8 17h5"/></>,
    products: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    customers: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1a6.5 6.5 0 0 1 13 0v1zM16 5a3.5 3.5 0 0 1 0 6.8M18 14a5.5 5.5 0 0 1 3.5 5.1v.9"/></>,
    metrics: <><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 6-7"/></>,
    ads: <><path d="M4 14V9a2 2 0 0 1 2-2h3l9-4v17l-9-4H6a2 2 0 0 1-2-2Z"/><path d="m8 16 2 5h4l-3-6"/></>,
    spark: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m12 8 1.5 2.5L16 12l-2.5 1.5L12 16l-1.5-2.5L8 12l2.5-1.5Z"/><path d="m18.5 5.5-1.5 1.5M7 17l-1.5 1.5"/></>,
    shipping: <><path d="M3 6h11v12H3zM14 10h4l3 3v5h-7z"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="17.5" cy="19" r="1.5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z"/></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Layout() {
  const { session, activarTienda, logout } = useAuth();
  const navigate = useNavigate();
  const etiqueta = useEtiquetaTienda();

  if (!session) return null;

  const verPedidos = puede(session.rol, "pedidos");
  const visibles = NAV.filter((i) => !i.permiso || puede(session.rol, i.permiso));

  const onCambiarTienda = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = Number(e.target.value);
    if (!id || id === session.tiendaActiva) return;
    await activarTienda(id);
    navigate(verPedidos ? "/pedidos" : "/");
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><span>Z</span></span>
          <span className="brand-wordmark">zunto<span>store</span></span>
        </div>
        <nav>
          {visibles.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              <NavIcon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="btn ghost block" onClick={logout}>
            Cerrar sesion
          </button>
        </div>
      </aside>

      <nav className="mobile-nav" aria-label="Navegación principal">
        {visibles.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"}>
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="main">
        <header className="topbar">
          <div className="shop-switcher">
            <label htmlFor="tienda">Tienda activa</label>
            <select
              id="tienda"
              value={session.tiendaActiva}
              onChange={onCambiarTienda}
              title={`Tienda #${session.tiendaActiva}`}
            >
              {session.idEmpresa.map((id) => (
                <option key={id} value={Number(id)}>
                  {etiqueta(id)}
                </option>
              ))}
              {!session.idEmpresa.includes(String(session.tiendaActiva)) && (
                <option value={session.tiendaActiva}>
                  {etiqueta(session.tiendaActiva)}
                </option>
              )}
            </select>
          </div>
          <div className="user-chip" title={session.user.email}>
            <span className="avatar">{(session.user.name || "?").charAt(0).toUpperCase()}</span>
            <span className="user-chip-name">{session.user.name || session.user.email}</span>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
