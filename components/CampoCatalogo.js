'use client';

/**
 * Lista desplegable alimentada por un catálogo.
 *
 * Si el registro trae un valor que ya no está en el catálogo —porque se
 * desactivó, o porque se capturó cuando el campo era texto libre— se agrega
 * como opción marcada en vez de dejarlo fuera. Si no, abrir la pantalla y
 * guardar cualquier otro campo le borraría el dato a ese servicio sin que nadie
 * lo hubiera pedido.
 */
export default function CampoCatalogo({
  id,
  valor,
  opciones,
  onChange,
  vacio = '— sin asignar —',
  className,
  ...resto
}) {
  const actual = valor ?? '';
  const fuera = actual && !opciones.includes(actual);
  return (
    <select id={id} value={actual} onChange={(e) => onChange(e.target.value)} className={className} {...resto}>
      <option value="">{vacio}</option>
      {opciones.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      {fuera && <option value={actual}>{actual} (fuera de catálogo)</option>}
    </select>
  );
}
