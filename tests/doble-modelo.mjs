/**
 * El doble del servicio externo del asistente.
 *
 * Es un servidor HTTP mínimo que habla el protocolo de la API de mensajes
 * —`POST /v1/messages` con `stream: true`, contestando los eventos de streaming
 * en orden— y que GUARDA cada cuerpo que recibe. Esto es lo que hace que todo lo
 * demás se pueda probar sin llave, y hace algo mejor que simular: el paquete de
 * verdad arma la petición de verdad, así que la prueba lee los bytes que habrían
 * salido a la red. Si mañana alguien mete la fecha de hoy en el prefijo, o le
 * ofrece a un rol una herramienta que no es suya, se ve aquí.
 *
 * El guion se le da al arrancarlo, y es una lista de turnos: «a la primera
 * llamada contesta pidiendo esta herramienta; a la segunda, este texto». Cada
 * turno puede ser:
 *
 *   { texto: 'lo que contesta' }
 *   { herramientas: [{ nombre: 'resumen_operacion', args: {} }] }
 *   { texto: '…', herramientas: [...] }          las dos cosas a la vez
 *   { cortar: true }                             se muere a media respuesta
 *   { estado: 500, error: 'algo' }               contesta un error HTTP
 *
 * Y `uso` en cualquiera de ellos cambia los tokens que reporta, que es lo que la
 * prueba del tope lee del contador.
 *
 * Las pruebas NO llaman al servicio de verdad, ni aquí ni en el CI: no hay llave
 * y no va a haberla.
 */

import http from 'node:http';

/** Los tokens que reporta una respuesta si el guion no dice otra cosa. */
const USO_POR_OMISION = {
  input_tokens: 500,
  output_tokens: 120,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 5200,
};

function sse(res, tipo, datos) {
  res.write(`event: ${tipo}\ndata: ${JSON.stringify({ type: tipo, ...datos })}\n\n`);
}

/**
 * Escribe un turno como la secuencia de eventos que manda el servicio.
 *
 * El orden importa y es el del protocolo: arranque del mensaje, un bloque por
 * cada cosa que contesta, el delta final con el motivo de parada y el uso, y el
 * cierre. El paquete del cliente los junta; si el orden estuviera mal, la prueba
 * fallaría en el cliente y no aquí, que es justo lo que se quiere de un doble.
 */
function escribirTurno(res, turno, modelo) {
  const uso = { ...USO_POR_OMISION, ...(turno.uso || {}) };
  const herramientas = turno.herramientas || [];

  sse(res, 'message_start', {
    message: {
      id: `msg_doble_${Math.random().toString(36).slice(2, 10)}`,
      type: 'message',
      role: 'assistant',
      model: modelo,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { ...uso, output_tokens: 1 },
    },
  });

  let indice = 0;

  if (turno.texto) {
    sse(res, 'content_block_start', { index: indice, content_block: { type: 'text', text: '' } });
    // En trozos, porque la pantalla pinta deltas y una respuesta de un solo
    // golpe no probaría que los junta bien.
    for (const trozo of String(turno.texto).match(/[\s\S]{1,24}/g) || []) {
      sse(res, 'content_block_delta', { index: indice, delta: { type: 'text_delta', text: trozo } });
    }
    sse(res, 'content_block_stop', { index: indice });
    indice += 1;
  }

  for (const h of herramientas) {
    const argumentos = JSON.stringify(h.args ?? {});
    sse(res, 'content_block_start', {
      index: indice,
      content_block: { type: 'tool_use', id: `toolu_doble_${indice}_${h.nombre}`, name: h.nombre, input: {} },
    });
    sse(res, 'content_block_delta', {
      index: indice,
      delta: { type: 'input_json_delta', partial_json: argumentos },
    });
    sse(res, 'content_block_stop', { index: indice });
    indice += 1;
  }

  sse(res, 'message_delta', {
    delta: { stop_reason: herramientas.length ? 'tool_use' : 'end_turn', stop_sequence: null },
    usage: { output_tokens: uso.output_tokens },
  });
  sse(res, 'message_stop', {});
}

/**
 * Levanta el doble y devuelve con qué manejarlo.
 *
 * @param {object[]} guion los turnos, en orden. Si se acaban, repite el último:
 *   así una prueba que hace tres preguntas iguales no tiene que escribir el
 *   mismo turno tres veces.
 */
export async function arrancarDoble(guion = [{ texto: 'Listo.' }]) {
  const peticiones = [];
  let turnos = [...guion];
  let llamadas = 0;

  const servidor = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/__peticiones')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(peticiones));
      return;
    }

    let crudo = '';
    req.on('data', (d) => (crudo += d));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'el doble solo habla de /v1/messages' }));
        return;
      }

      let cuerpo = null;
      try {
        cuerpo = JSON.parse(crudo);
      } catch {
        /* se guarda igual, en crudo */
      }
      // Se guarda el cuerpo Y la cabecera con la que llegó: una prueba quiere
      // poder afirmar que la llave viajó al servidor y no al navegador.
      peticiones.push({ cuerpo, crudo, cabeceras: req.headers });

      const turno = turnos[Math.min(llamadas, turnos.length - 1)] || { texto: 'Listo.' };
      llamadas += 1;

      if (turno.estado) {
        res.writeHead(turno.estado, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: turno.error || 'falla' } }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      if (turno.cortar) {
        // Media respuesta y se muere. Es el caso que hay que probar: la pantalla
        // conserva lo que llegó y el servidor sigue en pie.
        sse(res, 'message_start', {
          message: {
            id: 'msg_doble_cortado',
            type: 'message',
            role: 'assistant',
            model: cuerpo?.model || 'doble',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { ...USO_POR_OMISION, output_tokens: 1 },
          },
        });
        sse(res, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        sse(res, 'content_block_delta', {
          index: 0,
          delta: { type: 'text_delta', text: turno.texto || 'Lo que alcancé a decir' },
        });
        /**
         * Se deja salir lo escrito ANTES de matar el zócalo.
         *
         * Destruirlo en el mismo tic descarta lo que todavía estaba en el búfer,
         * y entonces el doble no estaría probando «se cae a media respuesta»
         * sino «no contesta nada», que es otro caso y ya lo cubre `estado`. Esta
         * espera es la diferencia entre las dos.
         */
        setTimeout(() => res.socket?.destroy(), 50);
        return;
      }

      escribirTurno(res, turno, cuerpo?.model || 'doble');
      res.end();
    });
  });

  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  const puerto = servidor.address().port;

  return {
    puerto,
    base: `http://127.0.0.1:${puerto}`,
    /** Las variables con las que se levanta la aplicación contra este doble. */
    env: {
      ANTHROPIC_API_KEY: 'llave-de-prueba-del-doble',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${puerto}`,
    },
    /** Todo lo que recibió, en orden. */
    peticiones: () => peticiones,
    /** El cuerpo de la última petición, que es lo que casi siempre se mira. */
    ultima: () => peticiones[peticiones.length - 1]?.cuerpo ?? null,
    /** Cambia el guion a media prueba, sin levantar otro servidor. */
    guionar(nuevo) {
      turnos = [...nuevo];
      llamadas = 0;
    },
    /** Olvida lo recibido, para que una prueba no vea lo de la anterior. */
    olvidar() {
      peticiones.length = 0;
      llamadas = 0;
    },
    async cerrar() {
      await new Promise((listo) => servidor.close(listo));
    },
  };
}
