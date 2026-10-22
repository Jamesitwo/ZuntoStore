import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { errMsg } from "../api/client";
import { pedidos } from "../api/endpoints";
import { ErrorBanner, JsonView, PageHeader, money } from "../components/ui";
import { Combo, type OpcionCombo } from "../components/Combo";
import { StockDropi } from "../components/StockDropi";
import { LocationPicker, type Ubicacion } from "../components/LocationPicker";
import { useToast } from "../components/Toast";
import { prodId, prodImg, prodName, prodPrice, useCatalogo } from "../lib/catalogo";
import { useEtiquetaTienda } from "../lib/tiendas";

interface Linea {
  product_id: string;
  price: number;
  quantity: number;
  variations: any[];
}

const num = (v: unknown, f = 0) => {
  const n = Number(v);
  return Number.isNaN(n) ? f : n;
};

export function PedidoCrearPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const etiqueta = useEtiquetaTienda();
  const idEmpresa = session!.tiendaActiva;

  const [form, setForm] = useState({
    nombreCliente: "",
    apellidoCliente: "",
    emailCliente: "",
    telefonoCliente: "",
    direccionCliente: "",
    codigoPostal: "",
    nitCliente: "",
    Referencias: "",
    costoEnvio: 0,
  });
  const [ubicacion, setUbicacion] = useState<Ubicacion>({ pais: 47, departamento: null, ciudad: null });
  const [lineas, setLineas] = useState<Linea[]>([
    { product_id: "", price: 0, quantity: 1, variations: [] },
  ]);
  const { catalogo, cargando: catalogoCargando } = useCatalogo(idEmpresa);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [respuesta, setRespuesta] = useState<unknown>(null);

  const set = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));

  const totales = useMemo(() => {
    const sub = lineas.reduce((acc, l) => acc + num(l.price) * num(l.quantity, 1), 0);
    return { sub, total: sub + num(form.costoEnvio) };
  }, [lineas, form.costoEnvio]);

  const setLinea = (i: number, patch: Partial<Linea>) =>
    setLineas((arr) => arr.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const seleccionarProducto = (i: number, clave: string) => {
    if (!clave) {
      // la X del combo: quita la linea sin borrar precio/cantidad
      setLinea(i, { product_id: "" });
      return;
    }
    const p = catalogo.find((c) => prodId(c) === clave);
    if (p) {
      setLinea(i, { product_id: prodId(p), price: prodPrice(p) });
    } else {
      setLinea(i, { product_id: clave });
    }
  };

  /** Opciones del combo: catalogo + precio a la derecha, y el id actual si no esta. */
  const opcionesProducto = (valorActual: string) => {
    const base: OpcionCombo[] = catalogo.map((p) => {
      const precio = prodPrice(p);
      return {
        id: prodId(p),
        nombre: prodName(p),
        nota: precio ? money(precio) : undefined,
        img: prodImg(p) || undefined,
      };
    });
    if (valorActual && !base.some((o) => o.id === valorActual)) {
      base.unshift({ id: valorActual, nombre: `${valorActual} (id actual)` });
    }
    return base;
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    setRespuesta(null);
    try {
      const json = JSON.stringify(
        lineas
          .filter((l) => l.product_id !== "")
          .map((l) => ({
            product_id: String(l.product_id),
            price: num(l.price),
            variations: l.variations ?? [],
            quantity: num(l.quantity, 1),
          })),
      );

      const body = {
        idEmpresa,
        nombreCliente: form.nombreCliente,
        apellidoCliente: form.apellidoCliente,
        emailCliente: form.emailCliente,
        telefonoCliente: form.telefonoCliente,
        direccionCliente: form.direccionCliente,
        ciudadCliente: num(ubicacion.ciudad),
        departamentoCliente: num(ubicacion.departamento),
        paisCliente: num(ubicacion.pais),
        codigoPostal: form.codigoPostal ? form.codigoPostal : null,
        nitCliente: form.nitCliente,
        json,
        subTotal: totales.sub,
        costoEnvio: num(form.costoEnvio),
        total: totales.total,
        Referencias: form.Referencias,
      };

      const res = await pedidos.create(body);
      setRespuesta(res);
      if (res && (res.ok === false || res.success === false)) {
        setError(res.msg || "La API rechazo el pedido");
        toast.error(res.msg || "La API rechazo el pedido");
      } else {
        toast.success("Pedido creado correctamente");
        navigate("/pedidos");
        return;
      }
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Nuevo pedido"
        subtitle={etiqueta(idEmpresa)}
        actions={
          <Link className="btn" to="/pedidos">
            ← Cancelar
          </Link>
        }
      />

      <ErrorBanner error={error} />

      <form onSubmit={enviar}>
        <section className="card">
          <div className="card-title">Cliente</div>
          <div className="form-grid">
            <div className="field">
              <label>Nombre *</label>
              <input
                required
                value={form.nombreCliente}
                onChange={(e) => set("nombreCliente", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Apellido *</label>
              <input
                required
                value={form.apellidoCliente}
                onChange={(e) => set("apellidoCliente", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Telefono</label>
              <input
                value={form.telefonoCliente}
                onChange={(e) => set("telefonoCliente", e.target.value)}
                placeholder="+573001234567"
              />
            </div>
            <div className="field">
              <label>Correo</label>
              <input
                type="email"
                value={form.emailCliente}
                onChange={(e) => set("emailCliente", e.target.value)}
              />
            </div>
            <div className="field">
              <label>NIT</label>
              <input value={form.nitCliente} onChange={(e) => set("nitCliente", e.target.value)} />
            </div>
            <div className="field">
              <label>Referencias</label>
              <input value={form.Referencias} onChange={(e) => set("Referencias", e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>Direccion *</label>
            <input
              required
              value={form.direccionCliente}
              onChange={(e) => set("direccionCliente", e.target.value)}
            />
          </div>

          <div className="form-grid">
            <LocationPicker value={ubicacion} onChange={setUbicacion} />
            <div className="field">
              <label>Codigo postal</label>
              <input
                value={form.codigoPostal}
                onChange={(e) => set("codigoPostal", e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-title">Productos</div>
          {catalogoCargando && <p className="muted">Cargando catalogo...</p>}

          {lineas.map((l, i) => (
            <div className="row gap" key={i} style={{ marginBottom: 8, flexWrap: "wrap" }}>
              {catalogo.length > 0 ? (
                <Combo
                  className="combo-inline"
                  placeholder="-- Seleccionar producto --"
                  opciones={opcionesProducto(l.product_id)}
                  valor={l.product_id}
                  onChange={(id) => seleccionarProducto(i, id ?? "")}
                />
              ) : (
                <input
                  placeholder="product_id"
                  value={l.product_id}
                  onChange={(e) => setLinea(i, { product_id: e.target.value })}
                  style={{ minWidth: 150, flex: 2 }}
                />
              )}
              <StockDropi
                productId={l.product_id}
                fila={catalogo.find((p) => prodId(p) === l.product_id)}
              />
              {String(l.product_id ?? "").trim() ? (
                <Link
                  className="link-plain"
                  title="Abrir este producto"
                  to={`/productos?editar=${encodeURIComponent(String(l.product_id))}`}
                >
                  → Ver producto
                </Link>
              ) : null}
              <input
                type="number"
                step="0.01"
                title="Precio"
                placeholder="Precio"
                value={l.price}
                onChange={(e) => setLinea(i, { price: Number(e.target.value) })}
                style={{ maxWidth: 140 }}
              />
              <input
                type="number"
                title="Cantidad"
                placeholder="Cant."
                value={l.quantity}
                onChange={(e) => setLinea(i, { quantity: Number(e.target.value) })}
                style={{ maxWidth: 90 }}
              />
              <button
                type="button"
                className="btn sm danger"
                onClick={() => setLineas((arr) => arr.filter((_, idx) => idx !== i))}
              >
                Quitar
              </button>
            </div>
          ))}

          <button
            type="button"
            className="btn sm"
            onClick={() => setLineas((arr) => [...arr, { product_id: "", price: 0, quantity: 1, variations: [] }])}
          >
            + Agregar linea
          </button>

          <div className="form-grid" style={{ marginTop: 16 }}>
            <div className="field">
              <label>Costo de envio</label>
              <input
                type="number"
                step="0.01"
                value={form.costoEnvio}
                onChange={(e) => set("costoEnvio", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Subtotal</label>
              <input value={totales.sub.toFixed(2)} disabled />
            </div>
            <div className="field">
              <label>Total</label>
              <input value={totales.total.toFixed(2)} disabled />
            </div>
          </div>
        </section>

        <div className="row gap">
          <button className="btn primary" type="submit" disabled={sending}>
            {sending ? "Creando..." : "Crear pedido"}
          </button>
          <Link className="btn ghost" to="/pedidos">
            Volver
          </Link>
        </div>

        <JsonView data={respuesta} />
      </form>
    </>
  );
}
