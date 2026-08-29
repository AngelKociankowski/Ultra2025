'use client';

/**
 * La última red, para cuando lo que falla es el armazón de la página.
 *
 * `app/(app)/error.js` cubre las pantallas de dentro, pero si el que revienta
 * es el layout —la barra de navegación, el tema— no queda nadie que lo atrape y
 * el usuario ve una página en blanco. Esta reemplaza el documento entero, así
 * que no puede apoyarse en nada de la aplicación: ni en el layout, ni en las
 * clases de Tailwind, que viven en una hoja que quizá no cargó. Por eso los
 * estilos van escritos aquí a mano.
 */
export default function GlobalError({ error, reset }) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#f2f4f7',
          color: '#1a1a1a',
          fontFamily: '-apple-system, "Segoe UI", Roboto, Arial, sans-serif',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <p style={{ fontSize: 13, letterSpacing: '2px', color: '#888', margin: 0 }}>
            ULTRA SEGURIDAD PRIVADA
          </p>
          <h1 style={{ fontSize: 20, margin: '12px 0 8px' }}>La plataforma no pudo abrir</h1>
          <p style={{ fontSize: 14, color: '#555', lineHeight: 1.5, margin: 0 }}>
            Es un problema de la pantalla, no de tus datos: nada de lo que hayas capturado se perdió. Casi siempre se
            arregla recargando desde cero.
          </p>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 20 }}>
            <button
              onClick={() => reset()}
              style={{
                fontSize: 14, padding: '9px 14px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid #c9ccd2', background: '#fff', color: '#1a1a1a',
              }}
            >
              Intentar de nuevo
            </button>
            <button
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.set('v', Date.now().toString(36));
                window.location.replace(url.toString());
              }}
              style={{
                fontSize: 14, padding: '9px 14px', borderRadius: 8, cursor: 'pointer',
                border: 0, background: '#E7342B', color: '#fff',
              }}
            >
              Recargar desde cero
            </button>
          </div>

          {error?.digest && (
            <p style={{ fontSize: 11, color: '#999', marginTop: 18 }}>
              Referencia: <code>{error.digest}</code>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
