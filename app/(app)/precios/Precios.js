'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatCurrency, formatNumber } from '@/lib/utils';

const ORDEN = { vencido: 0, este_mes: 1, proximo: 2, sin_fecha: 3, al_corriente: 4 };

const TONO = {
  vencido: 'bg-red-500/20 text-red-300',
  este_mes: 'bg-amber-500/20 text-amber-300',
  proximo: 'bg-slate-700/60 text-slate-300',
  al_corriente: 'bg-emerald-500/20 text-emerald-300',
  sin_fecha: 'bg-slate-700/60 text-slate-400',
};

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * La misma cuenta que hace el servidor, aquí para que la vista previa aparezca
 * al instante mientras se escribe el porcentaje. Al aplicar manda el servidor:
 * esto es para mirar, no para decidir.
 */
function calcular(s, tipo, valor) {
  const base = Number(s.importe_factura) || Number(s.precio_guardia) || 0;
  const n = Number(valor);
  if (!base || !Number.isFinite(n)) return null;
  let factor;
  if (tipo === 'PORCENTAJE') factor = 1 + n / 100;
  else if (tipo === 'MONTO') factor = (base + n) / base;
  else factor = n / base;
  if (!Number.isFinite(factor) || base * factor <= 0) return null;
  const mover = (v) => (Number(v) > 0 ? redondear(Number(v) * factor) : null);
  return {
    factor,
    porcentaje: redondear((factor - 1) * 100),
    importe: mover(s.importe_factura),
    precio: mover(s.precio_guardia),
    diferencia: redondear(base * factor - base),
  };
}

export default function Precios({ servicios, filtros, zonas, asesores, etiquetas, periodo, historial }) {
  const router = useRouter();
  const [sel, setSel] = useState(() => new Set());
  const [tipo, setTipo] = useState('PORCENTAJE');
  const [valor, setValor] = useState('');
  const [vigencia, setVigencia] = useState(periodo);
  const [motivo, setMotivo] = useState('Revisión anual de precio');
  const [fijarMes, setFijarMes] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [hecho, setHecho] = useState(null);
  const [verHistorial, setVerHistorial] = useState(false);

  const lista = useMemo(
    () => [...servicios].sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.servicio.localeCompare(b.servicio)),
    [servicios]
  );

  const escogidos = lista.filter((s) => sel.has(s.id));
  const previa = useMemo(() => {
    if (!valor || !escogidos.length) return null;
    const filas = escogidos.map((s) => ({ s, r: calcular(s, tipo, valor) })).filter((f) => f.r);
    const antes = filas.reduce((a, { s }) => a + (Number(s.importe_factura) || Number(s.precio_guardia) || 0), 0);
    const despues = filas.reduce((a, { r, s }) => a + (r.importe ?? r.precio ?? 0), 0);
    return {
      filas,
      sinPrecio: escogidos.length - filas.length,
      antes: redondear(antes),
      despues: redondear(despues),
      diferencia: redondear(despues - antes),
    };
  }, [escogidos, tipo, valor]);

  const alternar = (id) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const escogerTodos = (filtrar) => {
    const ids = lista.filter(filtrar).map((s) => s.id);
    setSel((s) => (ids.every((i) => s.has(i)) ? new Set() : new Set(ids)));
  };

  function buscar(campo, v) {
    const p = new URLSearchParams({ ...filtros, [campo]: v });
    for (const [k, val] of [...p.entries()]) if (!val) p.delete(k);
    router.push(`/precios${p.toString() ? `?${p}` : ''}`);
  }

  async function aplicar() {
    if (!escogidos.length) return setError('Escoge a qué servicios les vas a mover el precio.');
    if (!valor) return setError('Escribe cuánto sube.');

    const cuantos = escogidos.length;
    const resumen = previa
      ? `\n\nDe ${formatCurrency(previa.antes)} a ${formatCurrency(previa.despues)} al mes (${
          previa.diferencia >= 0 ? '+' : ''
        }${formatCurrency(previa.diferencia)}).`
      : '';
    if (
      !confirm(
        `Vas a cambiarle el precio a ${cuantos} servicio${cuantos === 1 ? '' : 's'}, con vigencia desde ${vigencia}.` +
          resumen +
          '\n\nLas facturas ya emitidas no se tocan; esto cambia lo que se cobra de aquí en adelante.\n\n¿Aplicamos?'
      )
    ) {
      return;
    }

    setEnviando(true);
    setError('');
    setHecho(null);
    try {
      const r = await fetch('/api/precios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [...sel],
          ajuste: { tipo, valor: Number(valor) },
          vigencia,
          motivo,
          fijarMes,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return setError(data.error || 'No se pudo aplicar el cambio.');
      setHecho(data);
      setSel(new Set());
      setValor('');
      router.refresh();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Filtros --------------------------------------------------------- */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          defaultValue={filtros.q}
          onKeyDown={(e) => e.key === 'Enter' && buscar('q', e.currentTarget.value)}
          placeholder="Buscar cliente…"
          className="bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white w-56"
        />
        <select
          value={filtros.estado}
          onChange={(e) => buscar('estado', e.target.value)}
          className="bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="">A quién le toca: todos</option>
          {Object.entries(etiquetas).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={filtros.zona}
          onChange={(e) => buscar('zona', e.target.value)}
          className="bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="">Todas las zonas</option>
          {zonas.map((z) => (
            <option key={z.valor ?? z} value={z.valor ?? z}>
              {z.etiqueta ?? z.valor ?? z}
            </option>
          ))}
        </select>
        <select
          value={filtros.asesor}
          onChange={(e) => buscar('asesor', e.target.value)}
          className="bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white max-w-[220px]"
        >
          <option value="">Todos los asesores</option>
          {asesores.map((a) => (
            <option key={a.valor ?? a} value={a.valor ?? a}>
              {a.etiqueta ?? a.valor ?? a}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => escogerTodos((s) => s.estado === 'vencido' || s.estado === 'este_mes')}
          className="text-sm bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-lg px-3 py-2"
        >
          Escoger a los que les toca
        </button>
        <button
          type="button"
          onClick={() => escogerTodos(() => true)}
          className="text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-2"
        >
          Escoger todo lo que se ve
        </button>
      </div>

      {hecho && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-4 py-3">
          <p className="text-sm text-emerald-300 font-semibold">
            Precio actualizado en {formatNumber(hecho.aplicables)} servicio{hecho.aplicables === 1 ? '' : 's'}, con
            vigencia desde {hecho.vigencia}.
          </p>
          <p className="text-xs text-emerald-400 mt-0.5">
            La facturación de esos servicios pasa de {formatCurrency(hecho.totalAntes)} a{' '}
            {formatCurrency(hecho.totalDespues)} al mes ({hecho.diferencia >= 0 ? '+' : ''}
            {formatCurrency(hecho.diferencia)}). Queda en el historial de cada ficha.
            {hecho.saltados?.length > 0 &&
              ` ${hecho.saltados.length} se quedaron fuera: ${hecho.saltados[0].razon}`}
          </p>
        </div>
      )}
      {error && (
        <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">{error}</p>
      )}

      {/* Aplicar --------------------------------------------------------- */}
      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Cómo sube</label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="PORCENTAJE">Un porcentaje</option>
              <option value="MONTO">Un monto fijo</option>
              <option value="IMPORTE">Dejarlo en un importe exacto</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {tipo === 'PORCENTAJE' ? 'Porcentaje' : tipo === 'MONTO' ? 'Cuánto se le suma' : 'Importe mensual nuevo'}
            </label>
            <div className="flex items-center gap-1">
              {tipo !== 'PORCENTAJE' && <span className="text-slate-500 text-sm">$</span>}
              <input
                type="number"
                step="0.01"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder={tipo === 'PORCENTAJE' ? '5' : '1000'}
                className="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white w-32"
              />
              {tipo === 'PORCENTAJE' && <span className="text-slate-500 text-sm">%</span>}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Se cobra así desde</label>
            <input
              type="month"
              value={vigencia}
              onChange={(e) => setVigencia(e.target.value)}
              className="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs text-slate-400 mb-1">Motivo</label>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Revisión anual, renegociación…"
              className="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white w-full"
            />
          </div>
          <button
            type="button"
            onClick={aplicar}
            disabled={enviando || !escogidos.length}
            className="bg-emerald-600 hover:bg-emerald-500 text-ultra-blanco text-sm rounded-lg px-4 py-2 disabled:opacity-40"
          >
            {enviando ? 'Aplicando…' : `Aplicar a ${escogidos.length || 'los escogidos'}`}
          </button>
        </div>

        <label className="flex items-start gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={fijarMes} onChange={(e) => setFijarMes(e.target.checked)} className="mt-0.5" />
          <span>
            Dejar este mes como el mes de revisión de aquí en adelante. Sin marcarlo, cada servicio conserva el mes que
            ya tenía pactado y solo se anota el año en que se le subió.
          </span>
        </label>

        {previa && (
          <div className="border-t border-slate-700/50 pt-3 text-sm">
            <p className="text-slate-300">
              {formatNumber(previa.filas.length)} servicio{previa.filas.length === 1 ? '' : 's'}:{' '}
              <span className="text-slate-400">{formatCurrency(previa.antes)}</span> →{' '}
              <strong className="text-emerald-400">{formatCurrency(previa.despues)}</strong> al mes{' '}
              <span className={previa.diferencia >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                ({previa.diferencia >= 0 ? '+' : ''}
                {formatCurrency(previa.diferencia)})
              </span>
            </p>
            {previa.sinPrecio > 0 && (
              <p className="text-xs text-amber-400 mt-1">
                {previa.sinPrecio} de los escogidos no tienen precio capturado, así que se quedarán fuera.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Lista ------------------------------------------------------------ */}
      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="bg-slate-900/60">
              <tr className="text-slate-400 text-xs">
                <th className="w-10 px-3 py-3"></th>
                <th className="text-left px-3 py-3">Servicio</th>
                <th className="text-left px-3 py-3">Zona</th>
                <th className="text-left px-3 py-3">Le toca</th>
                <th className="text-left px-3 py-3">Último aumento</th>
                <th className="text-right px-3 py-3">Importe al mes</th>
                <th className="text-right px-4 py-3">Quedaría en</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((s) => {
                const marcado = sel.has(s.id);
                const r = marcado && valor ? calcular(s, tipo, valor) : null;
                return (
                  <tr
                    key={s.id}
                    className={`border-t border-slate-800/70 ${marcado ? 'bg-cyan-500/5' : 'hover:bg-slate-800/40'}`}
                  >
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={marcado} onChange={() => alternar(s.id)} />
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/estado-fuerza/${s.id}`} className="text-slate-200 hover:text-cyan-400">
                        {s.servicio}
                      </Link>
                      <span className="block text-[11px] text-slate-500">{s.razon_social || '—'}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-400">{s.zona || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${TONO[s.estado]}`}>{etiquetas[s.estado]}</span>
                      {s.mesTexto && <span className="block text-[11px] text-slate-500 mt-0.5">en {s.mesTexto}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {s.anio_ultimo_incremento || '—'}
                      {s.ultimoCambio?.porcentaje != null && (
                        <span className="block">
                          {s.ultimoCambio.porcentaje >= 0 ? '+' : ''}
                          {s.ultimoCambio.porcentaje}% · {s.ultimoCambio.vigente_desde}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {s.importe_factura ? (
                        formatCurrency(s.importe_factura)
                      ) : s.precio_guardia ? (
                        <span title="No tiene importe mensual; se usa el precio por guardia">
                          {formatCurrency(s.precio_guardia)}
                          <span className="block text-[11px] text-slate-500">por guardia</span>
                        </span>
                      ) : (
                        <span className="text-amber-400/80 text-xs">sin precio</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r ? (
                        <>
                          <span className="text-emerald-400">{formatCurrency(r.importe ?? r.precio)}</span>
                          <span className="block text-[11px] text-slate-500">
                            {r.porcentaje >= 0 ? '+' : ''}
                            {r.porcentaje}%
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-700">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Ningún servicio con esos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Historial -------------------------------------------------------- */}
      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setVerHistorial((v) => !v)}
          className="w-full text-left px-5 py-3 hover:bg-slate-800/40"
        >
          <span className="text-base font-semibold text-white">Últimos movimientos de precio</span>
          <span className="text-xs text-slate-500 block">
            {historial.length ? `${historial.length} registrados · toca para ${verHistorial ? 'ocultar' : 'ver'}` : 'Todavía no hay ninguno'}
          </span>
        </button>
        {verHistorial && historial.length > 0 && (
          <div className="overflow-x-auto border-t border-slate-700/50">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-slate-900/60">
                <tr className="text-slate-400 text-xs">
                  <th className="text-left px-4 py-3">Servicio</th>
                  <th className="text-left px-3 py-3">Desde</th>
                  <th className="text-right px-3 py-3">Antes</th>
                  <th className="text-right px-3 py-3">Después</th>
                  <th className="text-right px-3 py-3">Cambio</th>
                  <th className="text-left px-3 py-3">Motivo</th>
                  <th className="text-left px-4 py-3">Quién</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((h) => (
                  <tr key={h.id} className="border-t border-slate-800/70">
                    <td className="px-4 py-2">
                      <Link href={`/estado-fuerza/${h.servicio_id}`} className="text-slate-200 hover:text-cyan-400">
                        {h.servicio}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{h.vigente_desde || '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-400">
                      {h.importe_anterior ? formatCurrency(h.importe_anterior) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {h.importe_nuevo ? formatCurrency(h.importe_nuevo) : '—'}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${
                        (h.porcentaje || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {h.porcentaje == null ? '—' : `${h.porcentaje >= 0 ? '+' : ''}${h.porcentaje}%`}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{h.motivo || '—'}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs">{h.usuario || 'sistema'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
