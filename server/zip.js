// ZIP sencillo (sin comprimir, metodo "store") para descargar varios archivos
// de una vez. Las imagenes y videos ya vienen comprimidos: comprimirlos otra
// vez no ahorra casi nada.
import zlib from "node:zlib";

const crc32 = (buf) => zlib.crc32(buf) >>> 0;

/** Fecha/hora en formato DOS (la que usa ZIP). */
function fechaDos(d = new Date()) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, dia };
}

/**
 * @param {Array<{nombre: string, datos: Buffer|string}>} archivos
 * @returns {Buffer}
 */
export function crearZip(archivos) {
  const partes = [];
  const centrales = [];
  let offset = 0;
  const { hora, dia } = fechaDos();
  for (const a of archivos) {
    const nombre = Buffer.from(String(a.nombre), "utf8");
    const datos = Buffer.isBuffer(a.datos) ? a.datos : Buffer.from(String(a.datos ?? ""), "utf8");
    const crc = crc32(datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nombre, datos);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(dia, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(datos.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(offset, 42);
    centrales.push(central, nombre);
    offset += 30 + nombre.length + datos.length;
  }
  const tamCentral = centrales.reduce((n, b) => n + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(tamCentral, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...partes, ...centrales, fin]);
}
