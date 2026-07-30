# 🛡️ Ultra Seguridad Privada — Plataforma de Guardias

Plataforma interna para operar el **Estado de Fuerza** con **aperturas y cancelaciones**
como únicos movimientos de entrada y salida, y con permisos por rol.

Sustituye el trabajo manual sobre los dos archivos:

- `Estado de Fuerza Ultra 2026.xlsx`
- `Aperturas, Cancelaciones, Reducciones, Escoltas y Serv. Esp. 2025-2026.xlsx`

Los datos de esos archivos ya vienen cargados (ver [Datos](#-datos)).

---

## 🔒 La regla que sostiene todo

> **Un servicio solo entra al estado de fuerza con una APERTURA y solo sale con una CANCELACIÓN.**

No es una convención: está impuesta por el código.

| Intento | Resultado |
|---|---|
| `POST /api/servicios` (alta directa) | **405** — "Registra una apertura en POST /api/aperturas" |
| `DELETE /api/servicios/:id` (baja directa) | **405** — "Registra una cancelación en POST /api/cancelaciones" |
| `PATCH /api/servicios/:id` con `estatus`, `servicio` o `total_guardias` | campo rechazado (`CAMPOS_BLOQUEADOS`) |

Ningún rol —**ni el admin**— tiene un permiso de "crear servicio" o "borrar servicio".
`lib/servicios.js` es el único punto de escritura de la tabla y solo expone
`registrarApertura()`, `registrarCancelacion()` y `actualizarServicio()`.

### Movimientos

| Movimiento | Efecto en el estado de fuerza |
|---|---|
| **Apertura** | Crea el servicio con estatus `ACTIVO` |
| **Temporal** | Igual que apertura, marcada como temporal |
| **Incremento** | Suma guardias a un servicio ya `ACTIVO` |
| **Reducción** | Resta guardias; el servicio sigue `ACTIVO` |
| **Cancelación** | Estatus `BAJA`, guardias a 0 |

Validaciones activas: no se incrementa un servicio dado de baja, no se cancela dos veces,
y una reducción que se llevaría todos los guardias se rechaza pidiendo una cancelación.

---

## 👥 Roles

| Rol | Consultar | Aperturas | Cancelaciones | Contratos | Facturas / pagos | Datos operativos | Usuarios |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Administrador** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Jurídico** | ✅ | — | — | ✅ | — | — | — |
| **Finanzas** | ✅ | — | — | — | ✅ | — | — |
| **Operaciones** | ✅ | ✅ | ✅ | — | — | — | — |
| **Ventas** | ✅ | ✅ | ✅ | — | — | — | — |

Los permisos son **por campo**, no por pantalla. Si jurídico manda contrato + factura en
la misma petición, se aplica el contrato y la factura se devuelve en `rechazados`.

**Campos de cada bloque** (`lib/rbac.js`):

- **Contrato** (admin, jurídico): `tiene_contrato`, `fecha_contrato`,
  `fecha_vencimiento_contrato`, `condiciones_comerciales`, `comentarios_contrato`
- **Facturación y cobranza** (admin, finanzas): `importe_factura`, `importe_sin_iva`,
  `guardias_en_factura`, `facturado`, `status_cobranza`, `fecha_pago`, `forma_pago`,
  `cobro`, `credito_maximo`, `dias_credito`, `importe_pendiente`, `saldo_vencido`,
  `nomina_total`, `nomina_prestaciones`, `resultado_servicio`, `pct_utilidad`, `utilidad_bruta`
- **Datos operativos** (admin): razón social, zona, tipo, supervisor, asesor, gerente,
  precio por guardia, sueldo, bono, uniforme, REPSE, observaciones…

Toda edición y todo movimiento quedan en la **bitácora** con usuario, rol, fecha y el
antes/después de cada campo.

---

## 🚀 Arranque

```bash
npm install
npm run seed        # carga data/seed.json a data/ultra.db
npm run dev         # http://localhost:3000
```

Usuarios que crea el seed (contraseña `UltraGuardias2026`, cámbiala al entrar):

| Correo | Rol |
|---|---|
| `admin@corporativoultra.com` | Administrador |
| `juridico@corporativoultra.com` | Jurídico |
| `finanzas@corporativoultra.com` | Finanzas |
| `operaciones@corporativoultra.com` | Operaciones |
| `ventas@corporativoultra.com` | Ventas |

Para otra contraseña inicial: `SEED_PASSWORD='...' npm run seed:reset`.

Producción:

```bash
npm run build && npm run start
```

> Necesita servidor Node (sesiones, RBAC y SQLite). No funciona como export estático;
> en Vercel usa una plataforma con disco persistente o mueve la base a Postgres.

---

## 📊 Datos

Todo sale del `.xlsx` de Estado de Fuerza Ultra 2026, leído entero (39 pestañas).

**Corte vigente — julio 2026:**

- **217 servicios activos · 880 guardias · $19,001,684 de facturación**
- 144 con contrato firmado · 52 con contrato ya vencido
- Zonas: NORTE 351, SUR 324, ALPURA 205 · Tipos: SERVICIOS 273, INDUSTRIA 230,
  ALPURA 200, CONDOMINIOS 177

Los 880 guardias cuadran exactos contra la tabla de comprobación de la propia hoja,
en sus tres cortes (total, por zona y por tipo).

Además se cargan **33 cortes mensuales** (oct-2023 a jul-2026), **220 aperturas /
incrementos** y **208 cancelaciones / reducciones**.

### Cómo está armada cada pestaña

Cada hoja mensual trae tres bloques, y de ellos salen cosas distintas:

| Bloque | Qué es | A dónde va |
|---|---|---|
| Principal | la plantilla que venía arrastrando | estado de fuerza del mes |
| `APERTURAS <MES>` | servicios abiertos ese mes | **también** estado de fuerza + una apertura |
| `CANCELADOS REDUCCIONES <MES>` | bajas y reducciones del mes | solo movimientos |

En julio son 869 + 11 = **880**, que es lo que declara la hoja. Contar solo el bloque
principal deja 869, y ese fue el error de la primera carga.

Tres detalles del parseo que importan:

- **La columna del servicio no siempre se llama igual** (`SERVICIO COMO NOMINA`, sin
  título, o `MIANBAO`). Lo estable es que va justo antes de `RAZON SOCIAL`.
- **Los títulos de sección se confunden con las observaciones.** Un renglón que dice
  "Reducción 1/7/26" en observaciones parece el encabezado del bloque de cancelados;
  por eso solo se toma como título un renglón sin nombre y sin cifra de guardias.
- **No se agrupa por nombre.** La hoja repite un sitio cuando tiene bloques de turnos
  distintos o razones sociales diferentes (ALPURA MACRO CEDIS, CESCO / KEMBIO).
  Agrupar perdería 13 servicios reales.
- **Los movimientos históricos no se reaplican.** El corte vigente ya refleja su
  resultado neto: un servicio cancelado en 2025 que sigue en la hoja de julio fue
  reabierto, así que reaplicar la baja lo sacaría de una plantilla en la que sí opera.

### ⚠️ Las sumas de facturación de la hoja se quedan cortas

`W218` suma `W4:W204` cuando hay datos hasta `W216`: al agregar renglones al final
nadie extendió el rango. Por eso la hoja muestra $17,905,149 y aquí sale $19,001,684.
Los guardias sí cuadran porque `Q218` y los `SUMIF` de zona/tipo sí abarcan todo.
Lo mismo pasa en 18 de los 33 cortes históricos; el importador lo reporta al terminar.

### Recargar los datos

```bash
npm run import:xlsx -- --edo "C:/ruta/Estado de Fuerza Ultra 2026.xlsx"
npm run seed:reset
```

`--mov "<Aperturas y Cancelaciones.xlsx>"` es opcional y solo agrega detalle (motivo de
cancelación, autorizaciones, precios) sobre movimientos que ya se detectaron. Sin ese
archivo, 130 de las 208 cancelaciones se quedan sin motivo; el tablero lo dice en vez de
inventarlo.

### Normalización

Las hojas traen al mismo asesor escrito de varias formas (`ISAI ALVARADO`,
`ISAÍ ALVARADO`, `Humberto Martínez`). El seed unifica asesor, zona, tipo y supervisor a
mayúsculas sin acentos para que los rankings no partan a una persona en tres.

---

## 🎨 Identidad

El emblema y la paleta vienen del *Currículum Corporativo Ultra 2026*: rojo `#E7342B`,
negro `#100C08`, gris `#CDCCCC`. El logo se extrajo como vector del PDF y vive en
`public/logo-ultra.svg` (también es el favicon).

**Modo día por defecto**, con conmutador día/noche en la barra superior que se recuerda
en `localStorage`. No hay clases duplicadas con la variante `dark:`: la paleta de Tailwind
apunta a variables CSS que `app/globals.css` redefine por tema, así que una sola clase
—`bg-slate-800`, `text-white`— sirve en los dos. El tema se aplica en un script del
`<head>` antes de pintar, para que no haya parpadeo al cargar.

---

## 🗂️ Estructura

```
public/logo-ultra.svg          # emblema Ultra (vector, sacado del currículum)
app/
├── globals.css                # variables de tema (día / noche)
├── icon.svg                   # favicon
├── login/                     # acceso
├── (app)/                     # shell autenticado
│   ├── page.js                # tablero: KPIs, aperturas vs cancelaciones, contratos
│   ├── estado-fuerza/         # tabla filtrable + detalle con edición por bloques
│   ├── aperturas/nueva/       # captura con desglose de turnos y autorizaciones
│   ├── cancelaciones/nueva/   # cancelación total o reducción por turno
│   ├── bitacora/              # historial de cambios
│   └── usuarios/              # altas, roles, contraseñas, matriz de permisos
└── api/                       # auth, aperturas, cancelaciones, servicios, usuarios
components/
├── Logo.js                    # emblema + nombre
├── TemaToggle.js              # conmutador día / noche
└── MovimientosChart.js        # gráfica (recharts, con colores por tema)
lib/
├── schema.sql                 # DDL
├── servicios.js               # ÚNICO punto de escritura del estado de fuerza
├── rbac.js                    # roles, permisos, campos por bloque
├── auth.js                    # scrypt + sesiones en base
├── queries.js                 # agregados del tablero
└── campos.js                  # etiquetas y tipos para la UI
scripts/
├── seed.mjs                   # carga data/seed.json
└── import-xlsx.mjs            # regenera seed.json desde los .xlsx
```

## 🛠️ Stack

Next.js 14 (App Router) · SQLite (better-sqlite3) · Tailwind CSS · Recharts ·
sesiones con cookie httpOnly y hash scrypt.

---

**Ultra Seguridad Privada © 2026**
