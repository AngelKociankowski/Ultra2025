/** @type {import('next').NextConfig} */
const nextConfig = {
  // La plataforma necesita servidor: sesiones, RBAC y SQLite.
  // (Antes era `output: 'export'`, que solo servía para el tablero estático.)
  experimental: {
    /**
     * `better-sqlite3` es nativo y no se puede empaquetar.
     *
     * El paquete del asistente va aquí por otra razón, y conviene dejarla escrita
     * porque el síntoma no la señala: al empaquetarlo, el compilador le reescribe
     * sus expresiones regulares y una de ellas queda inválida —«Range out of
     * order in character class»— y el build se cae al recoger los datos de la
     * ruta del chat. Pedido así, se carga tal cual en el servidor, que además es
     * lo que se quiere: ese paquete no tiene por qué entrar al paquete común que
     * comparten las veinte pantallas.
     */
    serverComponentsExternalPackages: ['better-sqlite3', '@anthropic-ai/sdk'],
  },
  images: {
    unoptimized: true,
  },
}

module.exports = nextConfig
