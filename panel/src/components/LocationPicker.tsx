import { useEffect, useState } from "react";
import { errMsg, pickArray } from "../api/client";
import { tools } from "../api/endpoints";
import { Combo, type OpcionCombo } from "./Combo";

export interface Ubicacion {
  pais: number | null;
  departamento: number | null;
  ciudad: number | null;
}

function idOf(x: any): number | string | null {
  if (x === null || x === undefined) return null;
  const v = x.id ?? x.ID ?? x.Id ?? x.idPais ?? x.idState ?? x.idState ?? x.value ?? x.codigo;
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : n;
}

function nameOf(x: any): string {
  if (x === null || x === undefined) return "";
  const v = x.name ?? x.Name ?? x.nombre ?? x.Nombre ?? x.descripcion ?? x.Descripcion ?? x.label;
  if (v !== undefined && v !== null) return String(v);
  const id = idOf(x);
  return id === null ? "" : String(id);
}

/** [{id, nombre}] para el Combo, conservando el orden del catalogo. */
function aOpciones(lista: any[]): OpcionCombo[] {
  return lista.map((x, i) => {
    const id = String(idOf(x) ?? "");
    return { id, nombre: nameOf(x) || id || `#${i}` };
  });
}

/**
 * Selects en cascada pais -> departamento -> ciudad usando
 * /tools/getCountries, /tools/getCountryState y /tools/getStateCity.
 *
 * Departamento y ciudad van con <Combo> (escribes y la lista se filtra): el
 * panel oficial usa `<select>` y con mas de 1000 municipios buscar a ojo es
 * un suplicio. Si un catalogo no carga, se puede escribir el id a mano.
 */
export function LocationPicker({
  value,
  onChange,
}: {
  value: Ubicacion;
  onChange: (v: Ubicacion) => void;
}) {
  const [paises, setPaises] = useState<any[]>([]);
  const [estados, setEstados] = useState<any[]>([]);
  const [ciudades, setCiudades] = useState<any[]>([]);
  const [cargandoPaises, setCargandoPaises] = useState(true);
  const [cargandoEstados, setCargandoEstados] = useState(false);
  const [cargandoCiudades, setCargandoCiudades] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    tools
      .countries()
      .then((res) => vivo && setPaises(pickArray(res, ["countries", "paises", "data", "countriesList"])))
      .catch((e) => vivo && setErr(errMsg(e)))
      .finally(() => vivo && setCargandoPaises(false));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    let vivo = true;
    setEstados([]);
    setCiudades([]);
    if (!value.pais) {
      setCargandoEstados(false);
      return;
    }
    setCargandoEstados(true);
    tools
      .states(value.pais)
      .then((res) => vivo && setEstados(pickArray(res, ["states", "departamentos", "data"])))
      .catch((e) => vivo && setErr(errMsg(e)))
      .finally(() => vivo && setCargandoEstados(false));
    return () => {
      vivo = false;
    };
  }, [value.pais]);

  useEffect(() => {
    let vivo = true;
    setCiudades([]);
    if (!value.departamento) {
      setCargandoCiudades(false);
      return;
    }
    setCargandoCiudades(true);
    tools
      .cities(value.departamento)
      .then((res) => vivo && setCiudades(pickArray(res, ["cities", "ciudades", "data"])))
      .catch((e) => vivo && setErr(errMsg(e)))
      .finally(() => vivo && setCargandoCiudades(false));
    return () => {
      vivo = false;
    };
  }, [value.departamento]);

  const manual = paises.length === 0 && !cargandoPaises;

  return (
    <>
      <div className="field">
        <label>Pais</label>
        {manual ? (
          <input
            type="number"
            placeholder="ej. 47"
            value={value.pais ?? ""}
            onChange={(e) =>
              onChange({ pais: e.target.value ? Number(e.target.value) : null, departamento: null, ciudad: null })
            }
          />
        ) : (
          <select
            value={value.pais ?? ""}
            onChange={(e) =>
              onChange({
                pais: e.target.value ? Number(e.target.value) : null,
                departamento: null,
                ciudad: null,
              })
            }
          >
            <option value="">Selecciona...</option>
            {paises.map((p, i) => (
              <option key={i} value={String(idOf(p) ?? "")}>
                {nameOf(p)}
              </option>
            ))}
          </select>
        )}
      </div>

      {estados.length > 0 ? (
        <Combo
          label="Departamento / Estado"
          opciones={aOpciones(estados)}
          valor={value.departamento !== null && value.departamento !== undefined ? String(value.departamento) : ""}
          cargando={cargandoEstados}
          placeholder="Escribe para buscar el departamento..."
          onChange={(id) =>
            onChange({
              ...value,
              departamento: id === null ? null : Number(id),
              ciudad: null,
            })
          }
        />
      ) : (
        <div className="field">
          <label>{cargandoEstados || manual || !value.pais ? "Departamento / Estado" : "Departamento / Estado (id)"}</label>
          <input
            type="number"
            placeholder={
              cargandoEstados
                ? "Cargando departamentos..."
                : !value.pais
                  ? "Elige un pais primero"
                  : "ej. 2"
            }
            disabled={cargandoEstados || !value.pais}
            value={value.departamento ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                departamento: e.target.value ? Number(e.target.value) : null,
                ciudad: null,
              })
            }
          />
        </div>
      )}

      {ciudades.length > 0 ? (
        <Combo
          label="Ciudad / Municipio"
          opciones={aOpciones(ciudades)}
          valor={value.ciudad !== null && value.ciudad !== undefined ? String(value.ciudad) : ""}
          cargando={cargandoCiudades}
          placeholder="Escribe para buscar la ciudad..."
          onChange={(id) => onChange({ ...value, ciudad: id === null ? null : Number(id) })}
        />
      ) : (
        <div className="field">
          <label>{cargandoCiudades || !value.departamento ? "Ciudad / Municipio" : "Ciudad / Municipio (id)"}</label>
          <input
            type="number"
            placeholder={
              cargandoCiudades
                ? "Cargando ciudades..."
                : !value.departamento
                  ? "Elige un departamento primero"
                  : "ej. 71"
            }
            disabled={cargandoCiudades || !value.departamento}
            value={value.ciudad ?? ""}
            onChange={(e) => onChange({ ...value, ciudad: e.target.value ? Number(e.target.value) : null })}
          />
        </div>
      )}

      {err && <p className="muted small">{err} — ingresa los IDs manualmente.</p>}
    </>
  );
}
