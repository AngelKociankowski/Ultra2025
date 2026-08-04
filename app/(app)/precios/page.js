import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import { agenda, historialReciente, ETIQUETA_ESTADO } from '@/lib/precios';
import { opciones } from '@/lib/catalogos';
import { mesActual } from '@/lib/fechas';
import { formatCurrency, formatNumber } from '@/lib/utils';
import Precios from './Precios';

export const dynamic = 'force-dynamic';

function Kpi({ titulo, valor, sub, tono = 'slate' }) {
  const color = {
    slate: 'text-slate-200',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
  }[tono];
  return (
    <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className={`text-xl font-bold ${color}`}>{valor}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function PantallaPrecios({ searchParams }) {
  const usuario = usuarioActual();
  if (!puede(usuario.rol, 'precios')) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold text-white mb-2">Sin permiso</h1>
        <p className="text-slate-400 text-sm">Los precios los mueven ventas, finanzas y el administrador.</p>
        <Link href="/" className="inline-block mt-4 text-sm text-cyan-400 hover:underline">
          ← Volver al tablero
        </Link>
      </div>
    );
  }

  const filtros = {
    estado: searchParams?.estado || '',
    zona: searchParams?.zona || '',
    asesor: searchParams?.asesor || '',
    q: searchParams?.q || '',
  };
  const { servicios, resumen, referencia } = agenda(filtros);
  const cat = opciones();
  const porRevisar = resumen.vencido + resumen.este_mes;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Precios</h1>
        <p className="text-slate-400 text-sm max-w-3xl">
          A cada cliente se le revisa el precio una vez al año, y no a todos en el mismo mes: cada servicio trae el
          suyo. Aquí se ve a quién le toca y se aplica el aumento —a uno o a todos los que escojas— sin abrir ficha
          por ficha.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi
          titulo="Facturación mensual"
          valor={formatCurrency(resumen.facturacionMensual)}
          sub={`${formatNumber(servicios.length)} servicios en la lista`}
        />
        <Kpi
          titulo="Se les pasó"
          valor={formatNumber(resumen.vencido)}
          sub="su mes ya pasó"
          tono={resumen.vencido ? 'red' : 'slate'}
        />
        <Kpi
          titulo="Les toca este mes"
          valor={formatNumber(resumen.este_mes)}
          tono={resumen.este_mes ? 'amber' : 'slate'}
        />
        <Kpi titulo="Ya subieron este año" valor={formatNumber(resumen.al_corriente)} tono="emerald" />
        <Kpi
          titulo="Sin mes anotado"
          valor={formatNumber(resumen.sin_fecha)}
          sub={resumen.sinPrecio ? `${resumen.sinPrecio} sin precio capturado` : 'no se sabe cuándo revisarlos'}
        />
      </div>

      {porRevisar > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
          <p className="text-sm text-amber-300 font-semibold">
            {formatNumber(porRevisar)} servicio{porRevisar === 1 ? '' : 's'} con el aumento pendiente ·{' '}
            {formatCurrency(resumen.importePendiente)} al mes con el precio del año pasado
          </p>
          <p className="text-xs text-amber-400 mt-0.5 max-w-3xl">
            Un aumento que no se aplica no se nota: la factura sale igual que siempre y el cliente sigue pagando el
            precio del año pasado hasta que alguien lo revisa. Por eso están arriba de la lista.
          </p>
        </div>
      )}

      <Precios
        servicios={servicios}
        filtros={filtros}
        zonas={cat.zonas}
        asesores={cat.asesores}
        etiquetas={ETIQUETA_ESTADO}
        periodo={mesActual()}
        referencia={referencia}
        historial={historialReciente(40)}
      />
    </div>
  );
}
