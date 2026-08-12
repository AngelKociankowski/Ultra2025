'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';
import CampoCatalogo from '@/components/CampoCatalogo';
import Icono from '@/components/Icono';

const campo =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';
const etiqueta = 'block text-xs text-slate-400 mb-1';

/**
 * Los dos trabajos de una sola vez que hay al arrancar la cobranza.
 *
 * Van juntos y en este orden porque el segundo no funciona sin el primero: sin
 * saber cuándo se factura un servicio no hay fecha de vencimiento que calcular,
 * y sin fecha de vencimiento el saldo no sabe qué está vencido.
 */
export default function PuestaAlDia({ esquemas, formasPago, sinCondiciones, totalActivos, periodo }) {
  const router = useRouter();

  const [cond, setCond] = useState({
    esquema_facturacion: 'MES_VENCIDO',
    dias_credito: '30',
    forma_pago: '',
    alcance: 'sin_condiciones',
  });
  const [resultadoCond, setResultadoCond] = useState(null);

  const [csv, setCsv] = useState('');
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [revision, setRevision] = useState(null);
  const [cargado, setCargado] = useState(null);

  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function llamar(ruta, cuerpo) {
    setOcupado(true);
    setError('');
    try {
      const res = await fetch(ruta, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo completar la operación.');
        return null;
      }
      return data;
    } catch {
      setError('Error de red.');
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function aplicarCondiciones(e) {
    e.preventDefault();
    setResultadoCond(null);
    const alcanza =
      cond.alcance === 'todos'
        ? `los ${totalActivos} servicios activos, incluso los que ya tienen condiciones capturadas`
        : `los ${sinCondiciones} servicios que todavía no tienen condiciones`;
    if (!window.confirm(`Se van a aplicar estas condiciones a ${alcanza}. ¿Continuar?`)) return;

    const data = await llamar('/api/facturas/condiciones', cond);
    if (data) {
      setResultadoCond(data.aplicados);
      router.refresh();
    }
  }

  function leerArchivo(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setRevision(null);
    setCargado(null);
    setNombreArchivo(archivo.name);
    const lector = new FileReader();
    lector.onload = () => setCsv(String(lector.result || ''));
    lector.readAsText(archivo, 'utf-8');
  }

  async function revisar() {
    setCargado(null);
    const data = await llamar('/api/facturas/carga', { csv, simular: true });
    if (data) setRevision(data);
  }

  async function cargar() {
    if (!window.confirm(`Se van a cargar ${revision.listas} factura(s). ¿Continuar?`)) return;
    const data = await llamar('/api/facturas/carga', { csv, simular: false });
    if (data) {
      setCargado(data);
      setRevision(null);
      setCsv('');
      setNombreArchivo('');
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* ------------------------------------------------------ paso 1 */}
      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <h2 className="text-base font-semibold text-white">1 · Cómo se les cobra</h2>
          <p className="text-xs text-slate-500">
            {sinCondiciones} de {totalActivos} servicios sin condiciones
          </p>
        </div>
        <p className="text-xs text-slate-500 mb-4 max-w-3xl">
          Aplica las mismas condiciones a todos de una vez y ajusta después las excepciones desde cada ficha. Esto
          no emite ninguna factura: solo deja escrito cuándo se factura cada servicio y con cuántos días de crédito,
          que es lo que la plataforma necesita para saber qué está vencido y qué no.
        </p>

        <form onSubmit={aplicarCondiciones} className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className={etiqueta} htmlFor="esq">
              Cuándo se factura
            </label>
            <CampoCatalogo
              id="esq"
              valor={cond.esquema_facturacion}
              opciones={esquemas}
              onChange={(v) => setCond({ ...cond, esquema_facturacion: v })}
              vacio="— Selecciona —"
              className={campo}
            />
          </div>
          <div>
            <label className={etiqueta}>Días de crédito</label>
            <input
              type="number"
              min="0"
              value={cond.dias_credito}
              onChange={(e) => setCond({ ...cond, dias_credito: e.target.value })}
              className={campo}
            />
          </div>
          <div>
            <label className={etiqueta} htmlFor="fp">
              Forma de pago
            </label>
            <CampoCatalogo
              id="fp"
              valor={cond.forma_pago}
              opciones={formasPago}
              onChange={(v) => setCond({ ...cond, forma_pago: v })}
              vacio="— No cambiar —"
              className={campo}
            />
          </div>
          <div>
            <label className={etiqueta}>A quiénes</label>
            <select
              value={cond.alcance}
              onChange={(e) => setCond({ ...cond, alcance: e.target.value })}
              className={campo}
            >
              <option value="sin_condiciones">A los que no tienen</option>
              <option value="todos">A todos los activos</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={ocupado}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-ultra-blanco text-sm rounded-lg px-4 py-2"
          >
            Aplicar condiciones
          </button>
        </form>

        {resultadoCond !== null && (
          <p className="mt-3 text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
            Listo: {resultadoCond} servicio(s) actualizados. Ya aparecen en «Por facturar».
          </p>
        )}
      </section>

      {/* ------------------------------------------------------ paso 2 */}
      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-1">2 · Lo que ya habías facturado</h2>
        <p className="text-xs text-slate-500 mb-4 max-w-3xl">
          Para que la cartera arranque diciendo la verdad, hay que meter las facturas que ya existían: las de este
          mes y las de meses anteriores que sigan sin cobrarse. Se capturan en Excel y se suben de una vez.
        </p>

        <ol className="text-sm text-slate-300 space-y-3 mb-4">
          <li className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 text-xs">1.</span>
            <a
              href={`/api/facturas/carga?periodo=${periodo}`}
              className="bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg px-3 py-1.5"
            >
              <Icono nombre="descargar" className="mr-1.5 -mt-0.5" />Descargar la plantilla de {periodo}
            </a>
            <span className="text-xs text-slate-500">
              Trae un renglón por servicio, con la fecha y el importe ya propuestos.
            </span>
          </li>
          <li className="flex flex-wrap items-start gap-2">
            <span className="text-slate-500 text-xs mt-0.5">2.</span>
            <span className="text-xs text-slate-400 max-w-2xl">
              Ábrela en Excel. Corrige los importes que no coincidan y borra los renglones de lo que no facturaste.
              Para meses anteriores, copia los renglones y cámbiales el <strong>Periodo</strong> y la{' '}
              <strong>Fecha de factura</strong>. Si alguna ya se pagó, escribe <strong>SI</strong> en{' '}
              <em>¿Pagada?</em> y su fecha de pago. Guárdala como CSV.
            </span>
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 text-xs">3.</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={leerArchivo}
              className="text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-white hover:file:bg-slate-600"
            />
            {nombreArchivo && (
              <button
                type="button"
                onClick={revisar}
                disabled={ocupado || !csv}
                className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-ultra-blanco text-sm rounded-lg px-3 py-1.5"
              >
                {ocupado ? 'Revisando…' : 'Revisar el archivo'}
              </button>
            )}
          </li>
        </ol>

        {revision && (
          <div className="bg-slate-900/60 rounded-xl p-4 space-y-3">
            <p className="text-sm text-slate-200">
              Revisión de <strong>{nombreArchivo}</strong> — nada se ha guardado todavía.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500">Renglones leídos</p>
                <p className="text-slate-200">{revision.renglones}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Listas para cargar</p>
                <p className="text-emerald-400 font-semibold">{revision.listas}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Suman</p>
                <p className="text-slate-200">{formatCurrency(revision.importe)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Quedarían por cobrar</p>
                <p className="text-slate-200">{formatCurrency(revision.porCobrar)}</p>
              </div>
            </div>

            {revision.errores.length > 0 && (
              <div>
                <p className="text-sm text-amber-300/90 mb-1">
                  {revision.errores.length} renglón(es) no se van a cargar:
                </p>
                <div className="max-h-56 overflow-y-auto text-xs space-y-1">
                  {revision.errores.map((e, i) => (
                    <p key={i} className="text-slate-400">
                      <span className="text-slate-500">Renglón {e.fila}</span>
                      {e.servicio ? ` · ${e.servicio}` : ''} — {e.motivo}
                    </p>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Puedes cargar los buenos ahora y corregir el resto en otro archivo después.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={cargar}
              disabled={ocupado || !revision.listas}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-ultra-blanco text-sm rounded-lg px-4 py-2"
            >
              {ocupado ? 'Cargando…' : `Cargar ${revision.listas} factura(s)`}
            </button>
          </div>
        )}

        {cargado && (
          <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
            Se cargaron <strong>{cargado.cargadas}</strong> facturas por {formatCurrency(cargado.importe)} en{' '}
            {cargado.servicios} servicios. Quedaron {formatCurrency(cargado.porCobrar)} por cobrar.{' '}
            <Link href="/cobranza" className="underline">
              Ver la cobranza
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
