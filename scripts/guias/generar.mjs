/**
 * Convierte las guías en PDF, uno por rol.
 *
 *   node scripts/guias/generar.mjs
 *
 * Usa el navegador que ya viene instalado para imprimir a PDF. Se eligió eso y
 * no una librería de PDF por una razón práctica: el texto queda seleccionable y
 * buscable, los acentos salen bien, y el diseño se escribe en HTML, que es lo
 * que hay que poder ajustar cuando la plataforma cambie.
 *
 * El estilo apunta a alguien que va a imprimir la hoja y tenerla al lado del
 * teclado: letra grande, mucho aire entre pasos, y los nombres de los botones
 * resaltados para poder buscarlos con la vista.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { GUIAS, MARCA } from './contenido.mjs';

const SALIDA = path.join(process.cwd(), 'docs', 'guias');
const LOGO = fs.readFileSync(path.join(process.cwd(), 'public', 'logo-ultra.svg'), 'utf8');
const LOGO_DATA = `data:image/svg+xml;base64,${Buffer.from(LOGO).toString('base64')}`;

const escapar = (s) => String(s).replace(/&(?!#?\w+;)/g, '&amp;');

/** Un bloque de la guía, con la forma que le toque según lo que traiga. */
function seccion(s, color) {
  const partes = [`<h2>${escapar(s.titulo)}</h2>`];
  if (s.intro) partes.push(`<p class="intro">${escapar(s.intro)}</p>`);
  if (s.texto) partes.push(`<p class="regla">${escapar(s.texto)}</p>`);
  if (s.porque) partes.push(`<p class="porque"><span>¿Por qué?</span> ${escapar(s.porque)}</p>`);

  if (s.pasos) {
    // Los pasos que empiezan con negritas son enumeraciones de conceptos, no
    // instrucciones. Se numeran igual: quien sigue la hoja con el dedo no
    // distingue, y lo que importa es no perder el renglón.
    partes.push(`<ol>${s.pasos.map((p) => `<li>${escapar(p)}</li>`).join('')}</ol>`);
  }

  if (s.lista) {
    partes.push(
      `<table class="lista">${s.lista
        .map(([a, b]) => `<tr><td class="q">${escapar(a)}</td><td class="r">${escapar(b)}</td></tr>`)
        .join('')}</table>`
    );
  }

  if (s.aviso) partes.push(`<p class="aviso">${escapar(s.aviso)}</p>`);
  if (s.nota) partes.push(`<p class="nota">${escapar(s.nota)}</p>`);

  return `<section style="--acento:${color}">${partes.join('\n')}</section>`;
}

function documento(g) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Guía — ${g.titulo}</title>
<style>
  @page { size: Letter; margin: 16mm 14mm 18mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1a1a1a; font-size: 11.5pt; line-height: 1.55; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* ---- portada ---- */
  .portada { height: 247mm; display: flex; flex-direction: column; page-break-after: always; }
  .portada .marca { display: flex; align-items: center; gap: 10px; }
  .portada .marca img { width: 42px; height: 42px; }
  .portada .marca b { font-size: 15pt; letter-spacing: .5px; }
  .portada .marca span { display: block; font-size: 7.5pt; letter-spacing: 2.4px; color: #777; font-weight: 400; }
  .portada .centro { margin-top: auto; margin-bottom: auto; }
  .portada .quien {
    display: inline-block; background: ${g.color}; color: #fff; font-size: 10pt;
    padding: 5px 14px; border-radius: 20px; letter-spacing: .6px; text-transform: uppercase;
  }
  .portada h1 { font-size: 34pt; margin: 14px 0 6px; line-height: 1.1; }
  .portada .resumen { font-size: 14pt; color: #444; max-width: 150mm; line-height: 1.45; }
  .portada .pestanas { margin-top: 26px; }
  .portada .pestanas p { font-size: 9.5pt; color: #777; margin: 0 0 7px; }
  .portada .pestanas b {
    display: inline-block; border: 1.4px solid ${g.color}; color: ${g.color};
    border-radius: 6px; padding: 3px 9px; margin: 0 5px 5px 0; font-size: 10pt; font-weight: 600;
  }
  .portada .pie { font-size: 9pt; color: #888; border-top: 1px solid #e2e2e2; padding-top: 8px; }

  /* ---- contenido ---- */
  section { page-break-inside: avoid; margin-bottom: 15px; }
  h2 {
    font-size: 14.5pt; margin: 0 0 7px; padding-left: 10px;
    border-left: 4px solid var(--acento); line-height: 1.25;
  }
  p { margin: 0 0 8px; }
  .intro { color: #444; }
  ol { margin: 6px 0 8px; padding-left: 0; list-style: none; counter-reset: paso; }
  ol li {
    counter-increment: paso; position: relative; padding: 3px 0 3px 30px; margin-bottom: 3px;
  }
  ol li::before {
    content: counter(paso); position: absolute; left: 0; top: 3px;
    width: 21px; height: 21px; border-radius: 50%; background: var(--acento); color: #fff;
    font-size: 9.5pt; font-weight: 700; display: flex; align-items: center; justify-content: center;
  }
  b { color: #000; }
  table.lista { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
  table.lista td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  table.lista td.q { width: 47%; font-weight: 600; }
  table.lista td.r { color: #555; }
  .nota, .aviso, .regla, .porque {
    border-radius: 7px; padding: 9px 12px; margin: 8px 0 0; font-size: 10.5pt; line-height: 1.5;
  }
  .nota { background: #f2f4f7; border-left: 3px solid #98a2b3; }
  .aviso { background: #fff6e8; border-left: 3px solid #e79a2b; }
  .regla { background: #fdecea; border-left: 3px solid #E7342B; font-size: 12pt; }
  .porque { background: #f2f4f7; border-left: 3px solid #98a2b3; }
  .porque span { font-weight: 700; }
</style></head>
<body>
  <div class="portada">
    <div class="marca">
      <img src="${LOGO_DATA}" alt="">
      <div><b>ULTRA<span>SEGURIDAD PRIVADA</span></b></div>
    </div>
    <div class="centro">
      <span class="quien">Guía para ${escapar(g.titulo)}</span>
      <h1>Cómo usar la plataforma<br>en tu día a día</h1>
      <p class="resumen">${escapar(g.resumen)}</p>
      <div class="pestanas">
        <p>Las pestañas que vas a ver arriba:</p>
        ${g.pestanas.map((t) => `<b>${escapar(t)}</b>`).join('')}
      </div>
    </div>
    <div class="pie">
      ${MARCA.sistema} · ${MARCA.sitio}<br>
      Si algo no coincide con lo que ves en pantalla, avísale al administrador: la plataforma se sigue mejorando.
    </div>
  </div>
  ${g.secciones.map((s) => seccion(s, g.color)).join('\n')}
</body></html>`;
}

const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pagina = await navegador.newPage();
fs.mkdirSync(SALIDA, { recursive: true });

for (const g of GUIAS) {
  const html = documento(g);
  // Se guarda también el HTML. No es un sobrante: es lo que permite revisar el
  // diseño sin abrir el PDF, y sirve para quien prefiera leerlo en pantalla.
  fs.writeFileSync(path.join(SALIDA, `Guia-${g.titulo.replace(/\s+/g, '-')}.html`), html);
  await pagina.setContent(html, { waitUntil: 'load' });
  const archivo = path.join(SALIDA, `Guia-${g.titulo.replace(/\s+/g, '-')}.pdf`);
  await pagina.pdf({
    path: archivo,
    format: 'Letter',
    printBackground: true,
    margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-size:8pt;color:#999;padding:0 14mm;display:flex;justify-content:space-between;">
      <span>${MARCA.empresa} · Guía para ${g.titulo}</span>
      <span class="pageNumber"></span>
    </div>`,
  });
  const kb = Math.round(fs.statSync(archivo).size / 1024);
  console.log(`· ${path.basename(archivo)} (${kb} KB)`);
}

await navegador.close();
console.log(`\n${GUIAS.length} guías en docs/guias/`);
