# Poner la plataforma en línea

Guía para dejar el sistema funcionando en internet, con el dominio de la
empresa. Está escrita para que la siga alguien que no programa.

---

## Antes que nada: por qué no va en el hosting de GoDaddy

El hosting web común de GoDaddy —el de cPanel, el que sirve para una página de
WordPress— **entrega archivos**: alguien pide una página, el servidor manda el
archivo y se acabó.

Esto es otra cosa. Es un **programa que tiene que estar corriendo todo el
tiempo**, con una base de datos que escribe cada vez que se registra una
apertura o un pago. Ese tipo de hosting no ejecuta programas de Node.js —no da
acceso de terminal— así que la plataforma no puede vivir ahí.

**Lo que sí se hace, y es lo normal:** el dominio se queda en GoDaddy y se
apunta al servidor donde sí corre la plataforma. Para quien entra a
`guardias.tuempresa.com` no hay diferencia.

| | Dónde queda | Qué cuesta |
|---|---|---|
| El dominio | GoDaddy, como hasta hoy | lo que ya pagas |
| La plataforma | Render (o similar) | ~7 USD al mes |

---

## Paso 1 — Subir el código a GitHub

El servidor va a leer el código desde GitHub, así que primero tiene que estar
ahí. Con **GitHub Desktop** son cinco clics y no hace falta escribir comandos.

1. Descarga GitHub Desktop de <https://desktop.github.com> e instálalo.
2. Ábrelo y entra con la cuenta de GitHub de la empresa.
3. Descomprime el archivo `ultra2025-para-subir.zip` en una carpeta, por
   ejemplo `Documentos\Ultra2025`.
4. En GitHub Desktop: **File → Add local repository** y elige esa carpeta.
5. Arriba aparece el nombre de la rama. Pulsa **Publish branch** (o **Push
   origin** si ya existe).

Al terminar, el código está en `github.com/<tu-cuenta>/ultra2025`.

---

## Paso 2 — Crear el servidor

El repositorio trae un archivo `render.yaml` que ya le dice al proveedor todo lo
que necesita: cómo construir la aplicación, cómo arrancarla y —lo importante—
que necesita un **disco que no se borre** entre actualizaciones, porque ahí vive
la base de datos.

1. Entra a <https://render.com> y crea la cuenta con **Sign in with GitHub**.
2. Autoriza el acceso al repositorio `ultra2025`.
3. **New → Blueprint**, elige el repositorio y la rama que publicaste.
4. Te va a pedir un valor para **`SEED_PASSWORD`**: es la contraseña con la que
   entrarás la primera vez. Ponle una de al menos 8 caracteres y anótala.
5. Pulsa **Apply**. La primera construcción tarda entre 5 y 10 minutos.

> El plan tiene que ser **de paga**. Los gratuitos no admiten disco —la base se
> borraría en cada actualización— y además duermen el servidor cuando nadie lo
> usa. Si el nombre del plan del archivo (`starter`) ya no existe, elige en el
> menú el más barato que sí permita disco.

Cuando el tablero diga **Live**, Render te da una dirección terminada en
`.onrender.com`. Ábrela: ahí está la plataforma.

---

## Paso 3 — Primera entrada

- Usuario: `angelk@corporativoultra.com`
- Contraseña: la que pusiste en `SEED_PASSWORD`

El sistema te va a obligar a cambiarla antes de dejarte pasar a otra pantalla:
esa contraseña nació prestada. Después, desde **Usuarios**, das de alta al resto
del equipo con su rol.

La base arranca cargada con el Estado de Fuerza: 217 servicios y 880 guardias.

---

## Paso 4 — Conectar el dominio de GoDaddy

Conviene un subdominio, no el dominio principal: así la página pública de la
empresa sigue igual.

**En Render:** entra al servicio → **Settings → Custom Domain → Add** y escribe
`guardias.tuempresa.com`. Render te muestra un valor al que hay que apuntar
(algo terminado en `.onrender.com`). Cópialo.

**En GoDaddy:**

1. Entra a tu cuenta → **Mis productos → Dominios**, y en tu dominio elige
   **DNS** (o *Administrar DNS*).
2. **Agregar nuevo registro**:
   - **Tipo:** CNAME
   - **Nombre:** `guardias`
   - **Valor:** lo que copiaste de Render
3. **Guardar**.

El cambio suele tomar entre 10 minutos y una hora. Render instala solo el
certificado de seguridad, así que la dirección quedará con `https://` y su
candado.

---

## Paso 5 — Cuidados

- **No borres el disco** del servicio. Es la base de datos completa.
- **Respaldo:** cada mes, descarga desde *Estado de fuerza* el CSV del corte.
  Es tu copia legible fuera del sistema.
- **Actualizaciones:** cualquier cambio que se suba a GitHub, Render lo publica
  solo. La base no se toca: la siembra revisa si ya hay servicios cargados y no
  hace nada cuando los hay.
- **Contraseñas:** que cada quien tenga la suya. La plataforma obliga a
  cambiarla la primera vez.

---

## Otros proveedores

El repositorio trae también un `Dockerfile`, que sirve para cualquier proveedor
que acepte Docker —Railway, Fly.io, un servidor propio, incluso un VPS de
GoDaddy—. Las dos reglas no cambian:

1. Un **volumen persistente** montado donde apunte `DATABASE_PATH`.
2. Arrancar con `node scripts/seed.mjs && npm run start`.

```bash
docker build -t ultra-guardias .
docker run -p 3000:3000 -v ultra-datos:/datos ultra-guardias
```

Un VPS de GoDaddy sí podría correrlo, pero hay que administrar el servidor
—sistema operativo, certificados, respaldos, actualizaciones de seguridad—. Si
no hay alguien de sistemas, no compensa frente a los siete dólares.
