'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { MODALIDADES } from '@/lib/modalidades';
import Icono from '@/components/Icono';
import { hoyLocal } from '@/lib/utils';

const clase =
  'bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:border-cyan-500';

/**
 * Un filtro puesto se tiene que ver puesto.
 *
 * Nueve desplegables con el mismo aspecto y uno de ellos apretado: la tabla
 * enseña treinta renglones donde hay doscientos diecisiete y no hay nada en
 * pantalla que diga por qué. De ahí sale la llamada de «me faltan servicios».
 * El borde encendido señala cuáles están estrechando la lista, y el conteo de
 * arriba deja quitarlos todos de un golpe.
 */
const activo = (v) => (v ? `${clase} border-cyan-500/70 text-cyan-200` : clase);

const MESES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiquetaPeriodo = (p) => {
  const [a, m] = String(p).split('-');
  return `${MESES[Number(m)]} ${a}`;
};

export default function Filtros({
  valores,
  catalogos,
  periodos = [],
  vigente,
  dia = null,
  diaMinimo = null,
  diasConMovimiento = [],
}) {
  const router = useRouter();
  const [f, setF] = useState(valores);

  function aplicar(siguiente) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(siguiente)) if (v) params.set(k, v);
    router.push(`/estado-fuerza?${params.toString()}`);
  }

  /**
   * Ir a una fecha, o volver del día al mes.
   *
   * El día y el mes se excluyen: pedir los dos a la vez no querría decir nada.
   * Los filtros de zona, asesor y demás sí se conservan, porque la pregunta que
   * se está haciendo —«¿cómo estaba la zona sur el día 3?»— es la misma.
   */
  function irAlDia(v) {
    const params = new URLSearchParams();
    for (const [k, x] of Object.entries(f)) if (x && k !== 'periodo') params.set(k, x);
    if (v) params.set('dia', v);
    router.push(`/estado-fuerza${params.toString() ? `?${params}` : ''}`);
  }

  function cambiar(k, v) {
    const siguiente = { ...f, [k]: v };
    // Al saltar de mes se sueltan los filtros que ese corte quizá no tiene:
    // una zona o un asesor de hoy pueden no existir en un corte de 2023.
    if (k === 'periodo') {
      siguiente.zona = '';
      siguiente.asesor = '';
    }
    // Elegir un mes saca del día: son dos formas de mirar lo mismo y solo una
    // puede estar puesta.
    if (k === 'periodo' && dia) {
      const params = new URLSearchParams();
      if (v) params.set('periodo', v);
      router.push(`/estado-fuerza${params.toString() ? `?${params}` : ''}`);
      return;
    }
    setF(siguiente);
    if (k !== 'q') aplicar(siguiente);
  }

  const enCorte = Boolean(f.periodo);

  // El mes no cuenta como filtro: siempre hay uno elegido, y el estatus tampoco
  // porque «Activos» es lo que se quiere ver de entrada. Los demás sí: cada uno
  // esconde renglones que sin él estarían.
  const puestos = [
    ['q', f.q, `«${f.q}»`],
    ['modalidad', f.modalidad, MODALIDADES[f.modalidad]?.etiqueta || f.modalidad],
    ['estatus', f.estatus && f.estatus !== 'ACTIVO' ? f.estatus : '', f.estatus],
    ['zona', f.zona, f.zona],
    ['asesor', f.asesor, f.asesor],
    ['turno', f.turno, f.turno],
    ['contrato', f.contrato, f.contrato === 'si' ? 'con contrato' : 'sin contrato'],
    ['facturado', f.facturado, f.facturado === 'si' ? 'facturados' : 'sin facturar'],
  ].filter(([, v]) => v);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        aplicar(f);
      }}
      className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-3"
    >
      <div className="flex flex-wrap gap-2 items-center">
      {periodos.length > 0 && (
        <select
          value={f.periodo}
          onChange={(e) => cambiar('periodo', e.target.value)}
          className={`${clase} font-medium`}
          aria-label="Mes"
        >
          <option value="">{etiquetaPeriodo(vigente)} · en curso</option>
          {periodos
            .filter((p) => p.periodo !== vigente)
            .map((p) => (
              <option key={p.periodo} value={p.periodo}>
                {etiquetaPeriodo(p.periodo)} · {p.guardias} guardias
              </option>
            ))}
        </select>
      )}

      {/* La fecha, al lado del mes. Son la misma pregunta a dos escalas: el mes
          dice cómo cerró y el día, cómo estaba esa mañana. */}
      <div className="flex items-center gap-1.5">
        <label htmlFor="dia" className="text-xs text-slate-500 whitespace-nowrap">
          o al día
        </label>
        <input
          id="dia"
          type="date"
          value={dia || ''}
          max={hoyLocal()}
          {...(diaMinimo ? { min: diaMinimo } : {})}
          title={
            diaMinimo
              ? `Del ${diaMinimo} en adelante. Para fechas anteriores, el bueno es el corte del mes: elígelo arriba.`
              : undefined
          }
          onChange={(e) => irAlDia(e.target.value)}
          className={dia ? `${clase} border-cyan-500/70 text-cyan-200` : clase}
        />
        {dia && (
          <button
            type="button"
            onClick={() => irAlDia('')}
            title="Volver al mes en curso"
            className="text-slate-500 hover:text-white px-1"
          >
            <Icono nombre="cerrar" tamano={14} />
          </button>
        )}
      </div>

      {/* La búsqueda va primero y más ancha: es lo que se usa nueve de cada
          diez veces que se entra, y tenerla del mismo tamaño que «Factura:
          todos» obligaba a buscarla entre los demás. */}
      <div className="relative flex-1 min-w-[240px]">
        <Icono
          nombre="buscar"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
        />
        <input
          value={f.q}
          onChange={(e) => cambiar('q', e.target.value)}
          placeholder="Buscar servicio, razón social o asesor…"
          aria-label="Buscar un servicio"
          className={`${activo(f.q)} w-full pl-8`}
        />
      </div>

      {/* Los cortes cerrados no guardaron la modalidad: es un dato que nació
          después que ellos, y ofrecerlo ahí devolvería siempre cero. */}
      {!enCorte && (
        <select
          value={f.modalidad}
          onChange={(e) => cambiar('modalidad', e.target.value)}
          className={activo(f.modalidad)}
          aria-label="Modalidad"
        >
          <option value="">Fijos y temporales</option>
          {Object.entries(MODALIDADES).map(([k, m]) => (
            <option key={k} value={k}>
              {m.etiqueta}
            </option>
          ))}
          <option value="VENCIDA">Temporales ya vencidos</option>
        </select>
      )}

      {/* Un corte cerrado solo guarda lo que operaba ese mes: no hay bajas que filtrar. */}
      {!enCorte && (
        <select
          value={f.estatus}
          onChange={(e) => cambiar('estatus', e.target.value)}
          className={activo(f.estatus && f.estatus !== 'ACTIVO' ? f.estatus : '')}
        >
          <option value="ACTIVO">Activos</option>
          <option value="SUSPENDIDO">Suspendidos</option>
          <option value="BAJA">Bajas</option>
          <option value="">Todos</option>
        </select>
      )}

      <select value={f.zona} onChange={(e) => cambiar('zona', e.target.value)} className={activo(f.zona)}>
        <option value="">Todas las zonas</option>
        {catalogos.zonas.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>

      <select value={f.asesor} onChange={(e) => cambiar('asesor', e.target.value)} className={activo(f.asesor)}>
        <option value="">Todos los asesores</option>
        {catalogos.asesores.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      {catalogos.turnos?.length > 0 && (
        <select value={f.turno} onChange={(e) => cambiar('turno', e.target.value)} className={activo(f.turno)}>
          <option value="">Todos los turnos</option>
          {catalogos.turnos.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}

      <select value={f.contrato} onChange={(e) => cambiar('contrato', e.target.value)} className={activo(f.contrato)}>
        <option value="">Contrato: todos</option>
        <option value="si">Con contrato</option>
        <option value="no">Sin contrato</option>
      </select>

      <select value={f.facturado} onChange={(e) => cambiar('facturado', e.target.value)} className={activo(f.facturado)}>
        <option value="">Factura: todos</option>
        <option value="si">Facturados</option>
        <option value="no">Sin facturar</option>
      </select>

      <button type="submit" className="bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg px-3 py-1.5">
        Buscar
      </button>
      </div>

      {/* Un calendario de treinta y un casillas donde solo tres tienen algo
          obliga a ir probando. Estos son los días en que de verdad entró o salió
          gente ese mes. */}
      {diasConMovimiento.length > 0 && (
        <p className="text-xs text-slate-500 mt-2.5 pt-2.5 border-t border-slate-700/50 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span>Días con movimiento:</span>
          {diasConMovimiento.map((d) => (
            <button
              key={d.fecha}
              type="button"
              onClick={() => irAlDia(d.fecha)}
              className={`rounded px-1.5 py-0.5 tabular-nums transition-colors ${
                dia === d.fecha ? 'bg-cyan-500/20 text-cyan-200' : 'hover:bg-slate-700/60 text-slate-400'
              }`}
              title={`${d.entraron} entraron · ${d.salieron} salieron`}
            >
              {Number(d.fecha.slice(8))}
              <span className="text-[10px] ml-1 text-slate-600">
                {d.entraron > 0 && `+${d.entraron}`}
                {d.entraron > 0 && d.salieron > 0 && ' '}
                {d.salieron > 0 && `−${d.salieron}`}
              </span>
            </button>
          ))}
        </p>
      )}

      {puestos.length > 0 && (
        <p className="text-xs text-slate-500 mt-2.5 pt-2.5 border-t border-slate-700/50">
          Estás viendo una parte:{' '}
          <span className="text-slate-300">{puestos.map(([, , t]) => t).join(' · ')}</span>.{' '}
          <Link href="/estado-fuerza" className="text-cyan-400 hover:underline">
            Quitar {puestos.length === 1 ? 'el filtro' : `los ${puestos.length} filtros`}
          </Link>
        </p>
      )}
    </form>
  );
}
