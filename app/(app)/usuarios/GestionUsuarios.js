'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES } from '@/lib/rbac';

const input =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';

export default function GestionUsuarios({ usuarios, miId }) {
  const router = useRouter();
  const [nuevo, setNuevo] = useState({ nombre: '', email: '', rol: 'operaciones', password: '' });
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  async function llamar(metodo, cuerpo) {
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await fetch('/api/usuarios', {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const data = await res.json();
      if (!res.ok) {
        setMensaje({ tipo: 'error', texto: data.error || 'No se pudo completar la operación.' });
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error de red.' });
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function crear(e) {
    e.preventDefault();
    const ok = await llamar('POST', nuevo);
    if (ok) {
      setMensaje({ tipo: 'ok', texto: `Usuario ${nuevo.nombre} creado.` });
      setNuevo({ nombre: '', email: '', rol: 'operaciones', password: '' });
    }
  }

  async function cambiarRol(id, rol) {
    const ok = await llamar('PATCH', { id, rol });
    if (ok) setMensaje({ tipo: 'ok', texto: 'Rol actualizado.' });
  }

  async function alternarActivo(u) {
    const ok = await llamar('PATCH', { id: u.id, activo: !u.activo });
    if (ok) setMensaje({ tipo: 'ok', texto: `${u.nombre} ${u.activo ? 'desactivado' : 'activado'}.` });
  }

  async function reiniciarPassword(u) {
    const password = window.prompt(`Nueva contraseña para ${u.nombre} (mínimo 8 caracteres):`);
    if (!password) return;
    const ok = await llamar('PATCH', { id: u.id, password });
    if (ok) setMensaje({ tipo: 'ok', texto: `Contraseña de ${u.nombre} restablecida.` });
  }

  return (
    <div className="space-y-4">
      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-3">Alta de usuario</h2>
        <form onSubmit={crear} className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Nombre</label>
            <input required value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} className={input} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Correo</label>
            <input required type="email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} className={input} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Rol</label>
            <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })} className={input}>
              {Object.entries(ROLES).map(([k, r]) => (
                <option key={k} value={k}>
                  {r.etiqueta}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Contraseña</label>
            <input
              required
              type="password"
              minLength={8}
              value={nuevo.password}
              onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })}
              className={input}
            />
          </div>
          <button
            type="submit"
            disabled={ocupado}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm rounded-lg px-4 py-2"
          >
            Crear usuario
          </button>
        </form>
        {mensaje && (
          <p
            className={`mt-3 text-sm rounded-lg px-3 py-2 border ${
              mensaje.tipo === 'ok'
                ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
                : 'text-red-300 bg-red-500/10 border-red-500/30'
            }`}
          >
            {mensaje.texto}
          </p>
        )}
      </section>

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-slate-900/60">
              <tr className="text-slate-400 text-xs">
                <th className="text-left px-4 py-3">Nombre</th>
                <th className="text-left px-3 py-3">Correo</th>
                <th className="text-left px-3 py-3">Rol</th>
                <th className="text-center px-3 py-3">Estado</th>
                <th className="text-right px-3 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} className="border-t border-slate-800/70">
                  <td className="px-4 py-2 text-white">
                    {u.nombre}
                    {u.id === miId && <span className="text-xs text-slate-500 ml-2">(tú)</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{u.email}</td>
                  <td className="px-3 py-2">
                    <select
                      value={u.rol}
                      onChange={(e) => cambiarRol(u.id, e.target.value)}
                      disabled={ocupado}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                    >
                      {Object.entries(ROLES).map(([k, r]) => (
                        <option key={k} value={k}>
                          {r.etiqueta}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${u.activo ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-600/40 text-slate-400'}`}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={() => reiniciarPassword(u)}
                      disabled={ocupado}
                      className="text-xs text-cyan-400 hover:underline"
                    >
                      Contraseña
                    </button>
                    <button
                      onClick={() => alternarActivo(u)}
                      disabled={ocupado || u.id === miId}
                      className="text-xs text-slate-400 hover:underline disabled:opacity-40"
                    >
                      {u.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
