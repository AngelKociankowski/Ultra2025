import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { usuarioActual } from '@/lib/auth';
import { navegacion, ROLES } from '@/lib/rbac';
import { sinLeer } from '@/lib/avisos';
import { chatDisponible } from '@/lib/chat-modelo';
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
  /**
   * La pestaña del asistente solo existe si está configurado en este servidor.
   * Es una lectura de una variable de entorno, no de la base: no cuesta nada y
   * no puede fallar, así que esta línea no puede poner lenta ni tumbar ninguna
   * de las veinte pantallas que comparten este archivo.
   */
  const items = usuario.debe_cambiar_password ? [] : navegacion(usuario.rol, chatDisponible());

  // El contador va en el layout y no dentro de la barra porque la barra corre
  // en el navegador y esto lee la base. Con la contraseña prestada va en cero:
  // esa sesión no puede entrar a ningún lado todavía.
  const avisos = usuario.debe_cambiar_password ? 0 : sinLeer(usuario.id);

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar
        usuario={usuario}
        items={items}
        avisos={avisos}
        etiquetaRol={ROLES[usuario.rol]?.etiqueta || usuario.rol}
      />
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6">{children}</main>
      <footer className="border-t border-slate-700/60 py-4 text-center text-xs text-slate-500">
        Ultra Seguridad Privada — el estado de fuerza solo cambia por aperturas y cancelaciones.
      </footer>
    </div>
  );
}
