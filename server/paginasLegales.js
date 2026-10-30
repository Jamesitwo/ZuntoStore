// Paginas publicas que pide Meta para poner una app en modo publico:
//   /privacidad       politica de tratamiento de datos (Ley 1581 de 2012)
//   /eliminar-datos   como pedir que se borren los datos
//
// El nombre del responsable y el correo de contacto salen de las variables
// LEGAL_NOMBRE y LEGAL_EMAIL (Railway); sin correo se indica WhatsApp.
const esc = (t) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function plantilla(titulo, cuerpo, { nombre }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} · ${esc(nombre)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f7f7f8; color: #3f3f46; font: 16px/1.6 "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
  .tarjeta { background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 28px 24px; }
  h1 { font-size: 28px; line-height: 1.25; margin: 0 0 4px; color: #18181b; }
  h2 { font-size: 18px; margin: 28px 0 6px; color: #18181b; }
  .sub { color: #71717a; margin: 0 0 20px; font-size: 14px; }
  a { color: #7100db; }
  ul, ol { padding-left: 22px; }
  li { margin: 4px 0; }
  footer { text-align: center; color: #a1a1aa; font-size: 13px; margin-top: 20px; }
</style>
</head>
<body>
<main>
<div class="tarjeta">
${cuerpo}
</div>
<footer>${esc(nombre)} · <a href="/privacidad">Política de privacidad</a> · <a href="/eliminar-datos">Eliminar mis datos</a></footer>
</main>
</body>
</html>`;
}

function contacto({ email }) {
  return email
    ? `al correo <a href="mailto:${esc(email)}">${esc(email)}</a>`
    : "por el mismo chat de WhatsApp en el que hiciste tu pedido";
}

export function paginaPrivacidad({ nombre = "Zunto Store", email = "", actualizado = "29 de octubre de 2026" } = {}) {
  const n = esc(nombre);
  return plantilla(
    "Política de privacidad",
    `<h1>Política de tratamiento de datos personales</h1>
<p class="sub">${n} · Última actualización: ${esc(actualizado)}</p>

<p>${n} es una tienda en línea colombiana. Esta política explica qué datos personales tratamos, para qué y cómo puedes ejercer tus derechos, de acuerdo con la Ley 1581 de 2012 y el Decreto 1377 de 2013.</p>

<h2>Responsable</h2>
<p>${n}. Contacto para temas de datos personales: ${contacto({ email })}.</p>

<h2>Qué datos tratamos</h2>
<ul>
  <li><strong>Clientes:</strong> nombre, teléfono, dirección de entrega, ciudad y departamento, y los mensajes que nos envías por WhatsApp sobre tu pedido.</li>
  <li><strong>Pedidos:</strong> productos, valores, estado del envío y número de guía.</li>
  <li><strong>Publicidad:</strong> métricas agregadas de nuestras campañas en Meta (Facebook e Instagram), como gasto, alcance y conversaciones. No recibimos datos personales de las personas que ven los anuncios.</li>
</ul>

<h2>Para qué los usamos</h2>
<ul>
  <li>Confirmar, preparar y enviar tus pedidos con la transportadora.</li>
  <li>Responderte por WhatsApp y darte información del estado de tu envío.</li>
  <li>Atender garantías, cambios y devoluciones.</li>
  <li>Crear y medir nuestras campañas publicitarias en Meta.</li>
</ul>

<h2>Con quién los compartimos</h2>
<p>Solo con quienes nos ayudan a prestar el servicio: la plataforma de la tienda y del chat, el proveedor logístico y las transportadoras (para entregarte el pedido), y Meta (para nuestras campañas). No vendemos tus datos.</p>

<h2>Tus derechos</h2>
<p>Puedes conocer, actualizar y rectificar tus datos, pedir prueba de la autorización, saber cómo los usamos, revocar la autorización y pedir que los eliminemos, ${contacto({ email })}. Respondemos las consultas en máximo 10 días hábiles y los reclamos en máximo 15 días hábiles. Si no quedas conforme, puedes acudir a la Superintendencia de Industria y Comercio.</p>

<h2>Cuánto tiempo los guardamos</h2>
<p>Mientras sean necesarios para tu pedido, la garantía y nuestras obligaciones legales y contables. Después los eliminamos o anonimizamos.</p>

<h2>Seguridad</h2>
<p>Guardamos la información en servidores con acceso restringido y las claves de las integraciones van cifradas.</p>

<h2>Eliminar tus datos</h2>
<p>Mira cómo pedirlo en <a href="/eliminar-datos">Eliminar mis datos</a>.</p>`,
    { nombre },
  );
}

export function paginaEliminarDatos({ nombre = "Zunto Store", email = "" } = {}) {
  const n = esc(nombre);
  return plantilla(
    "Eliminar mis datos",
    `<h1>Cómo pedir que eliminemos tus datos</h1>
<p class="sub">${n}</p>

<p>Puedes pedir en cualquier momento que borremos tus datos personales (nombre, teléfono, dirección, mensajes y pedidos).</p>

<ol>
  <li>Escríbenos ${contacto({ email })} con el asunto <strong>"Eliminar mis datos"</strong>.</li>
  <li>Incluye tu nombre y el número de teléfono con el que hiciste el pedido, para encontrarlo.</li>
  <li>Te confirmamos la eliminación en máximo 15 días hábiles.</li>
</ol>

<p>Guardaremos solo lo que la ley nos obligue a conservar (por ejemplo, soportes contables), y únicamente por el tiempo exigido.</p>

<p>Si interactuaste con nuestros anuncios en Facebook o Instagram, esos datos los maneja Meta: puedes administrarlos en la configuración de tu cuenta de Facebook.</p>`,
    { nombre },
  );
}
