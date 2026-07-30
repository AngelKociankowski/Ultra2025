import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { usuarioActual } from '@/lib/auth';
import { navegacion, ROLES } from '@/lib/rbac';
import NavBar from '@/components/NavBar';

export default function AppLayout({ children }) {
  const usuario = usuarioActual();
  if (!usuario) redirect('/login');

  /**
   * Mientras la contraseña siga siendo la que puso el administrador, lo único
   * que se puede hacer es cambiarla. Evita que una cuenta recién dada de alta
   * se quede meses con una contraseña que conoce otra persona.
   */
  const ruta = headers().get('x-ruta') || '';
  if (usuario.debe_cambiar_password && ruta !== '/cuenta') redirect('/cuenta');

  /**
   * Con la contraseña prestada la barra va sin menú: no tiene sentido ofrecer
   * pantallas a las que el guardia de arriba no va a dejar entrar, y así no hay
   * clic que termine en una vista vacía.
   */
  const items = usuario.debe_cambiar_password ? [] : navegacion(usuario.rol);

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar
        usuario={usuario}
        items={items}
        etiquetaRol={ROLES[usuario.rol]?.etiqueta || usuario.rol}
      />
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6">{children}</main>
      <footer className="border-t border-slate-700/60 py-4 text-center text-xs text-slate-500">
        Ultra Seguridad Privada — el estado de fuerza solo cambia por aperturas y cancelaciones.
      </footer>
    </div>
  );
}
