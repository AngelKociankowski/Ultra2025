'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Lo que se puede hacer con una apertura desde la lista.
 *
 * Son tres botones y responden a tres situaciones distintas, que antes se
 * confundían en una sola:
 *
 *   - **Aplicar**: la apertura está anotada y su servicio nunca se creó.
 *   - **Deshacer**: se aplicó y no debía. Quita el servicio del estado de
 *     fuerza sin inventar una cancelación, porque en la calle no se fue nadie.
 *   - **Descartar**: no se va a aplicar nunca. Sale de la cola de pendientes
 *     sin borrarse del histórico.
 *
 * La diferencia entre deshacer y cancelar no es de forma. Una cancelación dice
 * que el cliente se fue: aparece en las gráficas del mes, en el neto contra las
 * aperturas y en el reporte de motivos. Deshacer dice que la captura estuvo
 * mal, y eso no es un movimiento del negocio.
 */
export default function AccionesApertura({ apertura, vieja, aplicada, descartada, opciones }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState('');
  const [error, setError] = useState('');

  async function llamar(ruta, opciones = {}) {
    setOcupado(ruta);
    setError('');
    try {
      const r = await fetch(`/api/aperturas/${apertura.id}/${ruta}`, {
        method: opciones.method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(opciones.cuerpo ? { body: JSON.stringify(opciones.cuerpo) } : {}),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return setError(data.error || 'No se pudo.');
      router.refresh();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setOcupado('');
    }
  }

  /**
   * Los campos de catálogo que la apertura trae y ya no son opción.
   *
   * Tres aperturas de agosto de 2026 traen zona «Centro», que la operación
   * dejó de usar en septiembre de 2024. Aplicarlas tal cual metía al estado de
   * fuerza servicios con una zona que no existe, y nadie se enteraba hasta
   * verla como huérfana en Catálogos.
   */
  const LISTAS = {
    zona: ['zonas', 'zona'],
    asesor: ['asesores', 'asesor'],
    gerente: ['gerentes', 'gerente'],
    supervisor: ['supervisores', 'supervisor'],
    estado_geo: ['estados', 'estado'],
    tipo_repse: ['tiposRepse', 'tipo de REPSE'],
    uniforme: ['uniformes', 'uniforme'],
  };
  const fueraDeCatalogo = Object.entries(LISTAS)
    .filter(([campo, [clave]]) => {
      const v = apertura[campo];
      return v && opciones?.[clave]?.length && !opciones[clave].includes(v);
    })
    .map(([campo, [clave, etiqueta]]) => ({ campo, clave, etiqueta, valor: apertura[campo] }));

  function aplicar() {
    // Antes de aplicar, se resuelve lo que no está en el catálogo. Se pregunta
    // una vez por campo, con la lista a la vista: obligar a abandonar y
    // arreglar el archivo por una zona mal escrita sería peor que el error.
    const correcciones = {};
    for (const f of fueraDeCatalogo) {
      const lista = opciones[f.clave];
      const elegido = prompt(
        `${apertura.servicio}\n\nLa apertura trae ${f.etiqueta} «${f.valor}», que no está en el catálogo. ` +
          `Si la aplicas así, el servicio entra con un valor que la plataforma no reconoce.\n\n` +
          `Escribe el número del bueno, o deja vacío para aplicarla tal como vino:\n\n` +
          lista.map((v, i) => `${i + 1}. ${v}`).join('\n')
      );
      if (elegido === null) return;
      const v = lista[Number(elegido) - 1];
      if (v) correcciones[f.campo] = v;
    }

    const aviso = [
      `Aplicar ${apertura.folio} — ${apertura.servicio}`,
      '',
      `Se suma${apertura.guardias === 1 ? '' : 'n'} ${apertura.guardias} guardia${
        apertura.guardias === 1 ? '' : 's'
      } al estado de fuerza.`,
      vieja
        ? `\nOjo: esta apertura es de ${apertura.fecha || apertura.periodo}. Si el servicio ya no opera, no la apliques: quedaría activo y contando guardias.`
        : '',
      '',
      'Si te equivocas, el botón Deshacer lo revierte mientras el servicio no haya facturado.',
    ]
      .filter(Boolean)
      .join('\n');
    if (confirm(aviso)) llamar('aplicar', { cuerpo: correcciones });
  }

  function deshacer() {
    const motivo = prompt(
      `Deshacer ${apertura.folio} — ${apertura.servicio}\n\n` +
        'El servicio sale del estado de fuerza y la apertura vuelve a quedar pendiente. ' +
        'NO se registra una cancelación: esto es para lo que se aplicó por error, no para un cliente que se fue.\n\n' +
        '¿Por qué se deshace?'
    );
    if (motivo === null) return;
    llamar('deshacer', { cuerpo: { motivo } });
  }

  function descartar() {
    const motivo = prompt(
      `Descartar ${apertura.folio} — ${apertura.servicio}\n\n` +
        'Deja de contar como pendiente. La apertura no se borra: sigue en el histórico, marcada como que no se aplicará.\n\n' +
        '¿Por qué no se va a aplicar?'
    );
    if (motivo === null) return;
    llamar('descartar', { cuerpo: { motivo } });
  }

  const boton = 'text-xs rounded-lg px-2 py-1 border disabled:opacity-50 whitespace-nowrap';

  return (
    <span className="space-y-1 inline-block" onClick={(e) => e.stopPropagation()}>
      <span className="flex flex-wrap gap-1">
        {aplicada ? (
          <button
            type="button"
            onClick={deshacer}
            disabled={!!ocupado}
            title="Quitarlo del estado de fuerza sin registrar una cancelación"
            className={`${boton} bg-slate-700/60 text-slate-300 border-slate-600/60 hover:bg-slate-700`}
          >
            {ocupado === 'deshacer' ? 'Deshaciendo…' : '↩ Deshacer'}
          </button>
        ) : descartada ? (
          <button
            type="button"
            onClick={() => llamar('descartar', { method: 'DELETE' })}
            disabled={!!ocupado}
            title="Devolverla a la cola de pendientes"
            className={`${boton} bg-slate-700/40 text-slate-400 border-slate-700 hover:bg-slate-700/70`}
          >
            {ocupado === 'descartar' ? 'Devolviendo…' : 'Devolver a pendientes'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={aplicar}
              title={
                fueraDeCatalogo.length
                  ? `Antes de aplicar hay que resolver: ${fueraDeCatalogo.map((f) => `${f.etiqueta} «${f.valor}»`).join(', ')}`
                  : undefined
              }
              disabled={!!ocupado}
              title="Crear el servicio en el estado de fuerza con los datos de esta apertura"
              className={`${boton} bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25`}
            >
              {ocupado === 'aplicar' ? 'Aplicando…' : 'Aplicar'}
            </button>
            <button
              type="button"
              onClick={descartar}
              disabled={!!ocupado}
              title="No se va a aplicar: sale de la cola de pendientes"
              className={`${boton} bg-transparent text-slate-500 border-slate-700/60 hover:text-slate-300`}
            >
              Descartar
            </button>
          </>
        )}
      </span>
      {error && <span className="block text-[11px] text-red-400 max-w-[220px]">{error}</span>}
    </span>
  );
}
