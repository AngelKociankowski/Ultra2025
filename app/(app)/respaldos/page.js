import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import { listar, estado, DIAS_DIARIOS, MESES_MENSUALES, DIAS_ENTRE_COMPLETOS } from '@/lib/respaldos';
import Respaldos from './Respaldos';

export const dynamic = 'force-dynamic';

export default function PantallaRespaldos() {
  const usuario = usuarioActual();
  if (!puede(usuario.rol, 'respaldos')) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold text-white mb-2">Sin permiso</h1>
        <p className="text-slate-400 text-sm">Los respaldos los lleva el administrador.</p>
        <Link href="/" className="inline-block mt-4 text-sm text-cyan-400 hover:underline">
          ← Volver al tablero
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Respaldos</h1>
        <p className="text-slate-400 text-sm max-w-3xl">
          Cada respaldo es un solo archivo con la base entera y los PDF de las facturas. La plataforma hace uno al día
          sin que nadie se lo pida; el que de verdad protege es el que te bajas a tu computadora, porque es el único
          que no vive en el mismo servidor que está respaldando.
        </p>
      </div>

      <Respaldos inicial={listar()} estadoInicial={estado()} />

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-2">Cómo funciona</h2>
        <ul className="text-sm text-slate-400 space-y-2">
          <li>
            <strong className="text-slate-200">Automático, todos los días.</strong> El servidor revisa cada seis horas
            y, si el último respaldo ya tiene más de un día, hace otro. Si el servidor se reinicia, lo primero que hace
            es ponerse al corriente.
          </li>
          <li>
            <strong className="text-slate-200">Dos tamaños, a propósito.</strong> El de todos los días lleva{' '}
            <em>solo la base</em>, que es lo que cambia a diario y pesa poco. Los PDF de las facturas no cambian una vez
            subidos, así que copiarlos todos los días sería llenar el disco escribiendo lo mismo: van en el respaldo{' '}
            <em>completo</em>, que sale cada {DIAS_ENTRE_COMPLETOS} días y siempre que lo pidas tú con el botón.
          </li>
          <li>
            <strong className="text-slate-200">Se guardan los últimos {DIAS_DIARIOS} días</strong> completos, y de ahí
            para atrás uno por mes durante {MESES_MENSUALES} meses. El último completo nunca se borra solo, porque es
            el único que todavía tiene las facturas.
          </li>
          <li>
            <strong className="text-slate-200">Bájate uno cada semana</strong> y guárdalo donde guardas lo importante.
            Los respaldos del servidor te salvan de un error de captura o de una carga que salió mal; solo el que
            tienes tú te salva de que el servidor se pierda.
          </li>
          <li>
            <strong className="text-slate-200">El archivo se abre con doble clic.</strong> Es un .zip normal: adentro
            están <code className="text-slate-300">ultra.db</code>, la carpeta{' '}
            <code className="text-slate-300">archivos/</code> con las facturas, y un{' '}
            <code className="text-slate-300">respaldo.json</code> que dice qué había ese día.
          </li>
        </ul>
      </section>
    </div>
  );
}
