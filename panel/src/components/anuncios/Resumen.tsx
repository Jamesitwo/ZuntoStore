// Resumen: KPIs de la ventana, reparto por clasificacion y las tres barras
// que mas se miran (perdidas, donde se va el gasto y lo que arranco reciente).
import type { Clase, Datos } from "../../api/anuncios";
import { CLASES, ETIQUETAS, dinero, haceCuanto, pct, veces } from "../../api/anuncios";

const COLOR: Record<Clase, string> = {
  RENTABLE: "#16a34a",
  AJUSTADA: "#2563eb",
  RIESGO: "#d97706",
  PERDIDA: "#dc2626",
  SINDATO: "#94a3b8",
};

function Kpi({ label, valor, ayuda, tono }: {
  label: string;
  valor: string;
  ayuda?: string;
  tono?: "ok" | "malo";
}) {
  return (
    <div className="stat-card" title={ayuda}>
      <span className="stat-label">{label}</span>
      <span className={`stat-value${tono === "ok" ? " ads-bueno" : tono === "malo" ? " ads-malo" : ""}`}>
        {valor}
      </span>
    </div>
  );
}

function Barra({ titulo, notas, items, negativo }: {
  titulo: string;
  notas?: string;
  items: Array<{ id: string; label: string; valor: number; extra: string; neg?: boolean }>;
  negativo?: boolean;
}) {
  const max = Math.max(...items.map((i) => Math.abs(i.valor)), 1);
  return (
    <section className="card ads-barras">
      <h3 className="card-title">{titulo}</h3>
      {notas ? <p className="muted small">{notas}</p> : null}
      {items.length === 0 ? <p className="muted">Sin datos en esta ventana.</p> : null}
      {items.map((i) => (
        <div key={i.id} className="ads-barra-item">
          <div className="ads-barra-texto">
            <span className="ads-barra-nombre" title={i.label}>{i.label}</span>
            <span className={`ads-barra-valor${i.neg || negativo ? " malo" : ""}`}>{i.extra}</span>
          </div>
          <div className={`barra${i.neg || negativo ? " neg" : ""}`}>
            <i style={{ width: `${Math.max(4, (Math.abs(i.valor) / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </section>
  );
}

export function Resumen({ datos }: { datos: Datos }) {
  const t = datos.totales;

  const reparto = CLASES.map((c) => ({ clase: c, n: datos.conteos[c] ?? 0 }));
  const total = reparto.reduce((a, r) => a + r.n, 0);
  const divisor = Math.max(1, total);
  let acumulado = 0;
  const dona = reparto
    .filter((r) => r.n > 0)
    .map((r) => {
      const desde = (acumulado / divisor) * 360;
      acumulado += r.n;
      const hasta = (acumulado / divisor) * 360;
      return `${COLOR[r.clase]} ${desde}deg ${hasta}deg`;
    })
    .join(", ");

  const perdidas = datos.campanas
    .filter((c) => c.clase === "PERDIDA")
    .sort((a, b) => (a.neto ?? 0) - (b.neto ?? 0))
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      label: c.nombre,
      valor: c.neto ?? 0,
      extra: `${dinero(c.neto)} · ${c.compras} compras`,
      neg: true,
    }));

  const gasto = [...datos.campanas]
    .sort((a, b) => b.gasto - a.gasto)
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      label: c.nombre,
      valor: c.gasto,
      extra: `${dinero(c.gasto)} · ROI ${veces(c.roi)}`,
    }));

  // campañas que siguen gastando en los ultimos 7 dias sin una sola compra
  const sinCompras = datos.campanas
    .filter((c) => c.gasto7 > 0 && c.compras7 === 0)
    .sort((a, b) => b.gasto7 - a.gasto7)
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      label: c.nombre,
      valor: c.gasto7,
      extra: `${dinero(c.gasto7)} gastados sin comprar`,
      neg: true,
    }));

  const recientes = datos.campanas
    .filter((c) => {
      if (!c.creada) return false;
      const limite = new Date(`${datos.ventana.hasta}T00:00:00`);
      limite.setDate(limite.getDate() - 6);
      return new Date(`${c.creada}T00:00:00`) >= limite;
    })
    .sort((a, b) => b.gasto - a.gasto)
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      label: c.nombre,
      valor: c.gasto,
      extra: `${c.diasActivos} días · ${dinero(c.gasto)} · ROI ${veces(c.roi)}`,
    }));

  return (
    <>
      <div className="stat-grid ads-kpis">
        <Kpi
          label={`Gasto (${datos.ventana.dias} días)`}
          valor={dinero(t.gasto)}
          ayuda={`${dinero(t.gasto7)} de ellos en los ultimos 7 dias`}
        />
        <Kpi
          label="Compras (Meta)"
          valor={t.compras.toLocaleString("es-CO")}
          ayuda={`${t.compras7} compras atribuidas en los ultimos 7 dias`}
        />
        <Kpi
          label="CPA"
          valor={dinero(t.cpa)}
          ayuda="Costo por compra = gasto / compras"
        />
        <Kpi
          label="Margen estimado"
          valor={dinero(t.margen)}
          ayuda={`Compras × ganancia por entregado × efectividad de entrega (${pct(datos.entrega.tasa)})`}
        />
        <Kpi
          label="Neto estimado"
          valor={dinero(t.neto)}
          tono={t.neto >= 0 ? "ok" : "malo"}
          ayuda={`Margen estimado − gasto de las campañas que se pueden medir (${dinero(t.gastoMedido)})`}
        />
        <Kpi
          label="ROI"
          valor={veces(t.roi)}
          tono={t.roi >= 3 ? "ok" : t.roi < 1.5 ? "malo" : undefined}
          ayuda="Margen estimado / gasto. Rentable >= 3x · Ajustada 1.5-3x · Riesgo < 1.5x"
        />
        <Kpi
          label="Efectividad de entrega"
          valor={pct(datos.entrega.tasa)}
          tono={datos.entrega.origen === "sin datos" ? "malo" : undefined}
          ayuda={
            datos.entrega.origen === "manual"
              ? "Fijada a mano en la pestaña Productos"
              : datos.entrega.origen === "pedidos"
                ? `${datos.entrega.entregados} entregados de ${datos.entrega.entregados + datos.entrega.fallidos + (datos.entrega.contarSinEnvio ? datos.entrega.sinEnvio : 0)} pedidos ya cerrados`
                : "Sin datos de entregas: se supone 100% (trae las ganancias de los pedidos)"
          }
        />
      </div>

      {t.gastoSinDato > 0 ? (
        <div className="banner warn">
          <strong>{dinero(t.gastoSinDato)}</strong> de gasto no se puede medir
          {t.campanasSinProducto ? ` · ${t.campanasSinProducto} campaña(s) sin producto vinculado` : ""}
          {t.campanasSinGanancia ? ` · ${t.campanasSinGanancia} con productos sin ganancia` : ""}. No
          entra en el neto ni en el ROI: vincúlalas en <em>Campañas</em> y completa la ganancia en{" "}
          <em>Productos</em>.
        </div>
      ) : null}

      <div className="grid-2">
        <section className="card ads-dona-tarjeta">
          <h3 className="card-title">
            {total} campañas · {datos.conteos.PERDIDA ?? 0} en pérdida
          </h3>
          <div className="ads-dona-fila">
            <div
              className="ads-dona"
              style={{
                background: dona
                  ? `conic-gradient(${dona})`
                  : "conic-gradient(#e2e8f0 0deg 360deg)",
              }}
            >
              <span className="ads-dona-centro">
                <strong>{total}</strong>
                <small>campañas</small>
              </span>
            </div>
            <ul className="ads-leyenda">
              {reparto.map((r) => (
                <li key={r.clase}>
                  <i style={{ background: COLOR[r.clase] }} />
                  <span>{ETIQUETAS[r.clase]}</span>
                  <strong>{r.n}</strong>
                </li>
              ))}
            </ul>
          </div>
          <p className="muted small">
            {datos.conteos.SINDATO
              ? `${datos.conteos.SINDATO} campaña(s) sin producto o sin ganancia: no se pueden medir.`
              : "Todas las campañas tienen producto y ganancia."}
          </p>
          {t.perdidas < 0 ? (
            <p className="ads-perdida-resumen">
              <strong>{dinero(t.perdidas)}</strong> perdidos en la ventana (~
              {dinero(t.perdidasDia)} por día)
            </p>
          ) : null}
        </section>

        <Barra
          titulo="Pérdidas del periodo"
          notas="Lo que están costando de más las campañas en rojo."
          items={perdidas}
          negativo
        />
      </div>

      <div className="grid-2">
        <Barra titulo="Dónde se va el gasto" items={gasto} />
        <Barra
          titulo="Gastando 7 días sin comprar"
          notas="Sigue encendidas pero Meta no le atribuye ni una compra."
          items={sinCompras}
          negativo
        />
        <Barra
          titulo="Recién arrancadas (7 días)"
          notas={`Menos de 7 días de datos: interpretar con cuidado · generado ${haceCuanto(datos.generado)}`}
          items={recientes}
        />
      </div>
    </>
  );
}
