import Link from 'next/link';
import { formatNumber } from '@/lib/utils';

const MESES = [
  '',
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** 2026-08-12 → 12 de agosto de 2026. */
export function comoTexto(d) {
  const [a, m, dd] = String(d).split('-');
  return `${Number(dd)} de ${MESES[Number(m)]} de ${a}`;
}

/**
 * De dónde sale el número que se está viendo.
 *
 * Un estado de fuerza con fecha invita a creerle sin preguntar, y aquí hay dos
 * cosas de exactitud distinta juntas: QUÉ servicios estaban en la calle ese día
 * —que sale de la fecha de alta y de baja de cada uno, y es exacto— y CUÁNTOS
 * elementos tenía cada uno, que se corrige hacia atrás solo hasta donde los
 * movimientos dicen a qué servicio pertenecen.
 *
 * Callar la segunda mitad sería lo cómodo. Pero un número que no se puede
 * defender en una junta no sirve para ir a una junta, y quien lo lleve tiene
 * derecho a saber por dónde se rompe antes de que se lo pregunten.
 */
export default function AvisoDia({
  dia,
  exactitud,
  contraste,
  movimientos,
  guardias,
  servicios,
  fueraDeAlcance = false,
  limite = null,
}) {
  const hayMovimiento = movimientos.entraron.length > 0 || movimientos.salieron.length > 0;

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold text-white">
          Como estaba el {comoTexto(dia)}
        </h2>
        <p className="text-xs text-slate-500 tabular-nums">
          {formatNumber(servicios)} servicios · {formatNumber(guardias)} guardias al cierre de ese día
        </p>
      </div>

      {/* Antes que nada, si la fecha se salió del tramo donde esto es de fiar.
          Un servicio cancelado hace meses no está en la tabla, así que cuanto
          más atrás se mire más gente falta —al 31 de marzo faltan diez
          servicios contra el corte de ese mes— y el número se queda corto sin
          que nada lo advierta. Decirlo primero, y en rojo, porque quien llegó
          aquí por un enlace guardado no eligió la fecha hoy. */}
      {fueraDeAlcance && (
        <div className="mx-5 mb-3 text-xs rounded-lg px-3 py-2.5 border text-red-300 bg-red-500/10 border-red-500/30">
          <p className="font-medium">Este número se queda corto y no hay que usarlo.</p>
          <p className="mt-1 text-red-300/85">
            La reconstrucción por día solo alcanza del <strong>{comoTexto(limite)}</strong> en adelante. Más atrás
            faltan los servicios que se cancelaron antes de que se cargara el histórico: no están en la base, así que
            aquí no aparecen y el total sale más bajo de lo que fue.
          </p>
          <p className="mt-1 text-red-300/85">
            Para una fecha anterior, el dato bueno es el <strong>corte de ese mes</strong> —la foto contra la que se
            facturó—.{' '}
            <Link href={`/estado-fuerza?periodo=${dia.slice(0, 7)}`} className="underline hover:text-white">
              Ver el corte de {dia.slice(0, 7)}
            </Link>
            .
          </p>
        </div>
      )}

      {/* La comprobación, cuando la hay. Es lo que convierte una cifra
          reconstruida en una cifra con respaldo: si al mirar el último día de un
          mes cerrado sale lo mismo que el corte que se guardó, el método está
          bien para ese tramo. */}
      {contraste && (
        <p
          className={`mx-5 mb-3 text-xs rounded-lg px-3 py-2 border ${
            contraste.difGuardias === 0 && contraste.difServicios === 0
              ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
              : 'text-amber-300 bg-amber-500/10 border-amber-500/30'
          }`}
        >
          {contraste.difGuardias === 0 && contraste.difServicios === 0 ? (
            <>
              Cuadra con el corte guardado de {contraste.periodo}: {formatNumber(contraste.servicios)} servicios y{' '}
              {formatNumber(contraste.guardias)} guardias, los mismos.
            </>
          ) : (
            <>
              El corte guardado de {contraste.periodo} dice {formatNumber(contraste.servicios)} servicios y{' '}
              {formatNumber(contraste.guardias)} guardias, o sea{' '}
              {contraste.difGuardias !== 0 && (
                <strong>
                  {contraste.difGuardias > 0 ? '+' : '−'}
                  {formatNumber(Math.abs(contraste.difGuardias))} guardias
                </strong>
              )}
              {contraste.difGuardias !== 0 && contraste.difServicios !== 0 && ' y '}
              {contraste.difServicios !== 0 && (
                <strong>
                  {contraste.difServicios > 0 ? '+' : '−'}
                  {formatNumber(Math.abs(contraste.difServicios))} servicios
                </strong>
              )}{' '}
              de diferencia con lo que se está viendo. El corte es la foto contra la que se facturó; si los dos no
              coinciden, manda el corte.
            </>
          )}
        </p>
      )}

      <div className="px-5 pb-3 grid md:grid-cols-2 gap-x-6 gap-y-3">
        <div>
          <p className="text-xs text-slate-400 font-medium mb-1">De dónde sale este número</p>
          <ul className="text-xs text-slate-500 space-y-1">
            <li>
              <span className="text-slate-300">Qué servicios estaban en la calle</span>: exacto. Sale de la fecha de
              alta y de baja de cada uno, que están capturadas en todos.
            </li>
            <li>
              <span className="text-slate-300">Cuántos elementos tenía cada uno</span>:{' '}
              {exactitud.ajustados > 0 ? (
                <>
                  a {formatNumber(exactitud.ajustados)} servicio{exactitud.ajustados === 1 ? '' : 's'} se les revirtió
                  el movimiento posterior a esa fecha.{' '}
                </>
              ) : null}
              Los otros {formatNumber(exactitud.sinAjustar)} llevan la plantilla de hoy, porque después de ese día no
              se les registró ningún movimiento que diga a qué servicio pertenece.
            </li>
            {exactitud.pausasBorradas > 0 && (
              <li className="text-amber-300/70">
                {formatNumber(exactitud.pausasBorradas)} servicio
                {exactitud.pausasBorradas === 1 ? ' estuvo' : 's estuvieron'} en pausa y ya se reactivaron. Al
                reactivarse se borra desde cuándo estaban pausados, así que si esa fecha cae dentro de la pausa, aquí
                aparecen como si hubieran estado operando.
              </li>
            )}
          </ul>
        </div>

        <div>
          <p className="text-xs text-slate-400 font-medium mb-1">Lo que se movió ese día</p>
          {hayMovimiento ? (
            <ul className="text-xs space-y-1">
              {movimientos.entraron.map((m) => (
                <li key={`a${m.folio}`} className="flex justify-between gap-3">
                  <span className="text-emerald-400 truncate">
                    {m.tipo === 'INCREMENTO' ? 'Incremento' : 'Alta'} · {m.servicio}
                  </span>
                  <span className="text-slate-500 tabular-nums whitespace-nowrap">+{m.guardias}</span>
                </li>
              ))}
              {movimientos.salieron.map((m) => (
                <li key={`c${m.folio}`} className="flex justify-between gap-3">
                  <span className="text-red-400 truncate">
                    {m.tipo === 'REDUCCION' ? 'Reducción' : 'Baja'} · {m.servicio}
                  </span>
                  <span className="text-slate-500 tabular-nums whitespace-nowrap">−{m.guardias}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">Ese día no entró ni salió nada.</p>
          )}
        </div>
      </div>

      <p className="px-5 py-2.5 border-t border-slate-700/50 text-xs text-slate-500">
        Esta vista es de consulta: para modificar un servicio,{' '}
        <Link href="/estado-fuerza" className="text-cyan-400 hover:underline">
          vuelve al mes en curso
        </Link>
        .
      </p>
    </section>
  );
}
