import LoginForm from './LoginForm';

export const metadata = { title: 'Acceso | Ultra' };

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🛡️</div>
          <h1 className="text-2xl font-bold text-white">Ultra Seguridad Privada</h1>
          <p className="text-slate-400 text-sm mt-1">Plataforma de guardias — estado de fuerza</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
