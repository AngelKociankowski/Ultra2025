import Link from 'next/link';

/**
 * Páginas para una lista que ya está completa en memoria.
 *
 * La pantalla del estado de fuerza dibujaba los 217 renglones de un tirón y
 * había que recorrer veinte pantallas para llegar al final. Pero el arreglo
 * tiene una trampa conocida, y es la razón de que este componente no consulte
 * nada: **se pagina al dibujar, no al consultar**. Si la página pidiera a SQL
 * solo cincuenta filas, el encabezado diría «50 servicios · 212 guardias» y las
 * dos cifras serían mentira; quien entra a mirar cuántos guardias hay en la
 * calle leería el total de una página. Así que la pantalla recibe la lista
 * entera, saca de ahí los totales y el reparto por turno, y solo recorta el
 * trozo que va a pintar.
 *
 * Conserva todos los parámetros de la URL menos `pagina`, para que paginar
 * dentro de un filtro no lo pierda, y para que el enlace se pueda pegar en un
 * correo y abra lo mismo.
 */

/**
 * El trozo de la lista que toca dibujar, con la página ya acotada.
 *
 * La página fuera de rango se trae a la última válida en vez de devolver una
 * tabla vacía. Un `?pagina=99` no es un error del que haya que avisar: es un
 * enlace viejo, o un filtro que dejó menos páginas de las que había, y lo que
 * quiere quien le dio clic es ver lo que hay.
 */
export function paginar(lista, pedida, porPagina) {
  const total = lista.length;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const pagina = Math.min(Math.max(1, Math.floor(Number(pedida) || 1)), paginas);
  const desde = (pagina - 1) * porPagina;
  return { pagina, paginas, total, desde, filas: lista.slice(desde, desde + porPagina) };
}

export default function Paginador({ ruta, parametros = {}, pagina, porPagina, total }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return null;

  const desde = (pagina - 1) * porPagina + 1;
  const hasta = Math.min(pagina * porPagina, total);

  const enlace = (n) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(parametros)) {
      if (k === 'pagina' || v === undefined || v === null || v === '') continue;
      params.set(k, String(v));
    }
    if (n > 1) params.set('pagina', String(n));
    const q = params.toString();
    return q ? `${ruta}?${q}` : ruta;
  };

  /**
   * Los números que se enseñan: las dos primeras, las dos últimas y la vecindad
   * de la actual. Con cinco páginas salen las cinco; el recorte está para el día
   * que la lista crezca y no para hoy.
   */
  const numeros = [];
  for (let n = 1; n <= paginas; n++) {
    if (n <= 2 || n > paginas - 2 || Math.abs(n - pagina) <= 1) numeros.push(n);
    else if (numeros[numeros.length - 1] !== '…') numeros.push('…');
  }

  const boton = 'text-xs rounded-lg px-2.5 py-1.5 border';
  const apagado = `${boton} border-slate-700/50 text-slate-600`;
  const normal = `${boton} border-slate-700 text-slate-300 hover:bg-slate-700/60 hover:text-white`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-700/50">
      {/* El rango y el total, no «página 3 de 5». Lo que se quiere saber al
          llegar abajo es por dónde va uno de cuántos, no cuántas páginas hay. */}
      <p className="text-xs text-slate-500 tabular-nums">
        {desde} a {hasta} de {total}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {pagina > 1 ? (
          <Link href={enlace(pagina - 1)} className={normal}>
            ← Anterior
          </Link>
        ) : (
          <span className={apagado}>← Anterior</span>
        )}

        {numeros.map((n, i) =>
          n === '…' ? (
            <span key={`hueco-${i}`} className="text-xs text-slate-600 px-1">
              …
            </span>
          ) : n === pagina ? (
            <span key={n} className={`${boton} border-cyan-500/60 bg-cyan-500/15 text-cyan-200 tabular-nums`}>
              {n}
            </span>
          ) : (
            <Link key={n} href={enlace(n)} className={`${normal} tabular-nums`}>
              {n}
            </Link>
          )
        )}

        {pagina < paginas ? (
          <Link href={enlace(pagina + 1)} className={normal}>
            Siguiente →
          </Link>
        ) : (
          <span className={apagado}>Siguiente →</span>
        )}
      </div>
    </div>
  );
}
