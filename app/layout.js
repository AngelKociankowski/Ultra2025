import './globals.css'

export const metadata = {
  title: 'Ultra Seguridad Privada | Dashboard Ejecutivo 2025',
  description: 'Dashboard de Business Intelligence para análisis ejecutivo de ventas, operaciones y estado de fuerza.',
  keywords: 'dashboard, business intelligence, seguridad privada, KPIs, ventas, operaciones',
  authors: [{ name: 'Ultra Seguridad Privada' }],
  openGraph: {
    title: 'Ultra Seguridad Privada | Dashboard Ejecutivo 2025',
    description: 'Dashboard de Business Intelligence para análisis ejecutivo',
    type: 'website',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  )
}
