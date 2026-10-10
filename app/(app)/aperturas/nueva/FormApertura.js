'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AUTORIZACIONES_APERTURA } from '@/lib/campos';
import { PARA_OPERAR, PARA_COBRAR } from '@/lib/alta';
import CampoCatalogo from '@/components/CampoCatalogo';
import { MODALIDADES } from '@/lib/modalidades';
import { EQUIPO } from '@/lib/equipo';
import { hoyLocal, formatCurrency } from '@/lib/utils';
import DesgloseTurnos from '@/components/DesgloseTurnos';
import DesglosePuestos from '@/components/DesglosePuestos';
import AsesoresExtra from '@/components/AsesoresExtra';

const input =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';
const label = 'block text-xs text-slate-400 mb-1';

/** Aviso para cuando el catálogo está vacío: el capturista no puede resolverlo. */
function SinCatalogo({ que }) {
  return (
    <p className="text-[11px] text-amber-300/80 mt-1">
      No hay {que} en el catálogo.{' '}
      <Link href="/catalogos" className="underline">
        Un administrador las da de alta
      </Link>
      .
    </p>
  );
}

/**
 * Una sección del segundo tramo.
 *
 * Plegada, y abierta sola cuando ya trae algo. Las dos mitades de esa regla
 * importan. Plegada, porque setenta controles en una sola caída es lo que hacía
 * que el alta se dejara a medias. Abierta cuando trae algo, porque esconder un
 * dato capturado es peor que enseñarlo: quien revisó la plataforma con lista en
 * mano reportó como faltantes varias cosas que sí estaban ahí, solo que no se
 * veían.
 *
 * El `open` se calcula y React solo toca el atributo cuando el cálculo cambia,
 * así que quien cierre una sección a mano la deja cerrada hasta que vuelva a
 * escribir dentro.
 */
function Tramo({ titulo, nota, abierta, children }) {
  return (
    <details
      open={abierta}
      className="bg-slate-800/30 border border-slate-700/50 rounded-2xl open:pb-5 [&[open]>summary]:border-b [&[open]>summary]:border-slate-700/50"
    >
      <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-slate-200 hover:text-white marker:text-slate-500">
        {titulo}
        {nota && <span className="block text-xs font-normal text-slate-500 mt-0.5">{nota}</span>}
      </summary>
      <div className="px-5 pt-4">{children}</div>
    </details>
  );
}

/**
 * Captura de una apertura, en dos tramos.
 *
 * Antes era una sola caída de unos setenta controles —veinte casillas solo en la
 * rejilla de jornadas, dieciséis de equipo, siete de autorizaciones— de los
 * cuales exactamente dos eran obligatorios. El efecto no era que se capturara
 * de más: era que no se capturaba nada. Quien cerraba un servicio en la calle
 * abría esta pantalla, veía que le faltaba el estado o el uniforme o los días
 * de crédito, y la dejaba para después. El servicio quedaba operando sin existir
 * en la plataforma.
 *
 * Arriba va lo que de verdad hace falta para abrirlo, abajo todo lo demás en
 * secciones plegadas, y el pie dice cuántos datos quedan pendientes para que
 * nadie se entere por sorpresa. Es una sola pantalla y no dos: quien sí trae
 * todos los datos los captura de corrido sin dar un paso extra.
 *
 * Lo que NO cambió es el cuerpo del `POST`: los campos solo se mudaron de sitio
 * en el JSX. El objeto `f` y el `fetch` están igual que antes, porque las
 * pruebas de la API —y la API— dependen de eso palabra por palabra.
 */
export default function FormApertura({ catalogos, opciones, esquemas, serviciosActivos }) {
  const router = useRouter();
  const [tipo, setTipo] = useState('APERTURA');
  const [f, setF] = useState({
    servicio: '',
    servicio_id: '',
    razon_social: '',
    direccion: '',
    zona: '',
    tipo_servicio: '',
    cluster: '',
    estado_geo: '',
    asesor: '',
    gerente: '',
    supervisor: '',
    hora_apertura: '',
    vehiculos_custodia: '',
    modalidad: 'FIJO',
    fecha_fin_prevista: '',
    fecha: hoyLocal(),
    precio_guardia: '',
    sueldo_base: '',
    bono: '',
    uniforme: '',
    credito_autorizado: false,
    dias_credito: '',
    credito_maximo: '',
    esquema_facturacion: '',
    forma_pago: '',
    cobro: '',
    tipo_repse: '',
    comentarios: '',
  });
  const [turnos, setTurnos] = useState({});
  // A qué hora se cubre cada jornada: {"12X36": {"NOCTURNO": 4}}. Opcional,
  // porque los 217 servicios que ya estaban no lo tienen y no se les puede
  // exigir hacia atrás; pero cuando se llena, tiene que cuadrar con la jornada.
  const [turnosDetalle, setTurnosDetalle] = useState({});
  // Los asesores además del principal. Van aparte del formulario porque el
  // principal es un campo y estos son una lista.
  const [asesoresExtra, setAsesoresExtra] = useState([]);
  // El desglose por puesto y sueldo. Se guarda como partidas de precio del
  // servicio, que es donde ya vivía: lo que faltaba era poder capturarlo al dar
  // de alta, que es cuando quien abre el servicio tiene el dato en la mano.
  const [puestos, setPuestos] = useState([]);
  const [equipo, setEquipo] = useState({});
  const [aut, setAut] = useState({});
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [enviando, setEnviando] = useState(false);

  const total = useMemo(
    () => Object.values(turnos).reduce((a, b) => a + (Number(b) || 0), 0),
    [turnos]
  );

  const esIncremento = tipo === 'INCREMENTO';
  const ayudaEsquema = esquemas.find((e) => e.valor === f.esquema_facturacion)?.ayuda;

  /**
   * Cuántos datos del segundo tramo quedan en blanco.
   *
   * Se cuenta con las mismas listas que usa `loQueFalta()` en la ficha, no con
   * una copia escrita a mano. Si fueran dos listas, el botón diría «se va a
   * abrir con 4 datos pendientes» y la ficha del servicio recién creado diría
   * cinco, y entonces ninguna de las dos cifras valdría nada.
   */
  const pendientes = useMemo(
    () => [...PARA_OPERAR, ...PARA_COBRAR].filter((c) => f[c] === '' || f[c] === null || f[c] === undefined),
    [f]
  );

  // Una sección se abre sola cuando alguno de sus campos ya trae algo.
  const conAlgo = (...campos) => campos.some((c) => f[c] !== '' && f[c] !== null && f[c] !== undefined);

  function set(k, v) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  function elegirServicioExistente(id) {
    const s = serviciosActivos.find((x) => String(x.id) === String(id));
    setF((prev) => ({
      ...prev,
      servicio_id: id,
      servicio: s?.servicio || '',
      razon_social: s?.razon_social || prev.razon_social,
      zona: s?.zona || prev.zona,
      asesor: s?.asesor || prev.asesor,
    }));
  }

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setOk('');
    if (total <= 0) {
      setError('Captura al menos un guardia en el desglose de jornadas.');
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch('/api/aperturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, tipo, turnos, turnos_detalle: turnosDetalle, asesores: asesoresExtra, partidas: puestos, guardias: total, aut, equipo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo registrar la apertura.');
        return;
      }
      setOk(`Apertura ${data.folio} registrada. El servicio ya está en el estado de fuerza.`);
      router.refresh();
      setTimeout(() => router.push(`/estado-fuerza/${data.servicioId}`), 900);
    } catch {
      setError('Error de red.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      {/* ------------------------------------------- tramo 1: lo indispensable */}
      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-white">Lo que hace falta para abrirlo</h2>
          <p className="text-xs text-slate-500 max-w-3xl mt-0.5">
            Cinco datos y el servicio entra al estado de fuerza. La zona y el asesor van aquí porque son por los que
            filtra y agrupa casi toda la plataforma: sin ellos, un servicio nuevo no le aparece a nadie en sus
            reportes.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {['APERTURA', 'INCREMENTO', 'TEMPORAL'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTipo(t);
                // Elegir TEMPORAL arriba ya dijo lo que hay que decir; repetirlo
                // en el bloque de abajo sobra, y olvidarlo es lo que dejaba
                // servicios de temporada viviendo años en el estado de fuerza.
                if (t === 'TEMPORAL') set('modalidad', 'TEMPORAL');
                if (t === 'APERTURA' && f.modalidad === 'TEMPORAL') set('modalidad', 'FIJO');
              }}
              className={`text-sm px-3 py-1.5 rounded-lg ${
                tipo === t ? 'bg-emerald-600 text-ultra-blanco' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          {esIncremento
            ? 'Incremento: suma guardias a un servicio que ya está activo.'
            : 'Apertura / temporal: crea un servicio nuevo en el estado de fuerza.'}
        </p>

        {!esIncremento && (
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
            <p className={label}>¿El servicio es fijo o termina?</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(MODALIDADES).map(([clave, m]) => (
                <button
                  key={clave}
                  type="button"
                  onClick={() => {
                    set('modalidad', clave);
                    if (clave === 'FIJO') set('fecha_fin_prevista', '');
                  }}
                  className={`text-sm px-3 py-1.5 rounded-lg ${
                    f.modalidad === clave
                      ? 'bg-cyan-600 text-ultra-blanco'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {m.etiqueta}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-2">{MODALIDADES[f.modalidad]?.descripcion}</p>

            {MODALIDADES[f.modalidad]?.llevaFin && (
              <div className="mt-3 max-w-xs">
                <label className={label}>¿Hasta cuándo?</label>
                <input
                  type="date"
                  value={f.fecha_fin_prevista}
                  onChange={(e) => set('fecha_fin_prevista', e.target.value)}
                  className={input}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Con la fecha, la plataforma avisa antes de que se pase. Sin ella, el servicio se queda en el
                  estado de fuerza hasta que alguien se acuerde de sacarlo.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {esIncremento ? (
            <div className="lg:col-span-2">
              <label className={label}>Servicio activo *</label>
              <select
                required
                value={f.servicio_id}
                onChange={(e) => elegirServicioExistente(e.target.value)}
                className={input}
              >
                <option value="">Selecciona…</option>
                {serviciosActivos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.servicio} — {s.total_guardias} guardias
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="lg:col-span-2">
              <label className={label}>Nombre del servicio *</label>
              <input required value={f.servicio} onChange={(e) => set('servicio', e.target.value)} className={input} />
            </div>
          )}

          <div>
            <label className={label}>Fecha de apertura *</label>
            <input required type="date" value={f.fecha} onChange={(e) => set('fecha', e.target.value)} className={input} />
          </div>

          <div>
            <label className={label} htmlFor="zona">
              Zona *
            </label>
            <CampoCatalogo
              id="zona"
              required
              valor={f.zona}
              opciones={opciones.zonas}
              onChange={(v) => set('zona', v)}
              vacio="— Selecciona zona —"
              className={input}
            />
            {opciones.zonas.length === 0 && <SinCatalogo que="zonas" />}
          </div>

          <div className="lg:col-span-2">
            <label className={label} htmlFor="asesor">
              Asesor *
            </label>
            <CampoCatalogo
              id="asesor"
              required
              valor={f.asesor}
              opciones={opciones.asesores}
              onChange={(v) => set('asesor', v)}
              vacio="— Selecciona asesor —"
              className={input}
            />
            {opciones.asesores.length === 0 && <SinCatalogo que="asesores" />}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
          <div className="flex items-baseline justify-between mb-2">
            <p className={label}>Guardias por jornada *</p>
            <span className="text-sm text-slate-400">
              Total: <strong className="text-emerald-400">{total}</strong> guardias
            </span>
          </div>
          {opciones.turnos.length === 0 && <SinCatalogo que="jornadas" />}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {opciones.turnos.map((t, i) => (
              <div key={t}>
                <label className="block text-[11px] text-slate-500 mb-0.5">{t}</label>
                <input
                  type="number"
                  min="0"
                  /**
                   * Obligatoria mientras la rejilla esté vacía.
                   *
                   * Las jornadas son el quinto dato del mínimo para abrir, pero
                   * son veinte casillas y una sola respuesta: poner `required`
                   * en todas pediría veinte números, y un campo oculto con
                   * `required` el navegador no lo sabe señalar —se niega a
                   * enviar y no dice dónde—. Así, hasta que haya un guardia
                   * capturado la primera casilla es la que el navegador marca,
                   * que es donde hay que mirar; en cuanto el total sube, deja de
                   * exigirse. Antes solo lo frenaban el JavaScript del botón y
                   * el servidor, y la rejilla no salía en los `required` del
                   * formulario.
                   */
                  required={total === 0 && i === 0}
                  value={turnos[t] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTurnos((prev) => {
                      const next = { ...prev };
                      if (v === '' || Number(v) === 0) delete next[t];
                      else next[t] = Number(v);
                      return next;
                    });
                    // Si la jornada se vacía, su reparto por turno deja de tener
                    // sentido: se va con ella en vez de quedarse colgando y
                    // reaparecer si alguien vuelve a teclear un número.
                    if (v === '' || Number(v) === 0) {
                      setTurnosDetalle((prev) => {
                        const next = { ...prev };
                        delete next[t];
                        return next;
                      });
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
            ))}
          </div>

          {/* El valor del guardia, aquí y no solo en el bloque de precios. Se
              pidió verlo justo al capturar la cantidad por jornada, y tiene
              sentido: es el momento en que uno decide si el número está bien, y
              «doce guardias» y «doce guardias son 96 mil al mes» son dos cosas
              distintas de mirar. */}
          {total > 0 && Number(f.precio_guardia) > 0 && (
            <p className="text-xs text-slate-400 mt-3 bg-slate-900/50 rounded-lg px-3 py-2">
              {total} guardias × {formatCurrency(Number(f.precio_guardia))} ={' '}
              <strong className="text-white">{formatCurrency(total * Number(f.precio_guardia))}</strong>{' '}
              al mes
            </p>
          )}
        </div>
      </section>

      {/* ------------------------------------- tramo 2: lo que puede esperar */}
      <div>
        <h2 className="text-base font-semibold text-white">Completar cuando lo tengas</h2>
        <p className="text-xs text-slate-500 max-w-3xl mt-0.5 mb-3">
          Nada de esto detiene el alta. El servicio queda señalado como incompleto hasta que lo llenes, y se completa
          desde su ficha.
        </p>

        <div className="space-y-3">
          <Tramo
            titulo="El cliente"
            nota="Razón social, dónde está y si pide REPSE."
            abierta={conAlgo('razon_social', 'direccion', 'estado_geo', 'cluster', 'tipo_servicio', 'tipo_repse')}
          >
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2">
                <label className={label}>Razón social</label>
                <input value={f.razon_social} onChange={(e) => set('razon_social', e.target.value)} className={input} />
              </div>

              <div>
                <label className={label} htmlFor="estado_geo">
                  Estado
                </label>
                <CampoCatalogo
                  id="estado_geo"
                  valor={f.estado_geo}
                  opciones={opciones.estados}
                  onChange={(v) => set('estado_geo', v)}
                  vacio="— Selecciona estado —"
                  className={input}
                />
                {opciones.estados.length === 0 && <SinCatalogo que="estados" />}
              </div>

              <div className="lg:col-span-3">
                <label className={label}>Dirección / ubicación</label>
                <input value={f.direccion} onChange={(e) => set('direccion', e.target.value)} className={input} />
              </div>

              <div>
                <label className={label}>Tipo de servicio</label>
                <input value={f.tipo_servicio} onChange={(e) => set('tipo_servicio', e.target.value)} list="tipos" className={input} />
                <datalist id="tipos">
                  {catalogos.tipos.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className={label}>Cluster</label>
                <input value={f.cluster} onChange={(e) => set('cluster', e.target.value)} className={input} />
              </div>

              <div>
                <label className={label} htmlFor="tipo_repse">
                  ¿El cliente pide REPSE?
                </label>
                <CampoCatalogo
                  id="tipo_repse"
                  valor={f.tipo_repse}
                  opciones={opciones.tiposRepse}
                  onChange={(v) => set('tipo_repse', v)}
                  vacio="— Sí o no —"
                  className={input}
                />
                {opciones.tiposRepse.length === 0 && <SinCatalogo que="valores de REPSE" />}
              </div>
            </div>
          </Tramo>

          <Tramo
            titulo="Quién lo lleva"
            nota="Gerente, supervisor y los demás asesores, si lo comparten."
            abierta={conAlgo('gerente', 'supervisor') || asesoresExtra.length > 0}
          >
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className={label} htmlFor="gerente">
                  Gerente a cargo
                </label>
                <CampoCatalogo
                  id="gerente"
                  valor={f.gerente}
                  opciones={opciones.gerentes}
                  onChange={(v) => set('gerente', v)}
                  vacio="— Selecciona gerente —"
                  className={input}
                />
                {opciones.gerentes.length === 0 && <SinCatalogo que="gerentes" />}
              </div>

              <div>
                <label className={label} htmlFor="supervisor">
                  Supervisor a cargo
                </label>
                <CampoCatalogo
                  id="supervisor"
                  valor={f.supervisor}
                  opciones={opciones.supervisores}
                  onChange={(v) => set('supervisor', v)}
                  vacio="— Selecciona supervisor —"
                  className={input}
                />
                {opciones.supervisores.length === 0 && <SinCatalogo que="supervisores" />}
              </div>

              <div>
                {/* Un servicio puede llevarlo más de un asesor, y hasta ahora el
                    campo aceptaba uno solo. Se notaba en los datos: hay dos
                    renglones del catálogo que en realidad son dos personas
                    juntas —los mismos dos, además, en distinto orden— y cinco
                    servicios con una barra en medio del nombre. Cuando el dato
                    no cabe en el campo, acaba metido a la fuerza en el que hay.

                    El de arriba sigue siendo el principal: es por el que filtran
                    las pantallas y por el que agrupan los cortes ya cerrados. */}
                <p className={label}>Otros asesores</p>
                <AsesoresExtra
                  principal={f.asesor}
                  lista={asesoresExtra}
                  setLista={setAsesoresExtra}
                  opciones={opciones.asesores}
                />
              </div>
            </div>
          </Tramo>

          <Tramo
            titulo="Cómo se cubre"
            nota="A qué hora arranca, el reparto por turno, los puestos y el uniforme."
            abierta={
              conAlgo('hora_apertura', 'uniforme') ||
              Object.keys(turnosDetalle).length > 0 ||
              puestos.length > 0
            }
          >
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className={label}>Hora de apertura</label>
                <input type="time" value={f.hora_apertura} onChange={(e) => set('hora_apertura', e.target.value)} className={input} />
                <p className="text-xs text-slate-500 mt-1">Con esta se cita al personal el primer día.</p>
              </div>

              <div>
                <label className={label} htmlFor="uniforme">
                  Tipo de uniforme
                </label>
                <CampoCatalogo
                  id="uniforme"
                  valor={f.uniforme}
                  opciones={opciones.uniformes}
                  onChange={(v) => set('uniforme', v)}
                  vacio="— Selecciona uniforme —"
                  className={input}
                />
                {opciones.uniformes.length === 0 && <SinCatalogo que="uniformes" />}
              </div>
            </div>

            <DesgloseTurnos
              turnos={turnos}
              detalle={turnosDetalle}
              setDetalle={setTurnosDetalle}
              turnosDia={opciones.turnosDia || []}
            />

            <DesglosePuestos
              filas={puestos}
              setFilas={setPuestos}
              puestos={opciones.puestos || []}
              jornadas={Object.keys(turnos)}
              plantilla={total}
            />
          </Tramo>

          <Tramo
            titulo="Equipo que se le entrega"
            nota="Un chaleco blindado o una patrulla cambian el costo del servicio."
            abierta={Object.keys(equipo).length > 0 || conAlgo('vehiculos_custodia')}
          >
            <p className="text-xs text-slate-500 mb-3 max-w-3xl">
              Es lo que hay que tener listo antes del primer turno. Deja en blanco lo que no lleve.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {EQUIPO.map((e) => (
                <div key={e.clave}>
                  <label className="block text-[11px] text-slate-500 mb-0.5">{e.etiqueta}</label>
                  <input
                    type="number"
                    min="0"
                    value={equipo[e.clave] ?? ''}
                    onChange={(ev) =>
                      setEquipo((prev) => {
                        const n = Math.max(0, Number(ev.target.value) || 0);
                        const sig = { ...prev };
                        if (n > 0) sig[e.clave] = n;
                        else delete sig[e.clave];
                        return sig;
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              ))}
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">Vehículos de custodia</label>
                <input
                  type="number"
                  min="0"
                  value={f.vehiculos_custodia}
                  onChange={(e) => set('vehiculos_custodia', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          </Tramo>

          <Tramo
            titulo="Cuánto cuesta y cuánto se cobra"
            nota="Precio por guardia, sueldo y bono."
            abierta={conAlgo('precio_guardia', 'sueldo_base', 'bono', 'comentarios')}
          >
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className={label}>Precio por guardia</label>
                <input type="number" step="any" value={f.precio_guardia} onChange={(e) => set('precio_guardia', e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>Sueldo base</label>
                <input type="number" step="any" value={f.sueldo_base} onChange={(e) => set('sueldo_base', e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>Bono</label>
                <input type="number" step="any" value={f.bono} onChange={(e) => set('bono', e.target.value)} className={input} />
              </div>
            </div>
            <div className="mt-3">
              <label className={label}>Comentarios</label>
              <textarea rows={2} value={f.comentarios} onChange={(e) => set('comentarios', e.target.value)} className={input} />
            </div>
          </Tramo>

          <Tramo
            titulo="Cómo se cobra"
            nota="El plazo del crédito no corre desde que se presta el servicio, sino desde que se emite la factura."
            abierta={conAlgo('esquema_facturacion', 'forma_pago', 'cobro', 'dias_credito', 'credito_maximo') || f.credito_autorizado}
          >
            <p className="text-xs text-slate-500 mb-3">
              Por eso hace falta saber cuándo se factura este cliente.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="lg:col-span-2">
                <label className={label} htmlFor="esquema">
                  Cuándo se factura
                </label>
                <CampoCatalogo
                  id="esquema"
                  valor={f.esquema_facturacion}
                  opciones={esquemas}
                  onChange={(v) => set('esquema_facturacion', v)}
                  vacio="— Selecciona —"
                  className={input}
                />
              </div>
              <div>
                <label className={label} htmlFor="forma-pago">
                  Forma de pago
                </label>
                <CampoCatalogo
                  id="forma-pago"
                  valor={f.forma_pago}
                  opciones={opciones.formasPago}
                  onChange={(v) => set('forma_pago', v)}
                  vacio="— Selecciona —"
                  className={input}
                />
              </div>
              <div>
                <label className={label}>Detalle del cobro</label>
                <input
                  value={f.cobro}
                  onChange={(e) => set('cobro', e.target.value)}
                  placeholder="Banco, cuenta, portal…"
                  className={input}
                />
              </div>
              <div>
                <label className={label}>¿Se autorizó crédito?</label>
                <label className="flex items-center gap-2 text-sm text-slate-200 h-[34px]">
                  <input
                    type="checkbox"
                    checked={f.credito_autorizado}
                    onChange={(e) => set('credito_autorizado', e.target.checked)}
                    className="w-4 h-4 accent-cyan-500"
                  />
                  {f.credito_autorizado ? 'Sí' : 'No'}
                </label>
              </div>
              <div>
                <label className={label}>Días de crédito</label>
                <input
                  type="number"
                  min="0"
                  value={f.dias_credito}
                  onChange={(e) => set('dias_credito', e.target.value)}
                  placeholder="0"
                  className={input}
                />
              </div>
              <div>
                <label className={label}>Línea de crédito</label>
                <input
                  type="number"
                  step="any"
                  value={f.credito_maximo}
                  onChange={(e) => set('credito_maximo', e.target.value)}
                  className={input}
                />
              </div>
            </div>

            {ayudaEsquema && (
              <p className="text-xs text-cyan-300/80 bg-cyan-500/5 border border-cyan-500/20 rounded-lg px-3 py-2 mt-3">
                {ayudaEsquema}{' '}
                {Number(f.dias_credito) > 0
                  ? `Cada factura vence ${f.dias_credito} días después de emitida; hasta entonces es cuenta corriente, no adeudo.`
                  : 'Sin días de crédito, la factura vence el mismo día en que se emite.'}
              </p>
            )}
          </Tramo>

          <Tramo
            titulo="Autorizaciones"
            nota="Se guardan junto con la apertura como evidencia de las firmas recabadas."
            abierta={Object.values(aut).some(Boolean)}
          >
            <div className="flex flex-wrap gap-3">
              {AUTORIZACIONES_APERTURA.map(([clave, etiqueta]) => (
                <label key={clave} className="flex items-center gap-2 text-sm text-slate-300 bg-slate-900/60 rounded-lg px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={!!aut[clave]}
                    onChange={(e) => setAut((prev) => ({ ...prev, [clave]: e.target.checked }))}
                    className="w-4 h-4 accent-emerald-500"
                  />
                  {etiqueta}
                </label>
              ))}
            </div>
          </Tramo>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}
      {ok && (
        <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
          {ok}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={enviando}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-ultra-blanco rounded-lg px-5 py-2.5 font-medium"
        >
          {enviando ? 'Registrando…' : `Registrar ${tipo.toLowerCase()} (${total} guardias)`}
        </button>
        {/* El número va antes de guardar y no después. Enterarse de que el
            servicio nació incompleto cuando ya está en el estado de fuerza es
            lo mismo que no enterarse: nadie vuelve. */}
        {pendientes.length > 0 && (
          <p className="text-xs text-amber-300/80 mt-2">
            Se va a abrir con {pendientes.length} dato{pendientes.length === 1 ? '' : 's'} pendiente
            {pendientes.length === 1 ? '' : 's'}.
          </p>
        )}
      </div>
    </form>
  );
}
