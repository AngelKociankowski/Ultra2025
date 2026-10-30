import { NextResponse } from 'next/server';
import { conPermiso, leerObjeto } from '@/lib/api';
import { PERMISO_ASISTENTE } from '@/lib/rbac';
import { chatDisponible, SinLlave } from '@/lib/chat-modelo';
import { conversar, usoEnCeros } from '@/lib/chat-conversacion';
import { hayCupo, anotarConsumo } from '@/lib/chat-tope';

export const dynamic = 'force-dynamic';

/** Lo más largo que se acepta de una pregunta. Lo que no cabe se avisa. */
const TOPE_PREGUNTA = 1000;
/** Y del hilo previo: ocho pares de turnos, de dos mil caracteres cada uno. */
const TOPE_PREVIAS = 16;
const TOPE_TURNO = 2000;

/**
 * El asistente contesta aquí, en streaming.
 *
 *   POST /api/chat
 *   cuerpo: { pregunta: string, previas: [{ quien: 'persona'|'asistente', texto }] }
 *
 *   200  application/x-ndjson  un objeto JSON por renglón
 *   400  cuerpo inválido
 *   401  sin sesión (lo da el portero de middleware.js)
 *   403  el rol no tiene el permiso del asistente
 *   429  sin cupo hoy; el mensaje dice cuándo vuelve
 *   503  sin llave, o el servicio externo no contesta
 *
 * DEL NAVEGADOR SOLO SE ACEPTA TEXTO LLANO. `previas` son pares de
 * `{ quien, texto }` y el servidor rearma la petición. Nunca se acepta un bloque
 * de herramienta ni un resultado de herramienta: si se aceptaran, cualquiera
 * podría fabricar un resultado falso —«la cartera vencida es tanto»— y metérselo
 * al modelo por la puerta de su propio navegador, que es la forma más barata de
 * sacar una cifra inventada con cara de dato.
 *
 * Se eligió ndjson y no SSE porque aquí no hace falta reconexión automática —si
 * se corta, se vuelve a preguntar— y un objeto por renglón se lee con cuatro
 * renglones en el cliente y con uno en una prueba.
 */
export const POST = conPermiso(PERMISO_ASISTENTE, async (request, { usuario }) => {
  // Sin llave se contesta 503 ANTES de mirar el cuerpo y antes de tocar la base.
  // Es el estado de producción hoy, y tiene que ser el camino más corto que hay.
  if (!chatDisponible()) {
    return NextResponse.json(
      {
        error:
          'El asistente no está configurado en este servidor. La plataforma funciona igual: lo que ' +
          'necesites se ve en las pantallas de siempre.',
      },
      { status: 503 }
    );
  }

  const cuerpo = await leerObjeto(request);

  const pregunta = typeof cuerpo.pregunta === 'string' ? cuerpo.pregunta.trim() : null;
  if (!pregunta) {
    return NextResponse.json({ error: 'Escribe una pregunta.' }, { status: 400 });
  }
  if (pregunta.length > TOPE_PREGUNTA) {
    return NextResponse.json(
      {
        error:
          `La pregunta trae ${pregunta.length.toLocaleString('es-MX')} caracteres y el tope son ` +
          `${TOPE_PREGUNTA.toLocaleString('es-MX')}. Córtala y no se recorta en silencio: lo que se ` +
          'quedara fuera podría ser justo lo que preguntabas.',
      },
      { status: 400 }
    );
  }

  const crudas = cuerpo.previas === undefined ? [] : cuerpo.previas;
  if (!Array.isArray(crudas)) {
    return NextResponse.json(
      { error: 'Lo que se habló antes va como una lista de turnos.' },
      { status: 400 }
    );
  }
  if (crudas.length > TOPE_PREVIAS) {
    return NextResponse.json(
      { error: `El hilo no puede traer más de ${TOPE_PREVIAS} turnos. Empieza una conversación nueva.` },
      { status: 400 }
    );
  }
  const previas = [];
  for (const turno of crudas) {
    // Un turno tiene que ser exactamente un par de texto llano. Cualquier otra
    // forma —un bloque de herramienta, un objeto con más campos, una lista— se
    // rechaza entera en vez de limpiarse: limpiar es cómo se cuela la décima
    // forma que nadie previó.
    if (!turno || typeof turno !== 'object' || Array.isArray(turno)) {
      return NextResponse.json({ error: 'Cada turno del hilo va como { quien, texto }.' }, { status: 400 });
    }
    const llaves = Object.keys(turno).sort();
    if (llaves.length !== 2 || llaves[0] !== 'quien' || llaves[1] !== 'texto') {
      return NextResponse.json(
        { error: 'Cada turno del hilo lleva solo «quien» y «texto», y nada más.' },
        { status: 400 }
      );
    }
    if (turno.quien !== 'persona' && turno.quien !== 'asistente') {
      return NextResponse.json({ error: 'En el hilo, «quien» es «persona» o «asistente».' }, { status: 400 });
    }
    if (typeof turno.texto !== 'string' || turno.texto.length > TOPE_TURNO) {
      return NextResponse.json(
        { error: `En el hilo, «texto» va como texto de hasta ${TOPE_TURNO} caracteres.` },
        { status: 400 }
      );
    }
    previas.push({ quien: turno.quien, texto: turno.texto });
  }

  // El cupo se mira ANTES de llamar al servicio externo.
  const cupo = hayCupo(usuario.id);
  if (!cupo.cupo) {
    return NextResponse.json({ error: cupo.motivo }, { status: 429 });
  }

  const uso = usoEnCeros();
  const renglon = (obj) => `${JSON.stringify(obj)}\n`;

  const canal = new ReadableStream({
    async start(controlador) {
      const texto = new TextEncoder();
      const mandar = (obj) => controlador.enqueue(texto.encode(renglon(obj)));
      let anotado = false;

      // Se anota una sola vez, pase lo que pase: la pregunta consumió un turno
      // del día aunque la respuesta se haya cortado a media frase.
      const anotar = () => {
        if (anotado) return null;
        anotado = true;
        try {
          return anotarConsumo(usuario.id, uso);
        } catch (error) {
          console.error('[chat] no se pudo anotar el consumo', error);
          return null;
        }
      };

      try {
        for await (const evento of conversar({ usuario, pregunta, previas, uso })) {
          mandar(evento);
        }
        anotar();
        mandar({ tipo: 'fin', restantes: hayCupo(usuario.id).restantes });
      } catch (error) {
        anotar();
        console.error('[chat] la conversación se cortó', error);
        mandar({
          tipo: 'error',
          mensaje:
            error instanceof SinLlave
              ? 'El asistente no está configurado en este servidor.'
              : 'El asistente se quedó sin respuesta a media frase. Lo que llegó arriba sirve; para el ' +
                'resto, vuelve a preguntar o míralo en la pantalla.',
        });
      } finally {
        controlador.close();
      }
    },
  });

  return new Response(canal, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // Sin esto, un proxy que junte la respuesta deja la pantalla en blanco
      // hasta el final y el streaming no se nota.
      'X-Accel-Buffering': 'no',
    },
  });
});
