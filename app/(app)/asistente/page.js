import { usuarioActual } from '@/lib/auth';
import { puede, ROLES, PERMISO_ASISTENTE } from '@/lib/rbac';
import { chatDisponible } from '@/lib/chat-modelo';
import { hayCupo, gastoDelDia, gastoDelMes, TOPE_PREGUNTAS, TOPE_CENTAVOS } from '@/lib/chat-tope';
import { herramientasPara } from '@/lib/chat-herramientas';
import { GUIAS } from '@/scripts/guias/contenido.mjs';
import Conversacion from './Conversacion';

export const dynamic = 'force-dynamic';

/**
 * Las negritas de la guía, que están escritas como HTML porque la guía también
 * se imprime en una hoja.
 *
 * Se parten y se pintan como elementos en vez de meter el HTML tal cual: el
 * texto de las guías lo escribe una persona y la ficha de un servicio puede
 * traer un nombre con un signo raro. Insertar HTML sin leerlo es cómo un texto
 * se convierte en código, y aquí no hace falta: lo único que se quiere son las
 * negritas.
 */
function Negritas({ texto }) {
  const trozos = String(texto).split(/<\/?b>/);
  return (
    <>
      {trozos.map((t, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="text-white font-semibold">
            {t}
          </strong>
        ) : (
          <span key={i}>{t}</span>
        )
      )}
    </>
  );
}

/** Centavos de dólar escritos como los lee una persona. */
const centavos = (c) => `${(c / 100).toLocaleString('es-MX', { style: 'currency', currency: 'USD' })}`;

/** Una sección de la guía, con la forma que le toque según lo que traiga. */
function Seccion({ s }) {
  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4">
      <h3 className="text-sm font-semibold text-white">{s.titulo}</h3>
      {s.intro ? (
        <p className="text-xs text-slate-400 mt-1">
          <Negritas texto={s.intro} />
        </p>
      ) : null}
      {s.texto ? (
        <p className="text-xs text-slate-300 mt-1">
          <Negritas texto={s.texto} />
        </p>
      ) : null}
      {s.porque ? (
        <p className="text-xs text-slate-500 mt-1">
          <span className="text-slate-400">¿Por qué?</span> <Negritas texto={s.porque} />
        </p>
      ) : null}
      {s.pasos ? (
        <ol className="list-decimal list-inside text-xs text-slate-300 mt-2 space-y-1">
          {s.pasos.map((p, i) => (
            <li key={i}>
              <Negritas texto={p} />
            </li>
          ))}
        </ol>
      ) : null}
      {s.lista ? (
        <dl className="text-xs mt-2 space-y-1">
          {s.lista.map(([a, b], i) => (
            <div key={i}>
              <dt className="text-slate-300 font-semibold inline">
                <Negritas texto={a} />
              </dt>
              <dd className="text-slate-400 inline">
                {' — '}
                <Negritas texto={b} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {s.aviso ? (
        <p className="text-xs text-amber-300/90 mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <Negritas texto={s.aviso} />
        </p>
      ) : null}
      {s.nota ? (
        <p className="text-xs text-slate-500 mt-2">
          <Negritas texto={s.nota} />
        </p>
      ) : null}
    </section>
  );
}

/**
 * La pantalla del asistente.
 *
 * Tiene tres estados y ninguno de los tres es un error:
 *
 *   1. Sin llave —que es el estado de producción HOY— se enseña la guía del rol
 *      tal cual, y se dice con esas palabras que ahora mismo esto es lo único
 *      que la pantalla puede hacer. La mitad de lo que se pidió, los tutoriales,
 *      ya está escrita en el lenguaje de la casa y se contesta sin llamar a
 *      ningún servicio externo, sin costo y sin riesgo de que algo se invente.
 *      Por eso la pestaña se dibuja igual, haya llave o no: esconderla dejaba
 *      esta mitad construida y sin camino para llegar.
 *   2. Sin el permiso del asistente —el espectador— se enseña también su guía,
 *      con una línea que dice que el asistente es para quien trabaja en la
 *      plataforma. Ese rol tampoco ve la pestaña: aquí llega solo quien escriba
 *      la dirección a mano, y mandarlo a un 403 pelado sería castigarlo por
 *      curiosear.
 *   3. Con llave y con permiso, la conversación, y debajo la guía: la guía no se
 *      quita porque sigue siendo la respuesta más barata y más fiable a la mitad
 *      de las preguntas.
 */
export default function Asistente() {
  const usuario = usuarioActual();
  const rol = ROLES[usuario.rol];
  const guia = GUIAS.find((g) => g.rol === usuario.rol);
  const disponible = chatDisponible();
  const autorizado = puede(usuario.rol, PERMISO_ASISTENTE);
  const activo = disponible && autorizado;
  const cupo = activo ? hayCupo(usuario.id) : null;
  const consultas = herramientasPara(usuario.rol);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Asistente</h1>
        <p className="text-slate-400 text-sm max-w-3xl">
          Pregúntale en español por los datos que tu rol ya ve navegando, o por cómo se hace algo en la
          plataforma. Solo lee y explica: no cambia nada. Para hacer algo, te dice en qué pantalla se hace
          y te deja el enlace.
        </p>
      </div>

      {!autorizado ? (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 px-4 py-3 max-w-3xl">
          <p className="text-sm font-semibold text-white">El asistente es para quien trabaja en la plataforma</p>
          <p className="text-xs text-slate-400 mt-1">
            Tu rol ({rol?.etiqueta || usuario.rol}) consulta todo y no deja huella en ningún lado, y
            preguntarle al asistente sí la deja: queda anotado y cuesta. Lo que necesites se ve igual en tus
            pantallas, y aquí abajo está tu guía completa.
          </p>
        </div>
      ) : null}

      {autorizado && !disponible ? (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 px-4 py-3 max-w-3xl">
          <p className="text-sm font-semibold text-white">
            El asistente todavía no está configurado: ahora mismo esta pantalla solo puede enseñarte las guías
          </p>
          <p className="text-xs text-slate-400 mt-1">
            A este servidor le falta la llave del servicio que escribe las respuestas, así que de momento no
            hay con quién conversar sobre tus datos. No es una falla de la plataforma: todo lo demás funciona
            igual, y lo que necesites se ve en las pantallas de siempre. Lo que esta pantalla sí hace hoy está
            aquí abajo: tu guía completa, la misma hoja que se imprime.
          </p>
        </div>
      ) : null}

      {activo ? (
        <>
          <Conversacion restantes={cupo.restantes} tope={TOPE_PREGUNTAS} consultas={consultas.length} />
          {/*
            Dicho aquí y no solo en el mensaje de error: el día que el servicio
            se caiga o la llave caduque, la mitad útil de esta pantalla sigue en
            pie y conviene que la persona ya sepa que está ahí, en vez de leer
            «no pude contestar» y cerrar la pestaña.
          */}
          <p className="text-xs text-slate-500 max-w-3xl">
            Si el asistente no contesta —el servicio se cayó, o la llave caducó— esta pantalla sigue
            sirviendo: tu guía completa está aquí abajo y no depende de ningún servicio externo.
          </p>
        </>
      ) : null}

      {/*
        El gasto, solo para quien lleva el dinero.
        Va aquí y no en la conversación porque no es algo que se mire mientras se
        pregunta: es el número con el que se decide si el asistente se queda, se
        sube de escalón o se apaga. Y va con la palabra «estimado» delante,
        porque se calcula con las tarifas que este servidor tiene escritas y no
        con la factura del proveedor: presentarlo como exacto sería la misma
        clase de cifra con cara de verdad que este encargo viene a evitar.
      */}
      {activo && puede(usuario.rol, 'editar_finanzas') ? (
        <p className="text-xs text-slate-500 max-w-3xl">
          Gasto estimado del asistente: <strong className="text-slate-300">{centavos(gastoDelDia())}</strong>{' '}
          hoy de un tope de {centavos(TOPE_CENTAVOS)} para toda la empresa, y{' '}
          <strong className="text-slate-300">{centavos(gastoDelMes())}</strong> en el mes. Es un estimado
          calculado sobre lo que reporta el servicio, no la factura del proveedor.
        </p>
      ) : null}

      {guia ? (
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-white">Tu guía · {guia.titulo}</h2>
            <p className="text-xs text-slate-500">{guia.resumen}</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2 items-start">
            {guia.secciones.map((s, i) => (
              <Seccion key={i} s={s} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
