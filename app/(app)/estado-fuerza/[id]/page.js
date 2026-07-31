import Link from 'next/link';
import { notFound } from 'next/navigation';
import { usuarioActual } from '@/lib/auth';
import { obtenerServicio } from '@/lib/servicios';
import { gruposEditables, puede } from '@/lib/rbac';
import { CAMPOS } from '@/lib/campos';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { listarComentarios } from '@/lib/comentarios';
import EditorServicio from './EditorServicio';
import Comentarios from './Comentarios';
import CorreccionServicio from './CorreccionServicio';

export const dynamic = 'force-dynamic';

function Dato({ etiqueta, valor }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{etiqueta}</dt>
      <dd className="text-sm text-slate-200">{valor ?? '—'}</dd>
    </div>
  );
}

export default function DetalleServicio({ params }) {
  const usuario = usuarioActual();
  const s = obtenerServicio(Number(params.id));
  if (!s) notFound();

  const comentarios = listarComentarios(s.id);

  const grupos = gruposEditables(usuario.rol).map((g) => ({
    ...g,
    campos: g.campos.map((c) => ({ nombre: c, ...CAMPOS[c] })).filter((c) => c.etiqueta),
  }));

  const turnos = Object.entries(s.turnos || {});

  return (
    <div className="space-y-5">
      <div>
        <Link href="/estado-fuerza" className="text-sm text-slate-400 hover:text-cyan-400">
          ← Estado de fuerza
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
          <div>
            <h1 className="text-2xl font-bold text-white">{s.servicio}</h1>
            <p className="text-slate-400 text-sm">{s.razon_social || 'Sin razón social registrada'}</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2 py-1 rounded ${
                s.estatus === 'ACTIVO' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-600/40 text-slate-400'
              }`}
            >
              {s.estatus}
            </span>
            <span className="text-xs px-2 py-1 rounded bg-slate-700/60 text-slate-300">
              {s.total_guardias} guardias
            </span>
          </div>
        </div>
      </div>

      {s.estatus === 'BAJA' && (
        <p className="text-sm text-slate-300 bg-slate-700/30 border border-slate-600/50 rounded-xl px-4 py-3">
          Servicio dado de baja el <strong>{s.fecha_baja || '—'}</strong> por una cancelación. Si el servicio vuelve,
          se registra una apertura nueva; si la cancelación fue un error de captura, un administrador lo reactiva desde
          «Corregir captura».
        </p>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <h2 className="text-base font-semibold text-white mb-3">Datos generales</h2>
          <dl className="grid grid-cols-2 gap-3">
            <Dato etiqueta="Zona" valor={s.zona} />
            <Dato etiqueta="Tipo" valor={s.tipo} />
            <Dato etiqueta="Cluster" valor={s.cluster} />
            <Dato etiqueta="Estado" valor={s.estado_geo} />
            <Dato etiqueta="Supervisor" valor={s.supervisor} />
            <Dato etiqueta="Asesor" valor={s.asesor} />
            <Dato etiqueta="Gerente" valor={s.gerente} />
            <Dato etiqueta="Alta" valor={s.fecha_alta} />
            <Dato etiqueta="Dirección" valor={s.direccion} />
            <Dato etiqueta="Uniforme" valor={s.uniforme} />
          </dl>
          {turnos.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-slate-500 mb-1.5">Turnos</p>
              <div className="flex flex-wrap gap-1.5">
                {turnos.map(([k, v]) => (
                  <span key={k} className="text-xs bg-slate-700/60 text-slate-300 rounded px-2 py-0.5">
                    {k}: {v}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <h2 className="text-base font-semibold text-white mb-3">Facturación y cobranza</h2>
          <dl className="grid grid-cols-2 gap-3">
            <Dato etiqueta="Facturado" valor={s.facturado ? 'Sí' : 'No'} />
            <Dato etiqueta="Guardias en factura" valor={s.guardias_en_factura} />
            <Dato etiqueta="Importe de factura" valor={s.importe_factura ? formatCurrency(s.importe_factura) : null} />
            <Dato etiqueta="Importe sin IVA" valor={s.importe_sin_iva ? formatCurrency(s.importe_sin_iva) : null} />
            <Dato etiqueta="Nómina total" valor={s.nomina_total ? formatCurrency(s.nomina_total) : null} />
            <Dato etiqueta="% utilidad" valor={s.pct_utilidad != null ? `${s.pct_utilidad}%` : null} />
            <Dato etiqueta="Status cobranza" valor={s.status_cobranza} />
            <Dato etiqueta="Fecha de pago" valor={s.fecha_pago} />
            <Dato etiqueta="Días de crédito" valor={s.dias_credito} />
            <Dato etiqueta="Crédito máximo" valor={s.credito_maximo ? formatCurrency(s.credito_maximo) : null} />
            <Dato etiqueta="Pendiente de pago" valor={s.importe_pendiente ? formatCurrency(s.importe_pendiente) : null} />
            <Dato etiqueta="Saldo vencido" valor={s.saldo_vencido ? formatCurrency(s.saldo_vencido) : null} />
          </dl>
        </section>

        <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <h2 className="text-base font-semibold text-white mb-3">Contrato</h2>
          <dl className="grid grid-cols-2 gap-3">
            <Dato etiqueta="Cuenta con contrato" valor={s.tiene_contrato ? 'Sí' : 'No'} />
            <Dato etiqueta="Firma" valor={s.fecha_contrato} />
            <Dato etiqueta="Vencimiento" valor={s.fecha_vencimiento_contrato} />
            <Dato etiqueta="Condiciones" valor={s.condiciones_comerciales} />
          </dl>
          {s.comentarios_contrato && (
            <p className="text-xs text-slate-400 mt-3 bg-slate-900/50 rounded-lg p-2">{s.comentarios_contrato}</p>
          )}
        </section>
      </div>

      {grupos.length > 0 && s.estatus === 'ACTIVO' && (
        <EditorServicio servicio={s} grupos={grupos} rol={usuario.rol} />
      )}
      {puede(usuario.rol, 'corregir') && (
        <CorreccionServicio servicio={s} correcciones={s.correcciones} />
      )}

      {grupos.length === 0 && (
        <p className="text-sm text-slate-500 bg-slate-800/30 border border-slate-700/50 rounded-2xl px-4 py-3">
          Tu rol ({usuario.rol}) tiene acceso de consulta sobre este servicio. Los cambios al estado de fuerza se hacen
          con aperturas y cancelaciones.
        </p>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <h2 className="text-base font-semibold text-white mb-3">Movimientos del servicio</h2>
          <ul className="space-y-2 text-sm">
            {s.aperturas.map((a) => (
              <li key={`a${a.id}`} className="flex items-center justify-between gap-2 border-b border-slate-800/60 pb-1.5">
                <span className="text-emerald-400">
                  <span className="font-mono text-xs text-slate-500 mr-2">{a.folio}</span>
                  {a.tipo} +{a.guardias}
                </span>
                <span className="text-xs text-slate-500">{a.fecha || '—'}</span>
              </li>
            ))}
            {s.cancelaciones.map((c) => (
              <li key={`c${c.id}`} className="flex items-center justify-between gap-2 border-b border-slate-800/60 pb-1.5">
                <span className="text-red-400">
                  <span className="font-mono text-xs text-slate-500 mr-2">{c.folio}</span>
                  {c.tipo} -{c.guardias}
                  {c.motivo && <span className="text-slate-500 text-xs ml-2">{c.motivo}</span>}
                </span>
                <span className="text-xs text-slate-500">{c.fecha || '—'}</span>
              </li>
            ))}
            {s.aperturas.length === 0 && s.cancelaciones.length === 0 && (
              <li className="text-slate-500">Sin movimientos registrados en la plataforma.</li>
            )}
          </ul>
          {s.estatus === 'ACTIVO' && (puede(usuario.rol, 'apertura') || puede(usuario.rol, 'cancelacion')) && (
            <div className="flex flex-wrap gap-2 mt-4">
              {puede(usuario.rol, 'apertura') && (
                <Link
                  href={`/cancelaciones/nueva?servicio_id=${s.id}&modo=AMPLIACION`}
                  className="text-sm bg-emerald-600/80 hover:bg-emerald-500 text-ultra-blanco rounded-lg px-3 py-1.5"
                >
                  ＋ Ampliar
                </Link>
              )}
              {puede(usuario.rol, 'cancelacion') && (
                <>
                  <Link
                    href={`/cancelaciones/nueva?servicio_id=${s.id}&modo=REDUCCION`}
                    className="text-sm bg-amber-600/80 hover:bg-amber-500 text-ultra-blanco rounded-lg px-3 py-1.5"
                  >
                    − Disminuir
                  </Link>
                  <Link
                    href={`/cancelaciones/nueva?servicio_id=${s.id}&modo=CANCELACION`}
                    className="text-sm bg-red-600/80 hover:bg-red-500 text-ultra-blanco rounded-lg px-3 py-1.5"
                  >
                    ✕ Cancelar
                  </Link>
                </>
              )}
            </div>
          )}
        </section>

        <Comentarios
          servicioId={s.id}
          iniciales={comentarios}
          usuarioId={usuario.id}
          esAdmin={usuario.rol === 'admin'}
        />

        <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <h2 className="text-base font-semibold text-white mb-3">Historial de cambios</h2>
          <ul className="space-y-2 text-sm max-h-80 overflow-y-auto">
            {s.bitacora.map((b) => (
              <li key={b.id} className="border-b border-slate-800/60 pb-1.5">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-300">
                    <span className="text-xs bg-slate-700/60 rounded px-1.5 py-0.5 mr-2">{b.accion}</span>
                    {b.detalle}
                  </span>
                  <span className="text-xs text-slate-500 shrink-0">{b.creado_en}</span>
                </div>
                <p className="text-xs text-slate-500">
                  {b.usuario} · {b.rol}
                </p>
              </li>
            ))}
            {s.bitacora.length === 0 && <li className="text-slate-500">Sin cambios registrados.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
