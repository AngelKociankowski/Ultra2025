'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { comoFecha, enPalabras } from './formato';
import EditorContrato from './EditorContrato';
import Icono from '@/components/Icono';

const TONO = {
  red: 'bg-red-500/10 text-red-300 border-red-500/30',
  amber: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  slate: 'bg-slate-700/50 text-slate-300 border-slate-600/50',
};

export default function Fila({ servicio: s, puedeEditar }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const c = s.contrato;

  return (
    <Fragment>
      <tr
        onClick={() => setAbierto((v) => !v)}
        className={`border-t border-slate-700/40 cursor-pointer hover:bg-slate-700/20 ${
          abierto ? 'bg-slate-700/20' : ''
        }`}
      >
        <td className="px-4 py-3">
          <p className="text-white font-medium leading-tight">
            <span className="text-slate-500 mr-1 inline-block w-3">{abierto ? '▾' : '▸'}</span>
            {s.servicio}
          </p>
          {s.razon_social && s.razon_social !== s.servicio && (
            <p className="text-xs text-slate-500 leading-tight pl-4">{s.razon_social}</p>
          )}
          {s.estatus === 'SUSPENDIDO' && (
            <span className="ml-4 inline-block text-[10px] px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-300 border-amber-500/30">
              suspendido
            </span>
          )}
        </td>
        <td className="px-3 py-3 text-slate-400 text-xs">
          {s.zona || '—'}
          {s.asesor && <span className="block text-slate-500">{s.asesor}</span>}
        </td>
        <td className="px-3 py-3 text-right text-slate-300">{formatNumber(s.total_guardias)}</td>
        <td className="px-3 py-3 text-right text-slate-300">
          {s.importe_factura ? formatCurrency(s.importe_factura) : <span className="text-slate-600">—</span>}
        </td>
        <td className="px-3 py-3">
          <span className={`inline-block text-xs rounded-lg px-2 py-1 border whitespace-nowrap ${TONO[c.tono]}`}>
            {c.etiqueta}
          </span>
        </td>
        <td className="px-3 py-3 text-slate-400 text-xs whitespace-nowrap">
          {comoFecha(s.fecha_contrato) || <span className="text-slate-600">—</span>}
        </td>
        <td className="px-3 py-3 text-xs whitespace-nowrap">
          {c.vence ? (
            <>
              <span className="text-slate-300">{comoFecha(c.vence)}</span>
              {/* Un servicio marcado «sin contrato» que trae fecha de
                  vencimiento se contradice. Sin decirlo aquí, el renglón se lee
                  como si el papel estuviera en orden hasta 2027 —y lo que dice
                  la palomita es que no hay papel. */}
              {c.clave === 'SIN_CONTRATO' ? (
                <span
                  className="block text-amber-400"
                  title="Está marcado como sin contrato y aun así trae fecha de vencimiento. Una de las dos cosas está mal capturada."
                >
                  …pero dice no tener contrato
                </span>
              ) : (
                <span className={`block ${c.dias < 0 ? 'text-red-400' : c.dias <= 90 ? 'text-amber-400' : 'text-slate-500'}`}>
                  {enPalabras(c.dias)}
                </span>
              )}
            </>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </td>
        <td className="px-3 py-3 text-xs">
          {s.contrato_archivo ? (
            <a
              href={`/api/servicios/${s.id}/contrato`}
              onClick={(e) => e.stopPropagation()}
              className="text-emerald-300 hover:underline whitespace-nowrap"
            >
              <Icono nombre="documento" className="mr-1.5 -mt-0.5" />Ver el contrato
            </a>
          ) : (
            <span className="text-slate-600 whitespace-nowrap">sin PDF</span>
          )}
        </td>
        <td className="px-3 py-3 text-xs text-slate-400 max-w-[260px]">
          {s.comentarios_contrato ? (
            <span className="line-clamp-2">{s.comentarios_contrato}</span>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </td>
      </tr>

      {abierto && (
        <tr className="border-t border-slate-700/40 bg-slate-900/40">
          <td colSpan={9} className="px-4 py-4">
            <EditorContrato
              servicio={s}
              puedeEditar={puedeEditar}
              onGuardado={() => {
                setAbierto(false);
                router.refresh();
              }}
            />
            <div className="mt-3 pt-3 border-t border-slate-700/40">
              <Link
                href={`/estado-fuerza/${s.id}`}
                className="text-xs text-cyan-400 hover:underline"
              >
                Abrir la ficha completa del servicio →
              </Link>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
