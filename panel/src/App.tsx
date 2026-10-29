import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { numerosDe, puede, type Seccion } from "./auth/permisos";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { PedidosPage } from "./pages/PedidosPage";
import { PedidoDetallePage } from "./pages/PedidoDetallePage";
import { PedidoCrearPage } from "./pages/PedidoCrearPage";
import { ProductosPage } from "./pages/ProductosPage";
import { ClientesPage } from "./pages/ClientesPage";
import { MetricasPage } from "./pages/MetricasPage";
import { AnunciosPage } from "./pages/AnunciosPage";
import { CreadorPage } from "./pages/CreadorPage";
import { AjustesPage } from "./pages/AjustesPage";

/**
 * Ruta protegida por el `rol` de LucidSales (mismo criterio que el panel
 * oficial: la pagina no se monta si no hay permiso, asi no se piden datos).
 */
function Permitido({
  seccion,
  muestra,
  children,
}: {
  seccion: Seccion | Seccion[];
  muestra: string;
  children: ReactNode;
}) {
  const { session } = useAuth();
  if (puede(session?.rol ?? null, seccion)) return <>{children}</>;
  return (
    <div className="banner warn">
      <strong>Sin acceso a {muestra}.</strong> Tu usuario de LucidSales no tiene ese módulo: se
      necesita el permiso <code>{numerosDe(seccion)}</code> (tu rol es{" "}
      <code>{session?.rol || "—"}</code>). Si deberías verlo, pídele al administrador que lo agregue
      en Ajustes → Usuarios.
    </div>
  );
}

export default function App() {
  const { session } = useAuth();

  if (!session) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Inicio no pide permiso: es el punto de aterrizaje de todos */}
        <Route path="/" element={<DashboardPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route
          path="/pedidos"
          element={
            <Permitido seccion="pedidos" muestra="Pedidos">
              <PedidosPage />
            </Permitido>
          }
        />
        <Route
          path="/pedidos/nuevo"
          element={
            <Permitido seccion="pedidos" muestra="Pedidos">
              <PedidoCrearPage />
            </Permitido>
          }
        />
        <Route
          path="/pedidos/:id"
          element={
            <Permitido seccion="pedidos" muestra="Pedidos">
              <PedidoDetallePage />
            </Permitido>
          }
        />
        <Route
          path="/productos"
          element={
            <Permitido seccion="productos" muestra="Productos">
              <ProductosPage />
            </Permitido>
          }
        />
        <Route
          path="/clientes"
          element={
            <Permitido seccion="clientes" muestra="Clientes">
              <ClientesPage />
            </Permitido>
          }
        />
        <Route
          path="/metricas"
          element={
            <Permitido seccion="metricas" muestra="Métricas">
              <MetricasPage />
            </Permitido>
          }
        />
        <Route
          path="/anuncios"
          element={
            <Permitido seccion="rentabilidad" muestra="Rentabilidad de anuncios">
              <AnunciosPage />
            </Permitido>
          }
        />
        <Route
          path="/creador"
          element={
            <Permitido seccion="rentabilidad" muestra="Creador IA">
              <CreadorPage />
            </Permitido>
          }
        />
        <Route
          path="/creador/:id"
          element={
            <Permitido seccion="rentabilidad" muestra="Creador IA">
              <CreadorPage />
            </Permitido>
          }
        />
        <Route
          path="/ajustes"
          element={
            <Permitido seccion={["ajustesGeneral", "ajustesUsuarios"]} muestra="Ajustes">
              <AjustesPage />
            </Permitido>
          }
        />
        {/* rara: a Inicio, que siempre esta permitido (si no fuera a /pedidos
            un usuario sin permiso 2 caeria en un bucle de rebote) */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
