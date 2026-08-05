import Link from 'next/link';

/**
 * El número de factura del mes, y el papel detrás si lo hay.
 *
 * Antes esta columna era una palomita: decía «sí está facturado» y ahí se
 * acababa. La pregunta que sigue —«¿con qué número?, ¿me lo enseñas?»— había
 * que ir a buscarla a otro lado, y el dato ya estaba capturado.
 *
 * Tres estados, y cada uno lleva a donde toca:
 *   - Emitida aquí y con PDF -> se abre el PDF.
 *   - Con número pero sin papel -> lleva a la cobranza del servicio, que es
 *     donde se sube.
 *   - Sin nada -> lleva a emitirla.
 */
export default function CeldaFactura({ servicioId, factura, historico, importe }) {
  const base = 'inline-block text-xs rounded-lg px-2 py-1 border whitespace-nowrap max-w-[150px] truncate';

  if (factura?.archivo) {
    return (
      <a
        href={`/api/facturas/${factura.id}/archivo`}
        title={`Abrir ${factura.archivo_nombre || 'la factura'}`}
        className={`${base} bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25`}
      >
        📄 {factura.folio || 'Ver factura'}
      </a>
    );
  }

  if (factura) {
    return (
      <Link
        href={`/estado-fuerza/${servicioId}#cobranza`}
        title="Emitida en la plataforma, pero todavía sin el PDF adjunto"
        className={`${base} bg-slate-700/60 text-slate-300 border-slate-600/60 hover:bg-slate-700`}
      >
        {factura.folio || 'Emitida'}
        <span className="block text-[10px] text-slate-500 leading-tight">falta el PDF</span>
      </Link>
    );
  }

  if (historico?.numero) {
    return (
      <Link
        href={`/estado-fuerza/${servicioId}#cobranza`}
        title={`Número anotado en el corte de ${historico.periodo}. Viene del archivo, así que no tiene PDF en la plataforma.`}
        className={`${base} bg-slate-700/40 text-slate-400 border-slate-700 hover:bg-slate-700/70`}
      >
        {historico.numero}
        <span className="block text-[10px] text-slate-500 leading-tight">del corte {historico.periodo}</span>
      </Link>
    );
  }

  return (
    <Link
      href={servicioId ? `/estado-fuerza/${servicioId}#cobranza` : '/cobranza'}
      title="Todavía no se le ha emitido factura este mes"
      className={`${base} bg-transparent text-slate-500 border-slate-700/60 hover:text-cyan-400`}
    >
      Sin factura
    </Link>
  );
}
