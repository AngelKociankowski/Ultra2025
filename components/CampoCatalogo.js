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
  // Acepta una lista de textos —zonas, asesores, turnos— o de pares con
  // etiqueta propia, que es lo que necesitan los esquemas de facturación:
  // se guarda MES_VENCIDO y en pantalla dice «Mes vencido».
  const items = (opciones || []).map((o) => (typeof o === 'string' ? { valor: o, etiqueta: o } : o));
  const fuera = actual && !items.some((o) => o.valor === actual);
  return (
    <select id={id} value={actual} onChange={(e) => onChange(e.target.value)} className={className} {...resto}>
      <option value="">{vacio}</option>
      {items.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.etiqueta}
        </option>
      ))}
      {fuera && <option value={actual}>{actual} (fuera de catálogo)</option>}
    </select>
  );
}
