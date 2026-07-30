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

`data/seed.json` se extrajo de los dos archivos reales:

- **31 cortes mensuales** del Estado de Fuerza (oct-2023 a jul-2026), 1,467 renglones
- **154 servicios** distintos → altas por apertura
- **318 aperturas / incrementos** y **340 cancelaciones / reducciones** históricas
- Estado de fuerza reconstruido aplicando las cancelaciones en orden cronológico:
  **134 servicios activos, 2,684 guardias**

### ⚠️ Carga completa desde los .xlsx

La extracción se hizo vía Google Drive, cuya exportación a texto **trunca cada hoja**
(~30 renglones por pestaña en los cortes de 2026). Para cargar el 100% de los renglones,
usa los `.xlsx` locales:

```bash
npm run import:xlsx -- \
  --edo "C:/Users/skoci/Downloads/Estado de Fuerza Ultra 2026.xlsx" \
  --mov "C:/Users/skoci/Downloads/_Aperturas, Cancelaciones, Reducciones, Escoltas y Serv. Esp. 2025- 2026.xlsx"

npm run seed:reset
```

El importador lee las pestañas por nombre (`ENERO 2026`, `JULIO 2026`…), localiza la fila
de encabezados en cada hoja y mapea las columnas por nombre, así que tolera que las
pestañas tengan distinto número de columnas —como ya ocurre entre 2023 y 2026.

### Normalización

Las hojas traen al mismo asesor escrito de varias formas (`ISAI ALVARADO`,
`ISAÍ ALVARADO`, `Humberto Martínez`). El seed unifica asesor, zona, tipo y supervisor a
mayúsculas sin acentos para que los rankings no partan a una persona en tres.

---

## 🗂️ Estructura

```
app/
├── login/                     # acceso
├── (app)/                     # shell autenticado
│   ├── page.js                # tablero: KPIs, aperturas vs cancelaciones, contratos
│   ├── estado-fuerza/         # tabla filtrable + detalle con edición por bloques
│   ├── aperturas/nueva/       # captura con desglose de turnos y autorizaciones
│   ├── cancelaciones/nueva/   # cancelación total o reducción por turno
│   ├── bitacora/              # historial de cambios
│   └── usuarios/              # altas, roles, contraseñas, matriz de permisos
└── api/                       # auth, aperturas, cancelaciones, servicios, usuarios
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
