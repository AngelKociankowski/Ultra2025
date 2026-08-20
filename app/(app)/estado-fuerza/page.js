import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { listarServicios, catalogos, porArrancarResumen } from '@/lib/servicios';
import {
  periodosDisponibles,
  periodoVigente,
  serviciosDeCorte,
  catalogosDeCorte,
  repartoDeTurnos,
  comparativoCorte,
} from '@/lib/queries';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { gruposEditables } from '@/lib/rbac';
import { conteoComentarios } from '@/lib/comentarios';
import { facturasDelPeriodoPorServicio, numerosDelCorte, idsPorNombre } from '@/lib/facturacion';
import {
  estadoAlDia,
  movimientosDelDia,
  contrasteConCorte,
  comoDia,
  diasConMovimiento,
  desdeCuando,
} from '@/lib/dias';
import { hoy } from '@/lib/fechas';
import AvisoDia from './AvisoDia';
import Filtros from './Filtros';
import RepartoTurnos from '@/components/RepartoTurnos';
import CeldaFactura from '@/components/CeldaFactura';
import CeldaContrato from '@/components/CeldaContrato';
import Icono from '@/components/Icono';

export const dynamic = 'force-dynamic';

const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (p) => {
  const [a, m] = String(p).split('-');
  return `${MESES[Number(m)]} ${a}`;
};

const delta = (n, fmt = formatNumber) =>
  n === 0 ? '=' : `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}`;

const textoDia = (d) => {
  const [a, m, dd] = String(d).split('-');
  return `${Number(dd)} de ${MESES[Number(m)]} de ${a}`;
};

/**
 * Si el cliente nos pide REPSE, en tres estados.
 *
 * Dice si ESE cliente lo exige, no si ya se entregó el del mes. Por eso es un
 * dato del servicio y no un pendiente que cambie de un mes a otro.
 *
 * «Sin capturar» no es lo mismo que «no lo pide», y por eso son tres y no dos:
 * en ámbar va lo que nadie ha revisado —hoy los 217—, y poner «No» a un
 * servicio que nadie miró sería dar por respondida una pregunta que no se hizo.
 *
 * El cuarto caso es para un valor que no es ninguno de los dos. No debería
 * pasar —la captura solo ofrece sí y no—, pero en el histórico quedó un «0» que
 * nadie supo interpretar, y enseñarlo tal cual es mejor que esconderlo detrás
 * de un «falta» que haría creer que el renglón está vacío.
 *
 * Y en un corte cerrado no se dice nada: la foto mensual se guardó antes de que
 * el campo existiera y no lo trae. Pintar «falta» en ámbar en cada renglón de
 * cada mes viejo acusaría de una omisión que nadie cometió.
 */
function Repse({ valor, esCorte }) {
  if (esCorte) return <span className="text-slate-600" title="El corte de ese mes no guarda este dato">—</span>;
  if (valor === 'SÍ') return <span className="text-slate-200 font-medium">Sí</span>;
  if (valor === 'NO') return <span className="text-slate-500">No</span>;
  if (valor) return <span className="text-amber-300/70" title="Valor que no es sí ni no">«{valor}»</span>;
  return <span className="text-amber-300/70 text-[11px] whitespace-nowrap">Dato faltante</span>;
}

export default function EstadoFuerza({ searchParams }) {
  const usuario = usuarioActual();
  const vigente = periodoVigente();
  const periodos = periodosDisponibles(vigente);

  /**
   * Sin `periodo` en la URL se ve el mes en curso, que es el estado de fuerza
   * vivo: sale de `servicios` y cambia con aperturas y cancelaciones. Con un
   * periodo cerrado se ve su corte, que es la foto contra la que se facturó y
   * por eso no se edita.
   */
  const pedido = searchParams?.periodo || '';
  const esCorte = Boolean(pedido) && pedido !== vigente && periodos.some((p) => p.periodo === pedido);

  /**
   * Y con `dia` se ve una fecha concreta.
   *
   * Es el hueco que faltaba: entre «cómo está hoy» y «cómo cerró el mes» hay
   * treinta días donde caen las preguntas que de verdad se hacen —«¿con cuántos
   * amanecimos el 15?»—. Manda sobre el mes: pedir los dos a la vez no tendría
   * sentido, y el día es lo más específico de los dos.
   */
  const dia = comoDia(searchParams?.dia);
  const esDia = Boolean(dia) && !esCorte;

  const filtros = {
    estatus: searchParams?.estatus ?? 'ACTIVO',
    zona: searchParams?.zona || '',
    asesor: searchParams?.asesor || '',
    turno: searchParams?.turno || '',
    contrato: searchParams?.contrato || '',
    facturado: searchParams?.facturado || '',
    modalidad: searchParams?.modalidad || '',
    q: searchParams?.q || '',
    periodo: esCorte ? pedido : '',
  };

  const alDia = esDia ? estadoAlDia(dia, filtros) : null;
  const servicios = esDia ? alDia.servicios : esCorte ? serviciosDeCorte(pedido, filtros) : listarServicios(filtros);

  /**
   * El reparto por turno se calcula sobre los mismos filtros pero sin el de
   * turno. Si no, al elegir uno el panel se quedaría mostrando solo ése y no
   * habría manera de saltar a otro sin volver atrás.
   */
  const sinFiltroTurno = { ...filtros, turno: '' };
  const reparto = repartoDeTurnos(
    filtros.turno
      ? esDia
        ? estadoAlDia(dia, sinFiltroTurno).servicios
        : esCorte
          ? serviciosDeCorte(pedido, sinFiltroTurno)
          : listarServicios(sinFiltroTurno)
      : servicios
  );

  const cat = esCorte ? catalogosDeCorte(pedido) : catalogos();
  cat.turnos = reparto.turnos.map((t) => t.turno);

  // Los enlaces del panel conservan los demás filtros: elegir un turno afina la
  // búsqueda, no la reinicia.
  const otrosFiltros = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) if (v && k !== 'turno') otrosFiltros.set(k, v);
  const baseTurnos = `/estado-fuerza${otrosFiltros.toString() ? `?${otrosFiltros}` : ''}`;
  const comparativo = esCorte ? comparativoCorte(pedido) : null;
  // Un solo GROUP BY para toda la tabla, no una consulta por renglón.
  const notas = esCorte ? new Map() : conteoComentarios();
  const grupos = gruposEditables(usuario.rol);

  // El número de factura y el contrato se resuelven de una vez para toda la
  // tabla: una consulta agrupada, no una por renglón.
  // Siempre del periodo que se está viendo: la factura de mayo no es la de
  // agosto, y enseñar «la última que hubo» haría que un mes sin facturar
  // pareciera facturado.
  const periodoTabla = esCorte ? pedido : vigente;
  const facturasDelMes = facturasDelPeriodoPorServicio(periodoTabla);
  const numerosDelMes = esCorte ? new Map() : numerosDelCorte(periodoTabla);
  // En un corte, el renglón es del snapshot y no trae el id del servicio: se
  // resuelve por nombre, y solo cuando ese nombre no se repite.
  const idDe = esCorte ? idsPorNombre() : null;
  const servicioIdDe = (s) => (esCorte ? idDe.get(s.servicio) ?? null : s.id);

  const totalGuardias = servicios.reduce((a, s) => a + (s.total_guardias || 0), 0);
  const totalFactura = servicios.reduce((a, s) => a + (s.importe_factura || 0), 0);

  /**
   * Los cortes de 2023 y algunos de 2024 no traen la facturación capturada por
   * servicio —en esos meses se llevaba por quincenas en otras columnas—, así
   * que conviene decirlo en vez de mostrar un total en ceros como si fuera real.
   */
  /**
   * Los que ya están cerrados y todavía no se montan.
   *
   * Se avisan aquí y no se cuentan en el total: una apertura registrada el 20
   * con fecha del 28 es un servicio que existe en papel y no en la calle. Sin
   * el aviso, quien la capturó no lo encuentra en la lista y cree que no se
   * guardó.
   */
  const porArrancar = !esCorte && !esDia ? porArrancarResumen() : null;

  const conFactura = esCorte ? servicios.filter((s) => s.importe_factura).length : 0;
  const sinFacturacion = esCorte && servicios.length > 0 && conFactura < servicios.length / 2;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Estado de fuerza</h1>
            {esDia ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                al {textoDia(dia)}
              </span>
            ) : esCorte ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                corte de {nombreMes(pedido)} · cerrado
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                {nombreMes(vigente)} · en curso
              </span>
            )}
          </div>
          <p className="text-slate-400 text-sm mt-1">
            {formatNumber(servicios.length)} servicios · {formatNumber(totalGuardias)} guardias ·{' '}
            {formatCurrency(totalFactura)} facturación
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-end">
          {esDia ? (
            <p className="text-xs text-slate-500 max-w-md text-right">
              Una fecha del pasado es una reconstrucción y no se edita. Debajo dice qué parte es exacta y cuál no.
            </p>
          ) : esCorte ? (
            <p className="text-xs text-slate-500 max-w-md text-right">
              Un corte cerrado es el respaldo de lo que se facturó ese mes: no se edita, ni con permisos de
              administrador. Para cambiar la plantilla, vuelve al mes en curso.
            </p>
          ) : grupos.length > 0 ? (
            <p className="text-xs text-slate-500 max-w-md text-right">
              Tu rol puede editar: {grupos.map((g) => g.etiqueta).join(' · ')}. Abre un servicio para modificarlo.
            </p>
          ) : (
            <p className="text-xs text-slate-500">Tu rol tiene acceso de consulta sobre esta base.</p>
          )}
          <a
            href={`/api/cortes/${esCorte ? pedido : 'actual'}${esDia ? `?dia=${dia}` : ''}`}
            download
            className="shrink-0 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-1.5"
          >
            <Icono nombre="descargar" className="mr-1.5 -mt-0.5" />Descargar CSV
          </a>
        </div>
      </div>

      {comparativo && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400 bg-slate-800/30 border border-slate-700/50 rounded-xl px-4 py-2.5">
          <span className="text-slate-500">Contra {nombreMes(comparativo.previo)}:</span>
          <span className={comparativo.servicios >= 0 ? 'text-emerald-400' : 'text-red-400'}>
            {delta(comparativo.servicios)} servicios
          </span>
          <span className={comparativo.guardias >= 0 ? 'text-emerald-400' : 'text-red-400'}>
            {delta(comparativo.guardias)} guardias
          </span>
          <span className={comparativo.facturacion >= 0 ? 'text-emerald-400' : 'text-red-400'}>
            {delta(comparativo.facturacion, formatCurrency)} facturación
          </span>
        </div>
      )}

      {sinFacturacion && (
        <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5">
          Solo {conFactura} de {servicios.length} servicios traen importe de factura en este corte. En esos meses
          la hoja llevaba la facturación por quincenas, no por servicio; el total de arriba es lo que sí quedó
          capturado, no lo facturado del mes.
        </p>
      )}

      {esDia && (
        <AvisoDia
          fueraDeAlcance={alDia.fueraDeAlcance}
          limite={alDia.limite}
          dia={dia}
          exactitud={alDia.exactitud}
          contraste={contrasteConCorte(dia, totalGuardias, servicios.length)}
          movimientos={movimientosDelDia(dia)}
          guardias={totalGuardias}
          servicios={servicios.length}
        />
      )}

      {porArrancar?.servicios > 0 && filtros.estatus !== 'POR_ARRANCAR' && (
        <p className="text-xs text-slate-400 bg-slate-800/30 border border-slate-700/50 rounded-xl px-4 py-2.5">
          <strong className="text-slate-200">
            {formatNumber(porArrancar.servicios)} servicio{porArrancar.servicios === 1 ? '' : 's'}
          </strong>{' '}
          ya {porArrancar.servicios === 1 ? 'está registrado y arranca' : 'están registrados y arrancan'} más
          adelante — {formatNumber(porArrancar.guardias)} guardia{porArrancar.guardias === 1 ? '' : 's'},{' '}
          {porArrancar.servicios === 1 ? 'el' : 'el primero el'} {porArrancar.proxima}.{' '}
          {porArrancar.servicios === 1 ? 'No cuenta' : 'No cuentan'} aquí porque todavía no hay nadie en esa
          puerta.{' '}
          <Link href="/estado-fuerza?estatus=POR_ARRANCAR" className="text-cyan-400 hover:underline">
            Verlos
          </Link>
        </p>
      )}

      <Filtros
        valores={filtros}
        catalogos={cat}
        periodos={periodos}
        vigente={vigente}
        dia={dia}
        diaMinimo={desdeCuando()}
        diasConMovimiento={diasConMovimiento(esDia ? dia.slice(0, 7) : vigente)}
      />

      {/* En banda de una línea y no en tarjetas. Ocupaba cuatrocientos píxeles
          antes de que empezara la tabla, así que se entraba a la pantalla del
          estado de fuerza y lo primero que había que hacer era desplazarse para
          ver el estado de fuerza. En el tablero sigue en tarjetas: ahí el panel
          sí es el contenido y no la antesala de otra cosa. */}
      {reparto.turnos.length > 0 && (
        <RepartoTurnos
          reparto={reparto}
          base={baseTurnos}
          filtroActivo={filtros.turno}
          compacto
          titulo={filtros.turno ? `Viendo solo ${filtros.turno}` : 'Guardias por turno'}
        />
      )}

      <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
        {/* La tabla es más ancha que la pantalla y por eso se desplaza de lado.
              Sin más, al empujarla a la derecha se pierde de qué servicio es el
              renglón que se está leyendo: por eso la primera columna se queda
              pegada, con una sombra que avisa de que hay algo debajo. El
              encabezado se queda pegado arriba por lo mismo, doscientos
              renglones más abajo ya nadie recuerda qué columna era cuál. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1400px] border-separate border-spacing-0">
            <thead>
              <tr className="text-slate-400 text-xs [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-slate-900 [&>th]:border-b [&>th]:border-slate-700/60">
                {/* Cada columna junta lo que se lee junto. El nombre del
                    servicio y su razón social son el mismo dato visto de dos
                    maneras; la zona y el tipo describen dónde y de qué es; el
                    asesor y el supervisor son quién lo lleva. Repartirlos en
                    ocho columnas dejaba media pantalla en blanco y el renglón
                    sin caber. */}
                <th className="text-left px-4 py-3 !z-20 !sticky left-0 shadow-[1px_0_0_0_rgb(var(--s-700)/0.5)]">
                  Servicio
                </th>
                <th className="text-left px-3 py-3">Zona · tipo</th>
                {/* El REPSE va en columna propia y no de subtítulo de la zona.
                    No es un matiz de dónde está el servicio: es un requisito que
                    el cliente pone o no pone, y se consulta por sí solo —«¿a
                    cuáles nos lo piden?»—, así que tiene que poderse recorrer la
                    columna de arriba abajo. */}
                <th className="text-center px-3 py-3">REPSE</th>
                <th className="text-left px-3 py-3">Quién lo lleva</th>
                <th className="text-right px-3 py-3">Guardias y turnos</th>
                <th className="text-right px-3 py-3">Venta al mes</th>
                <th className="text-right px-3 py-3">Nómina y resultado</th>
                {/* Con el mes en el encabezado, la columna no admite dudas: lo
                    que hay debajo es la factura de ESE mes y de ningún otro. */}
                <th className="text-left px-3 py-3">Factura de {nombreMes(periodoTabla)}</th>
                <th className="text-left px-3 py-3">Contrato</th>
                <th className="text-center px-3 py-3">{esCorte ? 'Cobranza' : 'Estatus'}</th>
              </tr>
            </thead>
            <tbody>
              {servicios.map((s) => (
                <tr key={s.id} className="group hover:bg-slate-800/40 [&>td]:border-t [&>td]:border-slate-800/70">
                  <td className="px-4 py-2 max-w-[280px] sticky left-0 z-[1] bg-[var(--tarjeta)] group-hover:bg-[var(--tarjeta-señalada)] shadow-[1px_0_0_0_rgb(var(--s-700)/0.5)]">
                    <div className="flex items-baseline gap-1.5">
                      {esCorte ? (
                        <span className="text-white font-medium">{s.servicio}</span>
                      ) : (
                        <Link href={`/estado-fuerza/${s.id}`} className="text-white hover:text-cyan-400 font-medium">
                          {s.servicio}
                        </Link>
                      )}
                      {/* El contador de notas era una columna entera para un
                          número de una cifra que casi siempre está vacío. */}
                      {s.por_arrancar && (
                        <span
                          title={`Registrado, arranca el ${s.fecha_alta}. Todavía no cuenta en el estado de fuerza.`}
                          className="text-[10px] bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 rounded px-1.5 shrink-0 whitespace-nowrap"
                        >
                          arranca {s.fecha_alta}
                        </span>
                      )}
                      {!esCorte && notas.get(s.id) > 0 && (
                        <Link
                          href={`/estado-fuerza/${s.id}#comentarios`}
                          title={`${notas.get(s.id)} comentario(s)`}
                          className="text-[10px] bg-slate-700/60 text-slate-300 rounded-full px-1.5 shrink-0 hover:text-cyan-400"
                        >
                          <Icono nombre="comentario" tamano={11} className="mr-0.5" />{notas.get(s.id)}
                        </Link>
                      )}
                    </div>
                    {s.razon_social && s.razon_social !== s.servicio && (
                      <p className="text-[11px] text-slate-500 leading-tight truncate" title={s.razon_social}>
                        {s.razon_social}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                    {s.zona || '—'}
                    {/* El tipo solo cuando dice algo distinto de la zona. En los
                        servicios de Alpura los dos campos traen «ALPURA», y
                        repetir la misma palabra debajo de sí misma en cien
                        renglones no informa: hace ruido y de paso hace dudar de
                        si son de verdad dos datos. */}
                    {s.tipo && s.tipo !== s.zona && (
                      <span className="block text-[11px] text-slate-500">{s.tipo}</span>
                    )}
                  </td>
                  {/* Se enseña siempre, aunque esté vacío. Está en cero de 217
                      porque nunca hubo dónde ponerlo a la vista: una columna que
                      no se ve es una columna que nadie llena. */}
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <Repse valor={s.tipo_repse} esCorte={esCorte} />
                  </td>
                  <td className="px-3 py-2 text-slate-400 max-w-[170px]">
                    <span className="block truncate" title={s.asesor || ''}>{s.asesor || '—'}</span>
                    <span className="block text-[11px] text-slate-500 truncate" title={s.supervisor || ''}>
                      {s.supervisor || 'sin supervisor'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="text-white tabular-nums">{s.total_guardias}</span>
                    {/* El total no dice cómo está armada la plantilla: doce en
                        24 HRS y doce en 12X12 son la misma cifra y dos
                        operaciones distintas. En fichas sueltas se leen mejor
                        que en un renglón de texto separado por puntos. */}
                    {Object.keys(s.turnos || {}).length > 0 ? (
                      <span className="flex flex-wrap gap-1 justify-end mt-0.5">
                        {Object.entries(s.turnos).map(([t, n]) => (
                          <span
                            key={t}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300 whitespace-nowrap"
                          >
                            {t} <strong className="text-white">{n}</strong>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="block text-[11px] text-amber-300/70">sin desglose</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="text-slate-200 tabular-nums">
                      {s.importe_factura ? formatCurrency(s.importe_factura) : '—'}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {s.importe_sin_iva ? `${formatCurrency(s.importe_sin_iva)} sin IVA` : 'sin IVA: falta'}
                    </span>
                  </td>
                  {/* La venta sola no dice si el servicio conviene. La nómina es
                      lo que cuesta sostenerlo y el porcentaje lo que queda; los
                      dos vivían escondidos en la ficha, y sin ellos la tabla
                      enseña ingresos sin costo. Se pintan aunque falten, para
                      que se note dónde hay que capturar. */}
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="text-slate-300 tabular-nums">
                      {s.nomina_total ? formatCurrency(s.nomina_total) : (
                        <span className="text-amber-300/60 text-xs">falta</span>
                      )}
                    </span>
                    {/* Una utilidad sin nómina detrás no es una utilidad. En 25
                        servicios el archivo calculó (venta − 0) ÷ venta y dejó
                        un 100% que se lee como un negocio redondo cuando lo que
                        pasa es que nadie capturó el costo. Pintarlo en verde
                        sería repetir la mentira. */}
                    <span className="block text-[11px]">
                      {s.pct_utilidad === null || s.pct_utilidad === undefined ? (
                        <span className="text-slate-600">utilidad: falta</span>
                      ) : !s.nomina_total ? (
                        <span
                          className="text-amber-300/70"
                          title={`El archivo trae ${Math.round(s.pct_utilidad * 10) / 10}% de utilidad, pero sin nómina capturada ese porcentaje sale de restarle cero al importe. Captura la nómina para que signifique algo.`}
                        >
                          utilidad sin sustento
                        </span>
                      ) : (
                        <span className={s.pct_utilidad < 0 ? 'text-red-400' : 'text-emerald-400/80'}>
                          {Math.round(s.pct_utilidad * 10) / 10}% utilidad
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <CeldaFactura
                      servicioId={servicioIdDe(s)}
                      factura={facturasDelMes.get(servicioIdDe(s))}
                      historico={
                        esCorte
                          ? s.factura_mensual
                            ? { numero: String(s.factura_mensual).trim(), periodo: pedido }
                            : null
                          : numerosDelMes.get(s.id)
                      }
                      periodo={periodoTabla}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <CeldaContrato
                      servicioId={servicioIdDe(s)}
                      tiene={!!s.tiene_contrato}
                      archivo={esCorte ? null : s.contrato_archivo}
                      nombre={s.contrato_archivo_nombre}
                      vence={s.fecha_vencimiento_contrato}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    {esCorte ? (
                      <span className="text-xs text-slate-400">{s.status_cobranza || '—'}</span>
                    ) : (
                      <span
                        title={
                          s.estatus === 'SUSPENDIDO'
                            ? `En pausa desde ${s.suspendido_desde || 'sin fecha'}${
                                s.suspendido_motivo ? `: ${s.suspendido_motivo}` : ''
                              }`
                            : undefined
                        }
                        className={`text-xs px-2 py-0.5 rounded ${
                          {
                            ACTIVO: 'bg-emerald-500/20 text-emerald-300',
                            SUSPENDIDO: 'bg-amber-500/20 text-amber-300',
                          }[s.estatus] || 'bg-slate-600/40 text-slate-400'
                        }`}
                      >
                        {s.estatus}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {servicios.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                    Ningún servicio coincide con los filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
