import { redirect } from 'next/navigation';
import { usuarioActual } from '@/lib/auth';
import { navegacion, ROLES } from '@/lib/rbac';
import NavBar from '@/components/NavBar';

export default function AppLayout({ children }) {
  const usuario = usuarioActual();
  if (!usuario) redirect('/login');

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar
        usuario={usuario}
        items={navegacion(usuario.rol)}
        etiquetaRol={ROLES[usuario.rol]?.etiqueta || usuario.rol}
      />
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6">{children}</main>
      <footer className="border-t border-slate-800 py-4 text-center text-xs text-slate-600">
        Ultra Seguridad Privada — el estado de fuerza solo cambia por aperturas y cancelaciones.
      </footer>
    </div>
  );
}
