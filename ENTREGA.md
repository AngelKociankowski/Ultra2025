# Entrega — Plataforma de Guardias Ultra

Guía corta para quien recibe el código. El detalle funcional y las decisiones
sobre los datos están en [README.md](README.md).

---

## Levantarlo en 3 comandos

```bash
npm install          # compila better-sqlite3, tarda un poco la primera vez
npm run seed         # crea data/ultra.db con los datos reales ya cargados
npm run dev          # http://localhost:3000
```

Entra con `angelk@corporativoultra.com` / `UltraGuardias2026`. Es la **única**
cuenta que crea el alta inicial; te va a pedir cambiar la contraseña antes de
dejarte pasar, y desde *Usuarios* se da de alta al resto del equipo.

Requiere **Node 20 o superior** (ver `.nvmrc`).

## Comprobar que todo está bien

```bash
npm run verify       # build + 62 pruebas
```

Las pruebas levantan la aplicación real contra una base desechable y verifican
la regla del negocio, los permisos por campo y el ciclo de vida de un servicio.
Si alguna falla, algo se rompió de verdad. Corren también en GitHub Actions
(`.github/workflows/ci.yml`).

### Simular un mes de operación

```bash
npm run start                            # en una terminal
BASE=http://localhost:3000 npm run simular   # en otra
```

Los cinco roles entran, hacen su trabajo, intentan lo que no les toca, y al
final se comprueba la resta:

```
guardias al inicio + altas − bajas = guardias al final
```

Sirve para validar un despliegue nuevo y para enseñar la plataforma sin tener
que inventar el guion. La salida de la última corrida está en
`evidencia/simulacion.txt`.

---

## Lo primero que conviene entender

**Un servicio solo entra al estado de fuerza con una apertura y solo sale con
una cancelación.** No es una convención documentada: no existe función para
crear ni borrar un servicio. `lib/servicios.js` es el único punto de escritura
de esa tabla y solo expone tres operaciones. Las rutas de alta y baja directa
responden 405 a propósito.

Si vas a tocar algo, empieza por ahí:

| Archivo | Qué resuelve |
|---|---|
| `lib/servicios.js` | único punto de escritura del estado de fuerza |
| `lib/rbac.js` | roles, permisos y qué campo puede editar cada uno |
| `lib/schema.sql` | todo el esquema, con comentarios de por qué está así |
| `lib/queries.js` | agregados del tablero y consulta de cortes mensuales |
| `lib/comentarios.js` | notas por servicio: quién escribe, quién borra |
| `lib/catalogos.js` | zonas, asesores y turnos: la lista de la que se captura |
| `lib/facturacion.js` | facturas, pagos y saldos; qué es adeudo y qué todavía no |
| `scripts/import-xlsx.mjs` | lee los dos `.xlsx` originales y arma `data/seed.json` |
| `scripts/seed.mjs` | carga `data/seed.json` a SQLite |

Los permisos son **por campo, no por pantalla**. Si jurídico manda contrato y
factura en la misma petición, se aplica el contrato y la factura vuelve en
`rechazados`. Esconder un botón no es un permiso.

Por el mismo motivo, **zona, asesor, forma de pago y turno se validan contra el
catálogo en el servidor**, no solo en la lista desplegable: si la API siguiera
aceptando texto libre, la lista sería una sugerencia. Quien alimenta el catálogo
es el administrador, desde *Catálogos*.

En cobranza manda la misma idea: **el saldo no se captura, se calcula**.
`importe_pendiente` y `saldo_vencido` viven en `servicios` como copia, pero los
escribe `recalcular()` a partir del libro de facturas; por API están bloqueados.
Y lo vencido no es todo lo que falta cobrar: solo lo que ya pasó su fecha de
vencimiento, que es `fecha de factura + días de crédito`.

---

## Dos tablas parecidas que NO son lo mismo

| | `servicios` | `snapshots` |
|---|---|---|
| Qué es | la plantilla viva del mes en curso | los 33 cortes mensuales cerrados |
| Cambia | solo con aperturas y cancelaciones | nunca |
| Para qué | operar | respaldo de lo que se facturó |

No hay `INSERT`, `UPDATE` ni `DELETE` sobre `snapshots` fuera del importador, y
ninguna ruta de API la expone para escritura. Si alguien pide "poder corregir un
mes cerrado", eso rompe el respaldo de facturación: lo correcto es reimportar
desde el `.xlsx`.

---

## Antes de ponerlo en producción

1. **El administrador inicial.** El alta crea solo esa cuenta, con una
   contraseña que hay que cambiar al primer acceso. Para sembrar con otro correo
   o contraseña:
   `SEED_ADMIN_EMAIL='...' SEED_PASSWORD='...' npm run seed:reset`.
   El resto del equipo se da de alta desde *Usuarios*, y cada quien pone su
   contraseña la primera vez que entra.
2. **Disco persistente.** La base es un archivo SQLite (`DATABASE_PATH`). En una
   plataforma con disco efímero —Vercel, por ejemplo— se pierde en cada
   despliegue. Usa un servidor con volumen, o migra a Postgres: el esquema es
   SQL plano y las consultas están todas en `lib/`.
3. **HTTPS.** La cookie de sesión ya se marca `secure` cuando
   `NODE_ENV=production`; sin TLS delante, no viaja.
4. **Respaldos.** Un `cp data/ultra.db` diario alcanza. La base es un solo
   archivo.

```bash
npm run build && npm run start
```

---

## Recargar los datos desde los Excel

```bash
npm run import:xlsx -- \
  --edo "ruta/Estado de Fuerza Ultra 2026.xlsx" \
  --mov "ruta/Aperturas, Cancelaciones, Reducciones... .xlsx"

npm run seed:reset
```

El importador contrasta cada periodo contra la tabla de comprobación de su
propia hoja y avisa cuáles no cuadran. Julio 2026 cuadra exacto: 880 guardias,
y también por zona y por tipo.

Ojo: `seed:reset` **borra la base**. Todo lo capturado en la plataforma desde el
último import se pierde. Cuando ya haya operación real, el import se usa para
traer meses históricos, no para recargar el mes en curso.

---

## Lo que quedó fuera

- **Cortes históricos con facturación incompleta.** En 2023 y buena parte de
  2024 la hoja llevaba la facturación por quincenas, no por servicio. La
  pantalla lo advierte en vez de mostrar ceros como si fueran reales.
- **Cierre de mes automático.** Hoy los cortes vienen del `.xlsx`. Cuando la
  operación viva en la plataforma, hará falta un proceso que congele el mes:
  copiar `servicios` a `snapshots` con el periodo que cierra.
- **Recuperación de contraseña por correo.** Hoy la restablece un administrador
  desde *Usuarios*.
- **Saldos de cobranza anteriores a la plataforma.** El libro de facturas
  arranca vacío a propósito: la hoja no traía una cuenta por cobrar factura por
  factura —solo un renglón con datos, y su «saldo vencido» medía otra cosa (lo
  que sobraba de la línea de crédito, negativo cuando había holgura)—. Si hace
  falta arrastrar el adeudo que ya existía, se captura como facturas abiertas
  con su fecha real; a partir de ahí las cuentas cierran solas.
- **Timbrado y CFDI.** La plataforma registra la factura y su cobranza, no la
  emite ante el SAT. El folio fiscal se captura si se tiene.
