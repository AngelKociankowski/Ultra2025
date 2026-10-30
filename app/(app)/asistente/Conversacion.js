'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import Icono from '@/components/Icono';

/**
 * El hilo de la conversación.
 *
 * Vive en memoria y se pierde al cerrar la pestaña: el director lo decidió así.
 * Guardarlo obligaba a respaldarlo, a decidir quién puede leer la conversación
 * de otro y a poder borrarla —tres problemas nuevos para algo que casi nadie
 * vuelve a leer—.
 *
 * Lo que este componente NO hace, y es la mitad de su diseño: no calcula ni una
 * cifra. El bloque «De dónde salió esto» se pinta con las fichas que manda el
 * servidor, tal como vienen. Si el texto del asistente dijera un número y la
 * ficha dijera otro, aquí se verían los dos y se notaría, que es justo lo que se
 * quiere: el texto es prosa, la ficha es el dato.
 */
export default function Conversacion({ restantes, tope, consultas }) {
  const [hilo, setHilo] = useState([]);
  const [pregunta, setPregunta] = useState('');
  const [esperando, setEsperando] = useState(false);
  const [quedan, setQuedan] = useState(restantes);
  const [aviso, setAviso] = useState('');
  const abajo = useRef(null);

  const bajar = () => abajo.current?.scrollIntoView({ block: 'end' });

  async function preguntar(evento) {
    evento.preventDefault();
    const texto = pregunta.trim();
    if (!texto || esperando) return;

    // Los ocho pares que el servidor acepta. Se recortan aquí también para no
    // mandar una petición que ya se sabe que va a volver con un 400.
    const previas = hilo
      .filter((t) => t.texto)
      .slice(-16)
      .map((t) => ({ quien: t.quien, texto: t.texto }));

    setPregunta('');
    setAviso('');
    setEsperando(true);
    const mio = { quien: 'persona', texto };
    const suyo = { quien: 'asistente', texto: '', fichas: [], pantallas: [] };
    setHilo((h) => [...h, mio, suyo]);
    bajar();

    /** Cambia el último turno del hilo, que es el del asistente. */
    const cambiar = (fn) =>
      setHilo((h) => {
        const copia = [...h];
        copia[copia.length - 1] = fn(copia[copia.length - 1]);
        return copia;
      });

    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pregunta: texto, previas }),
      });

      if (!r.ok || !r.body) {
        // 429 y 503 llegan como JSON, no como canal: el mensaje ya viene escrito
        // en español desde el servidor y se enseña tal cual.
        let mensaje = 'El asistente no pudo contestar ahora mismo.';
        try {
          const json = await r.json();
          if (json?.error) mensaje = json.error;
        } catch {
          /* no vino JSON */
        }
        cambiar((t) => ({ ...t, error: mensaje }));
        setAviso(mensaje);
        if (r.status === 429) setQuedan(0);
        return;
      }

      // Un objeto JSON por renglón. Se junta lo que llega y se parte por saltos
      // de línea: un trozo de red puede cortar un renglón a la mitad.
      const lector = r.body.getReader();
      const decodificador = new TextDecoder();
      let resto = '';
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        resto += decodificador.decode(value, { stream: true });
        const renglones = resto.split('\n');
        resto = renglones.pop() || '';
        for (const renglon of renglones) {
          if (!renglon.trim()) continue;
          let evt;
          try {
            evt = JSON.parse(renglon);
          } catch {
            continue;
          }
          if (evt.tipo === 'texto') cambiar((t) => ({ ...t, texto: t.texto + evt.texto }));
          if (evt.tipo === 'consultando')
            cambiar((t) => ({ ...t, pantallas: [...t.pantallas, evt.pantalla] }));
          if (evt.tipo === 'ficha') cambiar((t) => ({ ...t, fichas: [...t.fichas, evt.ficha] }));
          if (evt.tipo === 'error') cambiar((t) => ({ ...t, error: evt.mensaje }));
          if (evt.tipo === 'fin' && typeof evt.restantes === 'number') setQuedan(evt.restantes);
          bajar();
        }
      }
    } catch {
      // Se conserva lo que ya llegó y las fichas que ya se obtuvieron: perder
      // media respuesta buena por un corte de red es peor que enseñarla con su
      // aviso.
      cambiar((t) => ({
        ...t,
        error: 'Se cortó la conexión con el asistente. Lo que llegó arriba sirve; vuelve a preguntar el resto.',
      }));
    } finally {
      setEsperando(false);
      bajar();
    }
  }

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>
          Te quedan <strong className="text-slate-300">{quedan}</strong> de {tope} preguntas hoy
        </span>
        <span>·</span>
        <span>
          {consultas} {consultas === 1 ? 'consulta' : 'consultas'} disponibles para tu rol
        </span>
      </div>

      {hilo.length === 0 ? (
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 px-4 py-3">
          <p className="text-xs text-slate-400">
            Por ejemplo: «¿cuántos guardias tenemos activos y cómo se reparten por zona?», «¿cómo registro
            una apertura?», «¿qué pasó el 5 de julio?».
          </p>
        </div>
      ) : null}

      <div className="space-y-3">
        {hilo.map((turno, i) =>
          turno.quien === 'persona' ? (
            <p key={i} className="text-sm text-white font-semibold">
              {turno.texto}
            </p>
          ) : (
            <div key={i} className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4 space-y-3">
              {turno.pantallas.length ? (
                <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <Icono nombre="buscar" tamano={12} />
                  Consultando {[...new Set(turno.pantallas)].join(', ')}
                </p>
              ) : null}

              {turno.texto ? (
                <p className="text-sm text-slate-200 whitespace-pre-wrap">{turno.texto}</p>
              ) : !turno.error ? (
                <p className="text-sm text-slate-500">Escribiendo…</p>
              ) : null}

              {turno.fichas.length ? (
                <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 px-3 py-2">
                  <p className="text-[11px] font-semibold text-slate-400">De dónde salió esto</p>
                  <ul className="mt-1 space-y-1">
                    {turno.fichas.map((f, j) => (
                      <li key={j} className="text-[11px] text-slate-400">
                        <Link href={f.enlace} className="text-slate-200 hover:underline">
                          {f.pantalla}
                        </Link>
                        {' · '}
                        {f.dato}: <strong className="text-white">{f.valor}</strong>
                        {' · '}consultado {f.consultado}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {turno.error ? (
                <p className="text-xs text-amber-300/90 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                  {turno.error}
                </p>
              ) : null}
            </div>
          )
        )}
        <div ref={abajo} />
      </div>

      <form onSubmit={preguntar} className="flex items-end gap-2">
        <textarea
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          onKeyDown={(e) => {
            // Enter manda, Mayús+Enter hace renglón: es lo que la gente espera
            // de una caja de conversación, y nadie lee una instrucción para eso.
            if (e.key === 'Enter' && !e.shiftKey) preguntar(e);
          }}
          rows={2}
          maxLength={1000}
          disabled={esperando || quedan === 0}
          placeholder={quedan === 0 ? 'Llegaste a tus preguntas de hoy' : 'Escribe tu pregunta'}
          className="flex-1 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={esperando || quedan === 0 || !pregunta.trim()}
          className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {esperando ? 'Esperando…' : 'Preguntar'}
        </button>
      </form>

      {aviso ? <p className="text-xs text-amber-300/90">{aviso}</p> : null}

      <p className="text-[11px] text-slate-600">
        El asistente solo consulta; no captura, no corrige y no factura. El costo del día es un estimado y
        se calcula sobre lo que reporta el servicio, no sobre la factura del proveedor.
      </p>
    </div>
  );
}
