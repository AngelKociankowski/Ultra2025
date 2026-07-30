/** @type {import('next').NextConfig} */
const nextConfig = {
  // La plataforma necesita servidor: sesiones, RBAC y SQLite.
  // (Antes era `output: 'export'`, que solo servía para el tablero estático.)
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  images: {
    unoptimized: true,
  },
}

module.exports = nextConfig
