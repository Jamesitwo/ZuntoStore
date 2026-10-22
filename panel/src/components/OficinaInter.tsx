import { useCallback, useEffect, useRef, useState } from "react";
import {
  oficinasInter,
  type HorarioDia,
  type OficinaEnListado,
  type OficinasInter,
} from "../api/endpoints";
import { errMsg } from "../api/client";

/**
 * Tarjeta "Oficina Inter Rapidísimo" del detalle del pedido.
 *
 * No consulta nada hasta que se pulsa el botón (no a todos los pedidos les
 * hace falta): al pulsarlo pide a NUESTRO backend
 * `GET /api/interrapidisimo/oficinas` la lista completa de oficinas del
 * municipio del pedido y, al elegir una, la dirección del pedido se reemplaza
 * por "Oficina Interrapidisimo - <dirección de la oficina>" (luego hay que
 * guardar los cambios como con cualquier otro campo).
 *
 * Inter tarda 13-25 s en ese listado, así que el backend lo baja en segundo
 * plano y avisa con `pendiente: "listado"`; mientras haya pendiente esta
 * tarjeta vuelve a consultar con backoff hasta que llegue la lista.
 */

/** Esperas (ms) entre reconsultas mientras el listado siga en segundo plano. */
const ESPERAS = [4000, 6000, 9000, 13000, 18000, 25000, 35000];

/**
 * Teléfonos de Inter (fijos "6044445555", móviles "3232554455", 01800...).
 * `telefono()` de lib/format asume números con +57, por eso va aparte.
 */
function telInter(v: unknown): { href: string; visible: string } | null {
  const raw = String(v ?? "").trim();
  const d = raw.replace(/\D/g, "");
  if (!d) return null;
  let visible = raw;
  if (d.startsWith("01800") && d.length >= 11) visible = `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  else if (d.length === 10) visible = `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return { href: `tel:${d}`, visible };
}

/** Dirección que se escribe en el pedido al elegir una oficina. */
export function direccionDeOficina(o: OficinaEnListado): string {
  const dir = String(o.direccion ?? o.barrio ?? o.nombre ?? "").trim();
  return `Oficina Interrapidisimo - ${dir}`;
}

interface Props {
  /** Id del departamento (LucidSales). Sin él no hay nada que consultar. */
  departamento: number | null;
  /** Id del municipio (LucidSales). Si falta, se usa la cabecera del depto. */
  ciudad: number | null;
  /** true cuando la transportadora del pedido es Inter Rapidísimo. */
  resaltar?: boolean;
  /** Dirección actual del pedido (para marcar la oficina que ya está puesta). */
  direccionActual?: string;
  /** Al elegir una oficina: se reemplaza la dirección del pedido. */
  onUsarDireccion?: (direccion: string) => void;
}

export function BloqueOficinaInter({
  departamento,
  ciudad,
  resaltar,
  direccionActual,
  onUsarDireccion,
}: Props) {
  const [activo, setActivo] = useState(false);
  const [datos, setDatos] = useState<OficinasInter | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<{ msg: string; status?: number } | null>(null);
  const [filtro, setFiltro] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const intentos = useRef(0);

  // si no hay departamento (pedido del exterior / sin ubicar) no se muestra nada
  const municipio = departamento !== null && ciudad !== null ? ciudad : undefined;

  const buscar = useCallback(
    async (reintentar = false) => {
      if (departamento === null) return;
      if (reintentar) intentos.current = 0; // el backoff de sondeo arranca de nuevo
      setCargando(true);
      setError(null);
      try {
        const r = await oficinasInter({
          municipio,
          departamento,
          ...(reintentar ? { reintentar: 1 } : {}),
        });
        setDatos(r);
      } catch (err) {
        setError({ msg: errMsg(err), status: (err as any)?.status });
      } finally {
        setCargando(false);
      }
    },
    [departamento, municipio],
  );

  // cambio de pedido o de ubicacion: se empieza de cero (sin consultar nada)
  useEffect(() => {
    setActivo(false);
    setDatos(null);
    setError(null);
    setFiltro("");
    setAbierta(null);
    intentos.current = 0;
  }, [departamento, ciudad]);

  // el backend avisa que el listado sigue en segundo plano -> se vuelve a consultar
  useEffect(() => {
    if (!activo || datos?.pendiente !== "listado") return;
    if (intentos.current >= ESPERAS.length) return;
    const t = setTimeout(() => void buscar(), ESPERAS[intentos.current]);
    intentos.current += 1;
    return () => clearTimeout(t);
  }, [activo, datos, buscar]);

  if (departamento === null) return null;

  const c = datos?.consultado;
  const lista = datos?.oficinas ?? [];

  const filtradas = filtro
    ? lista.filter((o) =>
        `${o.nombre ?? ""} ${o.direccion ?? ""} ${o.barrio ?? ""}`
          .toLowerCase()
          .includes(filtro.trim().toLowerCase()),
      )
    : lista;

  const nota =
    c?.coincidencia === "difusa"
      ? `Inter lista este municipio como «${c.listado}»${
          c.depListado ? ` (${c.depListado})` : ""
        }`
      : c?.coincidencia === "cabecera"
        ? `Este municipio no tiene oficina propia en Inter: se listan las de la cabecera «${
            c.listado ?? c.municipio ?? ""
          }»`
        : null;

  const diaHoy = (h: HorarioDia) =>
    datos?.diaActual?.id != null && h.idDia === datos.diaActual.id;

  const franjasTexto = (h: HorarioDia) =>
    h.franjas
      .map((f) => `${f.inicio ?? "??"}–${f.fin ?? "??"}${f.tipo ? ` (${f.tipo})` : ""}`)
      .join(", ");

  const usar = (o: OficinaEnListado) => onUsarDireccion?.(direccionDeOficina(o));

  return (
    <section className="card oficina-inter">
      <div className="card-title row between">
        <span>Oficina Inter Rapidísimo</span>
        <span className="row gap">
          {resaltar && <span className="badge envio">Transportadora del pedido</span>}
          {c?.municipio && <span className="badge">{c.municipio}</span>}
        </span>
      </div>

      {/* ---------- sin buscar todavia ---------- */}
      {!activo && (
        <div className="ofi-inicio">
          <p className="muted small">
            Lista las oficinas de Inter en {""}
            {ciudad !== null ? "este municipio" : "la cabecera del departamento"} para usar una
            como dirección del pedido. No consulta nada hasta que lo pidas.
          </p>
          <button className="btn" onClick={() => { setActivo(true); void buscar(); }}>
            Buscar oficinas de Inter
          </button>
        </div>
      )}

      {/* ---------- primera carga ---------- */}
      {activo && cargando && !datos && !error && (
        <p className="muted small">
          Buscando las oficinas en Inter... la primera vez tarda ~20 s.
        </p>
      )}

      {/* ---------- error ---------- */}
      {/* 400 = los ids geograficos del pedido no existen en LucidSales/Inter:
          es un dato del pedido, no un fallo del sistema (no banner rojo). */}
      {error && error.status === 400 && (
        <p className="muted small">No se pudo ubicar el municipio de este pedido en Inter.</p>
      )}

      {/* backend caido / sin configurar / timeout */}
      {error && error.status !== 400 && (
        <div className="banner error">
          <p>{error.msg}</p>
          <button className="btn sm" onClick={() => void buscar()}>
            Reintentar
          </button>
        </div>
      )}

      {/* ---------- respuesta del backend ---------- */}
      {datos && !error && (
        <>
          {nota && <div className="banner info">{nota}</div>}

          {datos.pendiente === "listado" && (
            <p className="muted small">
              Descargando las oficinas de {c?.municipio ?? "este municipio"}... (Inter tarda unos
              segundos)
            </p>
          )}

          {datos.aviso && (
            <div className="banner warn">
              <p>{datos.aviso}</p>
              <button className="btn sm" onClick={() => void buscar(true)}>
                Reintentar
              </button>
            </div>
          )}

          {!lista.length && datos.pendiente !== "listado" && !datos.aviso && (
            <p className="muted">{datos.msg ?? "Inter no tiene oficinas listadas aquí."}</p>
          )}

          {!!lista.length && (
            <>
              <div className="ofi-barra row gap">
                <span className="small muted">
                  {datos.enInter != null && datos.enInter !== lista.length
                    ? `${lista.length} de ${datos.enInter} oficinas (las más cercanas)`
                    : `${lista.length} oficina${lista.length === 1 ? "" : "s"} en ${c?.municipio ?? "el municipio"}`}
                </span>
                {lista.length > 6 && (
                  <input
                    placeholder="Filtrar por nombre o dirección"
                    value={filtro}
                    onChange={(e) => setFiltro(e.target.value)}
                  />
                )}
              </div>

              <ul className="list ofi-lista">
                {filtradas.map((o, i) => {
                  const dir = direccionDeOficina(o);
                  // identidad estable de la fila: no depende del filtro
                  const clave = String(o.id ?? `of-${i}`);
                  const esActual = dir === direccionActual;
                  const mapa =
                    o.lat != null && o.lng != null
                      ? `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`
                      : null;
                  const tels = [o.telefono1, o.telefono2]
                    .map((t) => telInter(t))
                    .filter(Boolean) as Array<{ href: string; visible: string }>;
                  const hoy =
                    o.horarioHoy
                      .map((f) => `${f.inicio ?? "??"}–${f.fin ?? "??"}`)
                      .join(", ") || null;
                  const verHorarios = abierta === clave;

                  return (
                    <li key={clave} className={`ofi-fila${esActual ? " usada" : ""}`}>
                      <div className="ofi-datos">
                        <div className="row gap" style={{ flexWrap: "wrap" }}>
                          <strong>{o.nombre?.trim() || "Oficina"}</strong>
                          {o.tipo && <span className="badge">{o.tipo}</span>}
                          {o.distancia != null && <span className="badge">{o.distancia} km</span>}
                          {esActual && <span className="badge ok">Dirección en el pedido</span>}
                        </div>

                        <div className="small">
                          {o.direccion ?? "Sin dirección"}
                          {o.barrio ? ` · ${o.barrio}` : ""}
                        </div>

                        <div className="row gap small muted" style={{ flexWrap: "wrap" }}>
                          {tels.map((t, k) => (
                            <a key={k} href={t.href} title="Llamar">
                              {t.visible}
                            </a>
                          ))}
                          {mapa && (
                            <a href={mapa} target="_blank" rel="noreferrer">
                              Ver en el mapa
                            </a>
                          )}
                          {hoy && <span>Hoy {hoy}</span>}
                          {!!o.horarios.length && (
                            <button
                              className="btn sm ghost"
                              onClick={() => setAbierta(verHorarios ? null : clave)}
                            >
                              {verHorarios ? "Ocultar horarios" : "Horarios"}
                            </button>
                          )}
                        </div>

                        {verHorarios && (
                          <ul className="list ofi-horarios">
                            {o.horarios.map((h, k) => (
                              <li key={k}>
                                <strong>{diaHoy(h) ? "Hoy" : h.dia ?? "Dia"}</strong>
                                {diaHoy(h) && h.dia ? ` (${h.dia})` : ""}:{" "}
                                {franjasTexto(h) || "sin franjas"}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="ofi-accion">
                        <button
                          className={`btn sm ${esActual ? "ghost" : ""}`}
                          disabled={esActual}
                          onClick={() => usar(o)}
                        >
                          {esActual ? "En el pedido" : "Usar esta dirección"}
                        </button>
                      </div>
                    </li>
                  );
                })}

                {!filtradas.length && (
                  <li className="muted small">Ninguna oficina coincide con «{filtro}».</li>
                )}
              </ul>
            </>
          )}

          {/* ---------- extras ---------- */}
          <div className="row gap small muted" style={{ marginTop: 10, flexWrap: "wrap" }}>
            {datos.bodega?.direccion && <span>Bodega: {datos.bodega.direccion}</span>}
            {datos.idCiudad && <span>Código DANE {datos.idCiudad}</span>}
          </div>

          {/* ---------- acciones ---------- */}
          <div className="row gap" style={{ marginTop: 10 }}>
            <button className="btn sm" disabled={cargando} onClick={() => void buscar(true)}>
              {cargando ? "Actualizando..." : "Actualizar"}
            </button>
            <button
              className="btn sm ghost"
              onClick={() => {
                setActivo(false);
                setDatos(null);
                setFiltro("");
                setAbierta(null);
                intentos.current = 0;
              }}
            >
              Ocultar
            </button>
          </div>
        </>
      )}
    </section>
  );
}
