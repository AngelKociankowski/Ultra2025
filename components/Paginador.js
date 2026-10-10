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
   * Los números que se enseñan: una tira de siete alrededor de la actual, más la
   * primera y la última.
   *
   * La versión anterior enseñaba las dos primeras, las dos últimas y la vecindad
   * inmediata, y con once páginas eso dejaba «Anterior 1 2 … 10 11 Siguiente»:
   * cuatro números de once, y las páginas 3 a 9 solo alcanzables dando
   * «Siguiente» siete veces o escribiendo la URL a mano. Con siete seguidos se
   * llega a casi cualquier página de un clic, y la tira se desplaza al avanzar.
   * Con pocas páginas salen todas, que es el caso de hoy.
   */
  const ANCHO = 7;
  const inicio = Math.max(1, Math.min(pagina - Math.floor(ANCHO / 2), paginas - ANCHO + 1));
  const fin = Math.min(paginas, inicio + ANCHO - 1);

  const numeros = [];
  if (inicio > 1) {
    numeros.push(1);
    // El «…» solo cuando de verdad se salta algo: con un hueco de una página
    // sería más corto enseñar la página que los puntos.
    if (inicio > 3) numeros.push('…');
    else if (inicio === 3) numeros.push(2);
  }
  for (let n = inicio; n <= fin; n++) numeros.push(n);
  if (fin < paginas) {
    if (fin < paginas - 2) numeros.push('…');
    else if (fin === paginas - 2) numeros.push(paginas - 1);
    numeros.push(paginas);
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
