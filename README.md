# 🛡️ Ultra Seguridad Privada | Dashboard Ejecutivo 2025

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/ultra-seguridad-dashboard)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38bdf8)](https://tailwindcss.com/)

Dashboard de Business Intelligence para análisis ejecutivo de ventas, operaciones y estado de fuerza.

## 📊 Métricas Principales

| Indicador | Valor | Meta | Status |
|-----------|-------|------|--------|
| 💰 Ventas YTD | $27,797,158 | $16,500,000 | ✅ 168.5% |
| 👮 Guardias Aperturados | 316 | 480 | ⚠️ 65.8% |
| 🏢 Servicios Activos | 233 | - | ↑ 17.7% |
| 📊 Variación Neta | +38 | - | ✅ Positivo |

## 🎯 Configuración de Metas

```
Meta Ventas/Mes    = 10 asesores × $150,000 = $1,500,000
Meta Guardias/Mes  = 10 asesores × 4 guardias = 40
```

## 🚀 Deploy

### Vercel (Recomendado)

1. Fork este repositorio
2. Conecta Vercel con GitHub
3. Importa el proyecto
4. Deploy automático

### Local

```bash
npm install
npm run dev
# Abrir http://localhost:3000
```

## 📁 Estructura

```
├── app/
│   ├── layout.js       # Layout + metadata
│   ├── page.js         # Dashboard (5 vistas)
│   └── globals.css     # Estilos
├── components/
│   ├── KPICard.js
│   ├── ChartCard.js
│   ├── InsightCard.js
│   ├── DataTable.js
│   ├── ProgressBar.js
│   └── MetricBadge.js
├── lib/
│   ├── data.js         # Datos y KPIs
│   └── utils.js        # Utilidades
└── package.json
```

## 📈 Vistas del Dashboard

| Vista | Descripción |
|-------|-------------|
| 📊 Resumen | KPIs principales, gráficos comparativos, insights clave |
| 💰 Ventas | Análisis mensual, ranking asesores, cumplimiento individual |
| 🔄 Operaciones | Aperturas vs cancelaciones, motivos, progreso mensual |
| 🏢 Estado de Fuerza | Servicios activos, distribución zona/tipo, top clientes |
| 👥 Comercial | Performance asesores, concentración, análisis de riesgo |

## 🛠️ Tecnologías

- **Framework:** Next.js 14
- **Estilos:** Tailwind CSS
- **Gráficos:** Recharts
- **Iconos:** Lucide React
- **Deploy:** Vercel

## 📋 Características

- ✅ 5 vistas especializadas
- ✅ +20 KPIs calculados
- ✅ Gráficos interactivos
- ✅ Tablas con ordenamiento
- ✅ Diseño responsive
- ✅ Dark theme
- ✅ Animaciones suaves
- ✅ Optimizado para Vercel

---

**Ultra Seguridad Privada © 2025**
