// Cuentas de ZuntoStore (un negocio con sus tiendas de LucidSales). Solo la
// ve quien administra ZuntoStore. Cada cuenta conecta lo suyo (LucidSales,
// Dropi, Lucid Bot, sheet, IA, Google Maps) entrando al panel con SU tienda.
import { useEffect, useState } from "react";
import { backend, backendSuave } from "../api/backend";
import { errMsg } from "../api/client";
import { useToast } from "./Toast";

interface Cuenta {
  id: number;
  nombre: string;
  tiendas: string[];
  activa: boolean;
  creada: string | null;
  lucidsales: boolean | null;
  subida: { automatico: boolean; dryRun: boolean } | null;
  sesionDropi: string | null;
  consumo: Record<string, number> | null;
}

/** "2026-10" en hora de Colombia, y el mes anterior. */
function mesesRecientes() {
  const ahora = new Date(Date.now() - 5 * 3600_000);
  const este = ahora.toISOString().slice(0, 7);
  const antes = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  return { este, antes };
}

const tiendasDeTexto = (t: string) =>
  t
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

function FilaCuenta({
  c,
  onCambio,
  onBorrada,
}: {
  c: Cuenta;
  onCambio: (c: Cuenta) => void;
  onBorrada: (id: number) => void;
}) {
  const toast = useToast();
  const [tiendas, setTiendas] = useState(c.tiendas.join(", "));
  const [ocupado, setOcupado] = useState(false);
  const cambiado = tiendas.replace(/\s/g, "") !== c.tiendas.join(",");

  const guardar = async (patch: Record<string, unknown>) => {
    setOcupado(true);
    try {
      const r: any = await backend(`/api/cuentas/${c.id}`, { method: "PUT", body: patch });
      onCambio(r.cuenta);
      setTiendas(r.cuenta.tiendas.join(", "));
      toast.success("Cuenta actualizada");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOcupado(false);
    }
  };

  const borrar = async () => {
    const escrito = window.prompt(
      `Esto borra TODOS los datos de «${c.nombre}» (pedidos tratados, historiales, configuración y claves) y no se puede deshacer. Escribe el nombre de la cuenta para confirmar:`,
    );
    if (escrito === null) return;
    setOcupado(true);
    try {
      await backend(`/api/cuentas/${c.id}`, { method: "DELETE", body: { confirmar: escrito.trim() } });
      onBorrada(c.id);
      toast.success(`Cuenta «${c.nombre}» borrada con sus datos`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOcupado(false);
    }
  };

  const estado = [
    c.lucidsales === null ? null : c.lucidsales ? "LucidSales conectado" : "falta LucidSales",
    c.sesionDropi
      ? c.sesionDropi === "ok"
        ? "Dropi ok"
        : c.sesionDropi === "desconocido"
          ? "sin sesión de Dropi"
          : `Dropi: ${c.sesionDropi}`
      : null,
    c.subida ? (c.subida.automatico ? (c.subida.dryRun ? "subida en prueba" : "subida activa") : "subida apagada") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <tr className={c.activa ? "" : "muted"}>
      <td>
        <strong>{c.nombre}</strong>
        <div className="muted small">
          cuenta {c.id}
          {c.id === 1 ? " · la tuya" : ""}
          {c.activa ? "" : " · desactivada"}
        </div>
      </td>
      <td style={{ minWidth: 180 }}>
        <div className="row gap" style={{ marginBottom: 0 }}>
          <input
            value={tiendas}
            onChange={(e) => setTiendas(e.target.value)}
            placeholder="ids de tienda: 3682, 6881"
            aria-label={`Tiendas de ${c.nombre}`}
            style={{ flex: "1 1 140px", minWidth: 0 }}
          />
          {cambiado ? (
            <button
              type="button"
              className="btn sm primary"
              disabled={ocupado}
              onClick={() => void guardar({ tiendas: tiendasDeTexto(tiendas) })}
            >
              Guardar
            </button>
          ) : null}
        </div>
      </td>
      <td className="small">{estado || <span className="muted">sin usar todavía</span>}</td>
      <td className="small" style={{ whiteSpace: "nowrap" }}>
        {(() => {
          const { este, antes } = mesesRecientes();
          return (
            <>
              <strong>{c.consumo?.[este] ?? 0}</strong> este mes
              <div className="muted">{c.consumo?.[antes] ?? 0} el mes pasado</div>
            </>
          );
        })()}
      </td>
      <td>
        {c.id !== 1 ? (
          <div className="row gap" style={{ marginBottom: 0 }}>
            <button type="button" className="btn sm" disabled={ocupado} onClick={() => void guardar({ activa: !c.activa })}>
              {c.activa ? "Desactivar" : "Activar"}
            </button>
            {!c.activa ? (
              <button type="button" className="btn sm danger" disabled={ocupado} onClick={() => void borrar()}>
                Borrar datos
              </button>
            ) : null}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

export function CuentasAdmin() {
  const toast = useToast();
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [nombre, setNombre] = useState("");
  const [tiendas, setTiendas] = useState("");
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    void backendSuave<{ ok: boolean; cuentas?: Cuenta[] }>("/api/cuentas").then((r) => {
      if (r?.ok) setCuentas(r.cuentas ?? []);
    });
  }, []);

  const crear = async () => {
    if (
      cuentas?.length === 1 &&
      !window.confirm(
        "Al crear la segunda cuenta empieza la separación: solo las tiendas que figuran en ZuntoStore (cuenta 1) podrán entrar a tus datos. ¿Ya están ahí todas tus tiendas?",
      )
    )
      return;
    setCreando(true);
    try {
      const r: any = await backend("/api/cuentas", {
        method: "POST",
        body: { nombre: nombre.trim(), tiendas: tiendasDeTexto(tiendas) },
      });
      setCuentas((cs) => [...(cs ?? []), r.cuenta]);
      // la tienda con la que entraste pudo pasar a la cuenta 1
      void backendSuave<{ ok: boolean; cuentas?: Cuenta[] }>("/api/cuentas").then((x) => {
        if (x?.ok) setCuentas(x.cuentas ?? []);
      });
      setNombre("");
      setTiendas("");
      toast.success(`Cuenta «${r.cuenta.nombre}» creada`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setCreando(false);
    }
  };

  if (!cuentas) return null;
  return (
    <section className="card">
      <div className="card-title">Cuentas</div>
      <p className="muted small">
        Cada cuenta es un negocio con sus tiendas de LucidSales. Sus datos y su configuración van aparte: quien entra con
        una tienda solo ve lo de su cuenta. La cuenta nueva arranca vacía y su dueño conecta lo suyo en Ajustes (LucidSales
        del servidor, sesión de Dropi, sheet de productos, Lucid Bot y sus propias claves de IA y Google Maps).
      </p>
      {cuentas.length === 1 ? (
        <div className="banner">
          Por ahora solo existe ZuntoStore y todo funciona como antes. Antes de crear otra cuenta, revisa que en ZuntoStore
          estén <strong>todas</strong> tus tiendas.
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Cuenta</th>
              <th>Tiendas (ids de LucidSales)</th>
              <th>Estado</th>
              <th title="Pedidos subidos a Dropi">Pedidos subidos</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cuentas.map((c) => (
              <FilaCuenta
                key={c.id}
                c={c}
                onCambio={(n) => setCuentas((cs) => (cs ?? []).map((x) => (x.id === n.id ? { ...x, ...n } : x)))}
                onBorrada={(id) => setCuentas((cs) => (cs ?? []).filter((x) => x.id !== id))}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-title" style={{ marginTop: 12 }}>
        Nueva cuenta
      </div>
      <div className="row gap">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del negocio" aria-label="Nombre de la cuenta" style={{ flex: "1 1 200px", minWidth: 0 }} />
        <input value={tiendas} onChange={(e) => setTiendas(e.target.value)} placeholder="Ids de tienda: 7000, 7001" aria-label="Tiendas de la cuenta" style={{ flex: "1 1 200px", minWidth: 0 }} />
        <button type="button" className="btn primary" disabled={!nombre.trim() || !tiendasDeTexto(tiendas).length || creando} onClick={() => void crear()}>
          {creando ? "Creando…" : "Crear cuenta"}
        </button>
      </div>
      <p className="campo-ayuda">
        El id de la tienda es el número de la tienda en LucidSales (el que ves al elegir la tienda). Una tienda solo puede
        estar en una cuenta.
      </p>
    </section>
  );
}
