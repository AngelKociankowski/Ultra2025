import './globals.css'

export const metadata = {
  title: 'Ultra | Plataforma de Guardias',
  description:
    'Estado de fuerza, aperturas y cancelaciones de servicios de guardias con control de accesos por rol.',
  authors: [{ name: 'Ultra Seguridad Privada' }],
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className="antialiased bg-slate-950 text-slate-100 min-h-screen">{children}</body>
    </html>
  )
}
