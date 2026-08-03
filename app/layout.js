import './globals.css';

export const metadata = {
  title: 'Ultra | Plataforma de Guardias',
  description:
    'Estado de fuerza, aperturas y cancelaciones de servicios de guardias con control de accesos por rol.',
  authors: [{ name: 'Ultra Seguridad Privada' }],
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1020' },
  ],
};

/**
 * Se aplica el tema antes de que el navegador pinte: si esperáramos a React,
 * la primera vista saldría en día y luego saltaría a noche.
 * El valor por defecto es día.
 */
const APLICAR_TEMA = `try{var t=localStorage.getItem('ultra-tema');document.documentElement.dataset.tema=t==='noche'?'noche':'dia'}catch(e){document.documentElement.dataset.tema='dia'}`;

export default function RootLayout({ children }) {
  return (
    <html lang="es" data-tema="dia" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APLICAR_TEMA }} />
      </head>
      <body className="antialiased bg-slate-950 text-slate-300 min-h-screen">{children}</body>
    </html>
  );
}
