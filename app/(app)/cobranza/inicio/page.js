import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import { getDb } from '@/lib/db';
import { ESQUEMAS } from '@/lib/facturacion';
import { opciones } from '@/lib/catalogos';
import PuestaAlDia from './PuestaAlDia';

export const dynamic = 'force-dynamic';

export default function InicioCobranza() {
  const usuario = usuarioActual();
  if (!puede(usuario.rol, 'editar_finanzas')) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold text-white mb-2">Sin permiso</h1>
        <p className="text-slate-400 text-sm">La cobranza la llevan finanzas y el administrador.</p>
        <Link href="/" className="inline-block mt-4 text-sm text-cyan-400 hover:underline">
          ← Volver al tablero
        </Link>
      </div>
    );
  }

  const db = getDb();
  const totalActivos = db.prepare("SELECT COUNT(*) AS n FROM servicios WHERE estatus = 'ACTIVO'").get().n;
  const sinCondiciones = db
    .prepare(
      `SELECT COUNT(*) AS n FROM servicios
        WHERE estatus = 'ACTIVO' AND (esquema_facturacion IS NULL OR esquema_facturacion = '')`
    )
    .get().n;

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <Link href="/cobranza" className="text-sm text-slate-400 hover:text-cyan-400">
          ← Cobranza
        </Link>
        <h1 className="text-2xl font-bold text-white mt-2">Puesta al día de la cobranza</h1>
        <p className="text-slate-400 text-sm max-w-3xl">
          Dos trabajos de una sola vez, en este orden. El segundo no funciona sin el primero: sin saber cuándo se
          factura un servicio no hay fecha de vencimiento que calcular, y sin fecha de vencimiento el saldo no sabe
          qué está vencido.
        </p>
      </div>

      <PuestaAlDia
        esquemas={Object.entries(ESQUEMAS).map(([valor, e]) => ({ valor, ...e }))}
        formasPago={opciones().formasPago}
        sinCondiciones={sinCondiciones}
        totalActivos={totalActivos}
        periodo={new Date().toISOString().slice(0, 7)}
      />

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-2">Qué pasa con lo que cargues</h2>
        <ul className="text-sm text-slate-400 space-y-2">
          <li>
            Las facturas cargadas quedan marcadas como <strong className="text-slate-200">carga inicial</strong>:
            cuentan igual para el saldo —el cliente debe lo mismo— pero se distinguen de las que sí se emitieron
            aquí. Una cosa es lo que la plataforma vio suceder y otra lo que le contaron que ya había pasado.
          </li>
          <li>
            El vencimiento se calcula con la fecha de la factura y sus días de crédito, igual que cualquier otra. Una
            factura vieja sin pagar entrará directo a la cartera vencida, que es exactamente donde debe estar.
          </li>
          <li>
            Si te equivocas, ninguna se borra: se cancelan con motivo desde la ficha del servicio, y ahí queda
            registrado. Si el archivo entero salió mal, mejor cancélalas y vuelve a subirlo corregido.
          </li>
        </ul>
      </section>
    </div>
  );
}
