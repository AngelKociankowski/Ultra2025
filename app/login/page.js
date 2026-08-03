import LoginForm from './LoginForm';
import Logo from '@/components/Logo';
import TemaToggle from '@/components/TemaToggle';

export const metadata = { title: 'Acceso | Ultra' };

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="absolute top-4 right-4">
        <TemaToggle />
      </div>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Logo size={72} className="mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white tracking-tight">ULTRA</h1>
          <p className="text-[11px] tracking-[0.28em] text-slate-500 mt-1">SEGURIDAD PRIVADA</p>
          <p className="text-slate-400 text-sm mt-3">Plataforma de guardias — estado de fuerza</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
