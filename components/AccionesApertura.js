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
  const LISTA_ZONA = { campo: 'zona', clave: 'zonas', etiqueta: 'zona', valor: apertura.zona };
  // La comparación ignora mayúsculas y acentos: «Traje» y «TRAJE» son el mismo
  // valor escrito distinto, y avisar de eso llenaría la lista de advertencias
  // que no son errores. «Centro», en cambio, no se parece a ninguna zona viva.
  const plano = (v) =>
    String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const fueraDeCatalogo = Object.entries(LISTAS)
    .filter(([campo, [clave]]) => {
      const v = apertura[campo];
      // Contra TODO lo que el catálogo conoce, no solo contra lo que ofrece
      // hoy. Un uniforme retirado —«Institucional», que sale en cuarenta y una
      // aperturas— no se puede elegir pero tampoco es un desconocido: avisar de
      // él sería llenar la lista de alarmas por cosas que están bien.
      const lista = opciones?.conocidos?.[clave] || opciones?.[clave];
      return v && lista?.length && !lista.some((o) => plano(o) === plano(v));
    })
    .map(([campo, [clave, etiqueta]]) => ({ campo, clave, etiqueta, valor: apertura[campo] }));

  /** Pregunta por un campo y devuelve el valor elegido, o null si se canceló. */
  function preguntar(f, encabezado) {
    const lista = opciones[f.clave];
    const elegido = prompt(
      `${apertura.servicio}\n\n${encabezado}\n\n` +
        `Escribe el número del bueno, o déjalo vacío para no cambiarlo:\n\n` +
        lista.map((v, i) => `${i + 1}. ${v}`).join('\n')
    );
    if (elegido === null) return null;
    return lista[Number(elegido) - 1] || undefined;
  }

  /**
   * Arreglar la apertura sin aplicarla.
   *
   * Es lo que faltaba: poder corregir al aplicar no alcanzaba, porque mientras
   * tanto la lista seguía enseñando el dato malo y el dato malo seguía
   * guardado. Las tres aperturas de agosto con zona «Centro» se arreglan aquí,
   * y se quedan arregladas.
   */
  async function corregir() {
    const cambios = {};
    for (const f of fueraDeCatalogo) {
      const v = preguntar(f, `Trae ${f.etiqueta} «${f.valor}», que no está en el catálogo.`);
      if (v === null) return;
      if (v) cambios[f.campo] = v;
    }
    if (!Object.keys(cambios).length) {
      // Sin nada fuera de catálogo, se ofrece cambiar la zona, que es el caso
      // que se repite: el dato está en la lista pero es el equivocado.
      const v = preguntar(LISTA_ZONA, `Zona actual: «${apertura.zona || '—'}».`);
      if (v === null || !v) return;
      cambios.zona = v;
    }
    llamar('corregir', { method: 'PATCH', cuerpo: cambios });
  }

  function aplicar() {
    // Antes de aplicar, se resuelve lo que no está en el catálogo. Se pregunta
    // una vez por campo, con la lista a la vista: obligar a abandonar y
    // arreglar el archivo por una zona mal escrita sería peor que el error.
    const correcciones = {};
    for (const f of fueraDeCatalogo) {
      const v = preguntar(
        f,
        `La apertura trae ${f.etiqueta} «${f.valor}», que no está en el catálogo. ` +
          'Si la aplicas así, el servicio entra con un valor que la plataforma no reconoce.'
      );
      if (v === null) return;
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
              onClick={corregir}
              disabled={!!ocupado}
              title={
                fueraDeCatalogo.length
                  ? `Arreglar: ${fueraDeCatalogo.map((f) => `${f.etiqueta} «${f.valor}»`).join(', ')}`
                  : 'Cambiar la zona u otro dato de catálogo antes de aplicarla'
              }
              className={`text-xs rounded-lg px-2.5 py-1.5 disabled:opacity-40 ${
                fueraDeCatalogo.length
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
              }`}
              type="button"
            >
              {ocupado === 'corregir' ? 'Corrigiendo…' : fueraDeCatalogo.length ? '⚠ Corregir' : 'Corregir'}
            </button>
            <button
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
