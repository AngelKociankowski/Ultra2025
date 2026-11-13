/**
 * Respaldos.
 *
 * La plataforma vive en un servidor con un disco. Mientras ese disco esté bien,
 * todo está bien; el día que no lo esté, sin respaldos no hay a dónde volver.
 * Ese es el único riesgo real que le queda a esta instalación, y esto es lo que
 * lo cierra.
 *
 * Un respaldo es UN archivo .zip con las dos cosas que importan:
 *
 *   - `ultra.db`, la base entera —servicios, movimientos, cobranza, usuarios,
 *     bitácora—, sacada con VACUUM INTO. Eso da una copia consistente aunque
 *     alguien esté capturando en ese momento: no es copiar el archivo a lo
 *     bruto y rezar.
 *   - `archivos/`, los PDF y XML de las facturas, que viven en el disco y no
 *     dentro de la base. Un respaldo que solo trajera la base dejaría las
 *     facturas atrás, que es la mitad del expediente fiscal.
 *
 * Y un `respaldo.json` con qué había adentro el día que se hizo. Sirve para dos
 * cosas: verlo en la pantalla sin abrir el zip, y para que al restaurar la
 * plataforma pueda decir «esto que me estás dando tiene 219 servicios y 2,600
 * facturas» antes de tocar nada.
 *
 * Dos maneras de que existan, y las dos hacen falta:
 *   - Solo: una copia diaria automática que se queda en el servidor. Protege de
 *     un error de captura, de una carga que salió mal, de un borrado.
 *   - Bajado: el administrador se lo lleva a su computadora. Es el único que
 *     protege de que el servidor se pierda, porque es el único que no está en
 *     el servidor.
 *
 * Y una tercera cosa que este archivo aprendió por las malas: los respaldos
 * viven en el MISMO disco que respaldan, y ese disco es de un giga. Un respaldo
 * completo pesa lo que pesen todos los adjuntos, y la regla de antes guardaba
 * catorce días de TODO —completos incluidos, y cada respaldo hecho a mano es
 * completo— más uno por mes. El disco se llenó, y con el disco lleno deja de
 * funcionar todo lo que escribe, empezando por el propio respaldo: como la poda
 * solo corría después de un respaldo bien hecho, el primero que no cupo fue
 * también el último que podó. Por eso aquí se mide antes de escribir, se poda
 * lo viejo aunque el nuevo no quepa, y hay UNA regla por encima de las demás:
 *
 *     El respaldo completo más reciente que esté bien no se borra nunca.
 *
 * Ni por política, ni por falta de espacio, ni para hacerle sitio a uno nuevo.
 * Si la única forma de hacer un respaldo fuera borrar ese, no se hace el
 * respaldo y se avisa. Es código que borra respaldos de producción sin que
 * nadie lo supervise: lo único que no puede hacer es dejar a la empresa sin red.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getDb, cerrarDb, auditar } from './db';
import { escribirZipAArchivo, leerZip, revisarZip, verificarZip } from './zip';
import { ValidacionError, SinEspacioError } from './errores';
import { hoy } from './fechas';
import { carpetaDatos, espacio, ocupacion, enMB, RESERVA_BYTES, PREFIJO_PROVISIONAL } from './disco';
import { LIMITE_BYTES as LIMITE_DE_UN_ADJUNTO } from './archivos';

/**
 * Cuánto se guarda. Se puede cambiar por variable de entorno, con el mismo
 * criterio que los topes del asistente (`CHAT_TOPE_*`): un valor que no se
 * entiende cae en la omisión. Aquí importa todavía más que allá, porque un
 * «conservar NaN respaldos» no conserva ninguno —toda comparación con `NaN` es
 * falsa— y eso, en el código que decide qué se borra, sería borrarlo todo.
 */
function enteroDeEntorno(crudo, omision) {
  const n = Number(crudo ?? omision);
  return Number.isInteger(n) && n >= 1 ? n : omision;
}

/**
 * Cuántos respaldos completos se conservan. `RESPALDOS_COMPLETOS`.
 *
 * Dos y no uno: si el más nuevo sale mal —o se hizo justo después del error que
 * se quiere deshacer—, el anterior sigue ahí. Y no más de dos porque cada uno
 * pesa lo que todos los adjuntos juntos, en un disco que también tiene que
 * guardar los adjuntos.
 *
 * Es el número que se QUIERE conservar, no una promesa: si el disco ya no da
 * para tanto, se conserva lo que quepa y la pantalla lo dice (ver `hacerSitio`).
 */
export const COMPLETOS_A_CONSERVAR = enteroDeEntorno(process.env.RESPALDOS_COMPLETOS, 2);

/**
 * Cuántos días se conservan los respaldos diarios de «solo la base».
 * `RESPALDOS_DIAS_BASE`.
 *
 * Un error de captura se descubre a los pocos días; catorce cubren dos cierres
 * de semana. Estos pesan menos de un mega cada uno: no son los que llenan el
 * disco, y por eso nunca se sacrifican para hacer sitio.
 */
export const DIAS_SOLO_BASE = enteroDeEntorno(process.env.RESPALDOS_DIAS_BASE, 14);

/** Meses de los que se guarda un respaldo de solo la base, ya raleados. */
export const MESES_MENSUALES = 12;
/** Cada cuánto uno de los automáticos se lleva también los PDF. */
export const DIAS_ENTRE_COMPLETOS = 7;

const DIA = 86400000;

const MOTIVOS = {
  automatico: 'Automático',
  manual: 'A mano',
  'antes-de-restaurar': 'Antes de restaurar',
};

function rutaBase() {
  return process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'ultra.db');
}

export function carpeta() {
  const dir = path.join(carpetaDatos(), 'respaldos');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function carpetaArchivos() {
  const dir = path.join(carpetaDatos(), 'archivos');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * El nombre lo arma la plataforma y solo se acepta si tiene esta forma exacta.
 * Un nombre que venga de fuera nunca se pega a una ruta sin pasar por aquí: es
 * la vía más corta para que alguien pida `../../algo` y se lleve lo que no es.
 */
const NOMBRE = /^respaldo-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})-(automatico|manual|antes-de-restaurar)-(completo|base)\.zip$/;

function exigirNombre(nombre) {
  const n = String(nombre || '');
  if (!NOMBRE.test(n)) throw new ValidacionError('Ese respaldo no existe.');
  return n;
}

function marca(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function conteos(db) {
  const uno = (sql) => {
    try {
      return db.prepare(sql).get().n;
    } catch {
      return 0;
    }
  };
  return {
    servicios: uno("SELECT COUNT(*) AS n FROM servicios WHERE estatus = 'ACTIVO'"),
    servicios_total: uno('SELECT COUNT(*) AS n FROM servicios'),
    guardias: uno("SELECT COALESCE(SUM(total_guardias), 0) AS n FROM servicios WHERE estatus = 'ACTIVO'"),
    aperturas: uno('SELECT COUNT(*) AS n FROM aperturas'),
    cancelaciones: uno('SELECT COUNT(*) AS n FROM cancelaciones'),
    facturas: uno('SELECT COUNT(*) AS n FROM facturas'),
    usuarios: uno('SELECT COUNT(*) AS n FROM usuarios'),
    bitacora: uno('SELECT COUNT(*) AS n FROM bitacora'),
  };
}

// ----------------------------------------------------------------- consultar

/**
 * Los respaldos que una revisión a fondo encontró dañados, para no volver a
 * contarlos como buenos (y los que pasaron, para no volver a leerlos enteros).
 *
 * La lista revisa cada archivo por encima —mira que termine como un ZIP—, que
 * es barato y caza lo que de verdad pasa: una escritura que se cortó. La
 * revisión a fondo lee el archivo completo y solo se hace cuando está por
 * borrarse un respaldo: ahí sí hay que estar seguro de que el que se queda
 * sirve. Lo que esa revisión averigua se recuerda aquí mientras viva el
 * proceso; la llave lleva tamaño y fecha para que un archivo reemplazado no
 * herede el veredicto del anterior.
 */
const A_FONDO = new Map();
const llaveDe = (r) => `${r.nombre}:${r.bytes}:${r.creado_en}`;

export function listar() {
  const dir = carpeta();
  return fs
    .readdirSync(dir)
    .map((nombre) => [nombre, NOMBRE.exec(nombre)])
    .filter(([, m]) => m)
    .map(([nombre, [, fecha, hh, mm, motivo, alcance]]) => {
      const ruta = path.join(dir, nombre);
      const st = fs.statSync(ruta);
      const r = {
        nombre,
        fecha,
        hora: `${hh}:${mm}`,
        motivo,
        motivoTexto: MOTIVOS[motivo] || motivo,
        completo: alcance === 'completo',
        alcanceTexto: alcance === 'completo' ? 'Base + facturas' : 'Solo la base',
        bytes: st.size,
        creado_en: st.mtime.toISOString(),
      };
      /**
       * ¿Sirve? Un respaldo sirve si es un ZIP entero y trae la base.
       *
       * Antes la lista se fiaba del nombre. Reproducido contra un disco lleno:
       * un respaldo que se queda sin sitio a media escritura dejaba un .zip
       * cortado con nombre de respaldo completo, y la plataforma lo trataba
       * como el más reciente. El aviso de «respaldo atrasado» se callaba porque
       * «había uno de hoy», y el botón de bajar el último completo entregaba un
       * archivo que ningún programa puede abrir.
       */
      const dentro = A_FONDO.get(llaveDe(r)) === false ? null : revisarZip(ruta);
      r.bien = !!dentro && dentro.includes('ultra.db');
      return r;
    })
    .sort((a, b) => (a.nombre < b.nombre ? 1 : -1));
}

/**
 * Ubica un respaldo para poder bajarlo, sin abrirlo.
 *
 * Devuelve la ruta y el tamaño, no el contenido, y esa distinción es el punto.
 * Antes esto hacía `readFileSync`: cargaba el .zip entero a memoria para
 * entregárselo al navegador. Un respaldo completo lleva la base más todos los
 * PDF de facturas y contratos, así que un clic en «Bajar» podía pedir cientos de
 * megabytes de golpe en una máquina de 512 MB —y el segundo clic, después de que
 * el proveedor levantara el servidor de nuevo, hacía exactamente lo mismo—.
 *
 * Quien lo llama lo va leyendo del disco por pedazos. La memoria deja de
 * depender de lo que pese el respaldo.
 */
export function leer(nombre) {
  const n = exigirNombre(nombre);
  const ruta = path.join(carpeta(), n);
  if (!fs.existsSync(ruta)) throw new ValidacionError('Ese respaldo ya no está en el servidor.');
  return { nombre: n, ruta, bytes: fs.statSync(ruta).size };
}

const edadEnDias = (r, ahora) => (ahora - new Date(r.creado_en).getTime()) / DIA;

/** El espacio libre de ahorita, o `null` si el disco no se deja medir. */
const libreAhora = () => espacio()?.libre ?? null;

/**
 * Cuánto hay que dejar libre después de un respaldo.
 *
 * Un completo respeta la reserva del disco, como una subida: pesa cientos de
 * megas y no puede comerse el sitio que la base necesita para seguir guardando.
 *
 * El de solo la base no. Pesa menos de un mega, y negárselo a un disco al que
 * le quedan cuarenta megas «porque la reserva son cincuenta» sería dejar a la
 * plataforma sin NINGÚN respaldo justo cuando el disco está apretado, que es
 * cuando más falta hace. A ese le basta con caber.
 */
const reservaPara = (completo) => (completo ? RESERVA_BYTES : 0);

/**
 * Qué tan protegida está la operación ahorita, y qué hay que hacer si no lo
 * está. Lo consumen el Tablero y la pantalla de Respaldos.
 *
 * Todo sale de mirar el disco en este momento —qué respaldos hay, cuáles
 * sirven, cuánto espacio queda— y nada de un registro de «el último intento
 * falló». Es a propósito: con el disco lleno no se puede escribir ni ese
 * registro —comprobado contra un disco lleno de verdad, donde hasta iniciar
 * sesión falla porque la base no puede guardar—. Lo que se deduce de lo que hay
 * no depende de que algo haya alcanzado a dejar constancia.
 *
 * Solo cuentan los respaldos que sirven: uno a medias no es «el último».
 */
export function estado({ medir = libreAhora } = {}) {
  const todos = listar();
  const buenos = todos.filter((r) => r.bien);
  const ultimo = buenos[0] || null;
  // El que conviene bajarse es el último completo: el que también trae los PDF.
  const ultimoCompleto = buenos.find((r) => r.completo) || null;
  const dias = (r) => (r ? Math.floor((Date.now() - new Date(r.creado_en).getTime()) / DIA) : null);
  const d = dias(ultimo);

  const libre = medir();
  const pronostico = (completo) => {
    if (libre === null) return null;
    const { zip, pico } = estimar(completo);
    const plan = planearSitio({ lista: todos, libre, necesidad: pico, reserva: reservaPara(completo) });
    return { pesa: zip, necesita: pico, cabe: plan.cabe, cede: plan.cede };
  };

  const e = {
    ultimo,
    ultimoCompleto,
    total: todos.length,
    danados: todos.length - buenos.length,
    bytes: todos.reduce((a, r) => a + r.bytes, 0),
    dias: d,
    diasCompleto: dias(ultimoCompleto),
    alDia: d !== null && d <= 2,
    disco: ocupacion(),
    // Si el siguiente respaldo cabe: el completo, y el de solo la base, que es
    // a lo que se baja el automático cuando el completo no cabe.
    proximo: { completo: pronostico(true), base: pronostico(false) },
  };
  return { ...e, avisos: avisosDe(e, libre) };
}

/**
 * Lo que hay que decirle al administrador, ya redactado.
 *
 * Como mucho dos: uno sobre los respaldos y uno sobre el disco. Y ninguno
 * cuando todo está bien. Es la mitad difícil de un aviso: la plataforma ya tuvo
 * 219 aperturas sin aplicar pintadas en ámbar durante meses, y lo único que
 * enseñaron fue a pasar por encima del ámbar. Un aviso que está siempre no
 * avisa de nada, así que cada uno de estos nombra una cosa que HOY ya no
 * funciona —o está a un paso— y desaparece en cuanto se arregla.
 *
 * `grave` es para lo que ya dejó de funcionar; lo demás es «todavía funciona,
 * pero hay que decidir algo».
 *
 * Todos se arreglan en la pantalla de Respaldos, que es a donde llevan.
 */
function avisosDe(e, libre) {
  const avisos = [];
  const { completo, base } = e.proximo;
  const lleno = base && !base.cabe;

  // --- El respaldo: ¿hay uno, es reciente, trae los PDF?
  if (!e.ultimo) {
    avisos.push({
      clave: 'sin-respaldo',
      grave: true,
      titulo: e.danados
        ? 'No hay ningún respaldo que sirva: los que hay están dañados'
        : 'Todavía no hay ningún respaldo de la plataforma',
      texto: lleno
        ? 'Y no se puede hacer uno porque el disco del servidor está lleno. Entra a Respaldos: ahí se ve qué lo ocupa y cómo hacer sitio. Hasta entonces no hay a dónde volver.'
        : 'Entra a Respaldos, haz el primero y guárdalo fuera del servidor. Hasta entonces no hay a dónde volver.',
    });
  } else if (!e.alDia) {
    avisos.push({
      clave: 'atrasado',
      grave: true,
      titulo: `El último respaldo es de hace ${e.dias} días`,
      texto: lleno
        ? 'El respaldo automático no se ha podido hacer porque el disco del servidor está lleno. Entra a Respaldos: ahí se ve qué lo ocupa y cómo hacer sitio.'
        : 'El respaldo automático se está atrasando. Entra a Respaldos, haz uno y bájatelo.',
    });
  } else if (!e.ultimoCompleto || e.diasCompleto > DIAS_ENTRE_COMPLETOS + 2) {
    // Hay respaldo de la base, pero el que trae los contratos y las facturas
    // no existe o se quedó viejo. Con solo la base se recupera la operación y
    // se pierden los papeles, así que no puede pasar por «todo bien».
    avisos.push({
      clave: 'completo-atrasado',
      grave: false,
      titulo: e.ultimoCompleto
        ? `El último respaldo con los PDF es de hace ${e.diasCompleto} días`
        : 'No hay ningún respaldo que traiga los PDF',
      texto:
        'La base sí se está respaldando a diario, pero el respaldo completo —el único que trae los contratos y las facturas— ' +
        (completo && !completo.cabe
          ? 'ya no cabe en el disco del servidor. Entra a Respaldos para ver qué lo ocupa.'
          : 'no se ha hecho. Entra a Respaldos, haz uno con el botón y bájatelo.'),
    });
  }

  // --- El disco: ¿cabe lo que la plataforma tiene que escribir?
  // «Lleno» es que ya no cabe con holgura un adjunto del tamaño máximo: a
  // partir de ahí subir un contrato empieza a contestar que no hay sitio.
  if (libre !== null && libre < RESERVA_BYTES + LIMITE_DE_UN_ADJUNTO) {
    avisos.push({
      clave: 'disco-lleno',
      grave: true,
      titulo: `El disco del servidor está lleno: quedan ${enMB(libre)}`,
      texto:
        'Ya no se pueden subir contratos ni facturas, o está a punto de pasar. Entra a Respaldos: ahí se ve qué ocupa el disco y cómo hacer sitio.',
    });
  } else if (completo && !completo.cabe) {
    avisos.push({
      clave: 'completo-no-cabe',
      grave: true,
      titulo: 'El siguiente respaldo completo ya no cabe en el disco',
      texto:
        `Pesaría unos ${enMB(completo.pesa)} y no hay forma de hacerle sitio sin borrar el único completo que queda, que no se borra nunca. ` +
        'Entra a Respaldos para ver qué ocupa el disco; lo más probable es que haya que agrandarlo.',
    });
  } else if (completo && completo.cede) {
    avisos.push({
      clave: 'disco-justo',
      grave: false,
      titulo: `El disco ya no da para conservar ${COMPLETOS_A_CONSERVAR} respaldos completos`,
      texto:
        'Para hacer cada respaldo completo nuevo hay que borrar antes uno de los anteriores. Sigue habiendo respaldo, ' +
        'pero el margen se acabó: entra a Respaldos para ver qué ocupa el disco y decidir si se agranda.',
    });
  }

  return avisos;
}

// ----------------------------------------------------------- qué se conserva

/**
 * Qué se queda y qué se va, respaldo por respaldo, y por qué.
 *
 * No borra nada: contesta. Recibe la lista del más nuevo al más viejo —como la
 * da `listar()`— y devuelve, para cada uno, si se conserva, si no, y la razón en
 * palabras, que es la que acaba en la bitácora cuando sí se borra.
 *
 * La política, de mayor a menor:
 *
 *   · El completo más reciente que esté bien: se queda SIEMPRE (`intocable`).
 *   · Completos: los `COMPLETOS_A_CONSERVAR` más recientes.
 *   · El que se hizo antes de restaurar: se queda `DIAS_SOLO_BASE` días aunque
 *     haya más completos de la cuenta. Es exactamente el que uno va a querer si
 *     la restauración fue el error, y eso se descubre en días, no en meses.
 *     Antes no se borraba nunca; pesa lo que un completo, así que «nunca» era
 *     otra forma de llenar el disco.
 *   · Solo la base: los de los últimos `DIAS_SOLO_BASE` días, y de ahí para
 *     atrás uno por mes durante un año. A esa distancia lo que se quiere
 *     recuperar es «cómo estaba la operación en marzo», no la versión de las
 *     tres de la tarde, y doce archivos de menos de un mega no llenan nada.
 *   · Los dañados: se van. No son respaldos, son megabytes con nombre de respaldo.
 *
 * `cedible` marca los que la política conserva pero el espacio puede obligar a
 * soltar: los completos que no son el intocable. Los de solo la base no ceden
 * nunca: soltarlos no hace sitio —pesan menos de un mega— y son los que más se
 * usan.
 */
export function politica(lista, { ahora = Date.now() } = {}) {
  const intocable = lista.find((r) => r.completo && r.bien)?.nombre;
  const meses = new Set();
  let completos = 0;

  return lista.map((r) => {
    const queda = (razon, cedible = false) => ({ r, conserva: true, razon, cedible });
    const seVa = (razon) => ({ r, conserva: false, razon, cedible: false });
    const edad = edadEnDias(r, ahora);

    if (!r.bien) return seVa('estaba dañado o a medias: no se podía abrir');

    if (r.completo) {
      if (r.nombre === intocable) {
        completos += 1;
        return { ...queda('es el respaldo completo más reciente que está bien'), intocable: true };
      }
      if (r.motivo === 'antes-de-restaurar' && edad < DIAS_SOLO_BASE) {
        return queda(`es la vuelta atrás de una restauración de hace menos de ${DIAS_SOLO_BASE} días`, true);
      }
      if (completos < COMPLETOS_A_CONSERVAR) {
        completos += 1;
        return queda(`es de los ${COMPLETOS_A_CONSERVAR} completos más recientes`, true);
      }
      return seVa(`se conservan los ${COMPLETOS_A_CONSERVAR} respaldos completos más recientes y este ya no era uno de ellos`);
    }

    if (edad < DIAS_SOLO_BASE) return queda(`es un diario de los últimos ${DIAS_SOLO_BASE} días`);
    // La lista viene del más nuevo al más viejo, así que el primero de cada mes
    // que se encuentra es el más reciente de ese mes: ese es el que se queda.
    const mes = r.fecha.slice(0, 7);
    if (!meses.has(mes) && edad <= MESES_MENSUALES * 30) {
      meses.add(mes);
      return queda('es el que se guarda de su mes');
    }
    return seVa(
      `los de solo la base se conservan ${DIAS_SOLO_BASE} días y después uno por mes durante ${MESES_MENSUALES} meses`
    );
  });
}

/**
 * ¿Cabe un respaldo que necesita `necesidad` bytes? Y si no cabe tal cual, ¿qué
 * habría que borrar antes para que quepa?
 *
 * Tampoco borra nada: es la cuenta, hecha aparte para poder hacerla también
 * desde la pantalla («el siguiente respaldo ya no cabe») sin tocar un archivo.
 *
 * Lo normal es que quepa y no haya que borrar nada: lo viejo se suelta DESPUÉS
 * de que lo nuevo exista y esté comprobado, nunca antes. Esto es la excepción,
 * para cuando no cabe. Entonces se hace sitio en este orden, de lo que menos
 * duele a lo que más, y dentro de cada grupo del más viejo al más nuevo:
 *
 *   1. Los dañados.
 *   2. Los que la política ya iba a borrar de todos modos.
 *   3. Los completos que la política conservaría, salvo el intocable. Aquí es
 *      donde la política CEDE ante el espacio: si dos completos ya no caben, se
 *      conserva uno. `cede` lo dice, para que la pantalla lo cuente.
 *
 * Se para en cuanto cabe: no se borra ni un respaldo más de los necesarios.
 *
 * Y si ni borrando todo lo borrable alcanza, `cabe` es falso y `victimas` va
 * vacía. Es deliberado: borrar respaldos para un respaldo que de todos modos no
 * se va a poder hacer sería quedarse sin lo viejo y sin lo nuevo.
 */
export function planearSitio({ lista, libre, necesidad, reserva = RESERVA_BYTES, ahora = Date.now() }) {
  let falta = necesidad + reserva - libre;
  if (falta <= 0) return { cabe: true, victimas: [], cede: false, liberable: 0 };

  const decisiones = politica(lista, { ahora });
  const delMasViejo = (a, b) => (a.r.nombre < b.r.nombre ? -1 : 1);
  const candidatos = [
    ...decisiones.filter((d) => !d.r.bien).sort(delMasViejo),
    ...decisiones.filter((d) => d.r.bien && !d.conserva).sort(delMasViejo),
    ...decisiones
      .filter((d) => d.cedible)
      .sort(delMasViejo)
      .map((d) => ({
        ...d,
        cede: true,
        razon: `no cabía el respaldo nuevo y hubo que hacerle sitio: el disco ya no da para conservar este además del más reciente`,
      })),
  ];

  const liberable = candidatos.reduce((a, d) => a + d.r.bytes, 0);
  if (liberable < falta) return { cabe: false, victimas: [], cede: false, liberable };

  const victimas = [];
  for (const d of candidatos) {
    if (falta <= 0) break;
    victimas.push({ ...d.r, razon: d.razon, cede: !!d.cede });
    falta -= d.r.bytes;
  }
  return { cabe: true, victimas, cede: victimas.some((v) => v.cede), liberable };
}

/**
 * Lee un respaldo entero para estar seguro de que sirve, y lo recuerda.
 * Devuelve si pasó.
 */
function comprobadoAFondo(r) {
  const llave = llaveDe(r);
  if (!A_FONDO.has(llave)) {
    try {
      verificarZip(path.join(carpeta(), r.nombre));
      A_FONDO.set(llave, true);
    } catch (err) {
      console.error(`[respaldos] ${r.nombre} no pasó la revisión a fondo: ${err.message}`);
      A_FONDO.set(llave, false);
    }
  }
  return A_FONDO.get(llave);
}

/**
 * Un plan de borrado en el que se puede confiar.
 *
 * `calcular` recibe la lista y devuelve las víctimas. Si entre ellas hay algún
 * completo sano, antes de dar el plan por bueno se lee ENTERO el completo que
 * se va a quedar como el más reciente. La revisión por encima de la lista
 * alcanza para pintar la pantalla; no alcanza para decidir que un respaldo
 * completo sobra. Si el que se iba a quedar resulta estar mal, deja de contar
 * como bueno y el plan se rehace: el intocable pasa a ser el siguiente.
 */
function planFirme(calcular) {
  // Cada vuelta descarta un completo que no pasó la revisión, así que hay como
  // mucho tantas vueltas como respaldos. El tope está para que un error aquí no
  // pueda dejar el servidor dando vueltas —esto corre de un tirón, sin soltar
  // el proceso—: si se agotan, no se borra nada.
  for (let vueltas = listar().length + 1; vueltas > 0; vueltas -= 1) {
    const lista = listar();
    const plan = calcular(lista);
    if (!plan.victimas.some((v) => v.completo && v.bien)) return plan;
    const seQueda = lista.find((r) => r.completo && r.bien);
    if (!seQueda || comprobadoAFondo(seQueda)) return plan;
  }
  throw new Error('No se pudo decidir con seguridad qué respaldos borrar, así que no se borró ninguno.');
}

/**
 * Borra los respaldos de un plan y deja constancia de cada uno.
 *
 * Cada respaldo que se borra solo queda en la bitácora con su nombre, lo que
 * pesaba y por qué se fue: un respaldo que desaparece sin rastro es peor que
 * uno que no se borra. Primero se borra y después se anota, y el orden no es
 * descuido: con el disco lleno la bitácora no se puede escribir —la base
 * tampoco tiene sitio—, así que anotar primero sería no poder hacer sitio
 * nunca. Si aun después de borrar no se pudiera anotar, queda en la bitácora
 * del servidor, que es el otro sitio donde se busca.
 *
 * Y la última defensa de la regla que no se negocia: aunque el plan lo pidiera
 * —no debería, y hay pruebas de que no lo pide—, aquí no se borra el completo
 * más reciente que esté bien. Es el único sitio del archivo donde se borra un
 * respaldo sin que una persona lo haya pedido, así que es donde la regla tiene
 * que cumplirse aunque todo lo de arriba se equivoque.
 */
function soltar(victimas) {
  const dir = carpeta();
  const hechos = [];
  for (const v of victimas) {
    const intocable = listar().find((r) => r.completo && r.bien)?.nombre;
    if (v.nombre === intocable) {
      console.error(`[respaldos] se pidió borrar ${v.nombre}, que es el completo más reciente que está bien. No se borra.`);
      continue;
    }
    fs.rmSync(path.join(dir, v.nombre), { force: true });
    const detalle = `${v.nombre} (${enMB(v.bytes)}) — ${v.razon}`;
    console.log(`[respaldos] se borró ${detalle}`);
    try {
      auditar(getDb(), { usuario: null, accion: 'respaldo_podado', entidad: 'sistema', entidad_id: null, detalle });
    } catch (err) {
      console.error(`[respaldos] no se pudo anotar en la bitácora que se borró ${v.nombre}: ${err.message}`);
    }
    hechos.push({ nombre: v.nombre, bytes: v.bytes, razon: v.razon });
  }
  return hechos;
}

/**
 * Quita lo que dejaron a medias los intentos que no terminaron.
 *
 * Un respaldo se escribe con nombre provisional y solo al final toma el suyo
 * (ver `crear`). Si el proceso muere a la mitad —el sistema lo mata por
 * memoria, se reinicia el servidor— el provisional se queda: puede pesar lo que
 * un respaldo completo y no aparece en ninguna lista. Lo mismo la copia
 * temporal de la base, y lo mismo un adjunto que se estaba subiendo.
 *
 * Se pueden borrar sin preguntar porque nada de esto corre a la vez que un
 * respaldo: un respaldo se hace de un tirón, sin soltar el proceso, y este
 * servidor es un solo proceso sobre un solo disco. Cualquier provisional que
 * esté aquí cuando empieza un respaldo es de alguien que ya no está.
 *
 * Lo que NO se toca: `.intento`, que es el freno de la agenda, y `.entrante-`,
 * que es la base que se está revisando para restaurar —y que sí está viva
 * mientras se hace el respaldo de antes de restaurar—.
 */
function barrerRestos() {
  const barrer = (dir, sobra) => {
    for (const nombre of fs.readdirSync(dir)) {
      if (!sobra(nombre)) continue;
      const ruta = path.join(dir, nombre);
      const bytes = fs.statSync(ruta).size;
      fs.rmSync(ruta, { force: true });
      console.log(`[respaldos] se quitó ${nombre} (${enMB(bytes)}): era el resto de una escritura que no terminó`);
    }
  };
  const provisional = (n) => n.startsWith(`.${PREFIJO_PROVISIONAL}`);
  barrer(carpeta(), (n) => provisional(n) || n.startsWith('.copia-'));
  barrer(carpetaArchivos(), provisional);
}

// ------------------------------------------------------------------- crear

/**
 * ¿Este respaldo se lleva también los PDF de las facturas?
 *
 * Los adjuntos son la parte pesada y la que nunca cambia: un PDF, una vez
 * subido, no se vuelve a tocar. Meterlos en la copia de todos los días sería
 * escribir los mismos cientos de megabytes catorce veces para guardar lo mismo,
 * y con eso se llena el disco del servidor en un año.
 *
 * Entonces: los diarios automáticos llevan solo la base, que es lo que cambia a
 * diario y pesa poco. Una vez por semana —y siempre que el respaldo lo pida una
 * persona, porque ese es el que se va a bajar— se hace uno completo.
 */
function decidirArchivos(motivo, forzar) {
  if (forzar !== undefined) return !!forzar;
  if (motivo !== 'automatico') return true; // manual y antes-de-restaurar: completos
  // Solo cuenta uno que sirva: un completo a medias no quita la necesidad de
  // hacer otro.
  const ultimoCompleto = listar().find((r) => r.completo && r.bien);
  if (!ultimoCompleto) return true;
  return Date.now() - new Date(ultimoCompleto.creado_en).getTime() >= DIAS_ENTRE_COMPLETOS * DIA;
}

/** Los adjuntos que se lleva un respaldo completo. Los ocultos no son de nadie. */
function adjuntosARespaldar() {
  const origen = carpetaArchivos();
  const salida = [];
  for (const f of fs.readdirSync(origen)) {
    if (f.startsWith('.')) continue;
    const ruta = path.join(origen, f);
    let st;
    try {
      st = fs.statSync(ruta);
    } catch {
      // Se borró entre listar la carpeta y mirarlo. Esta lista también la pide
      // el Tablero para decir si el siguiente respaldo cabe, y un adjunto que
      // alguien acaba de quitar no puede tumbar la pantalla de entrada.
      continue;
    }
    if (st.isFile()) salida.push({ nombre: `archivos/${f}`, ruta, bytes: st.size });
  }
  return salida;
}

/**
 * Cuánto va a pesar un respaldo, antes de hacerlo. Por arriba, a propósito.
 *
 *   - `zip`: lo que pesará el archivo. Se cuenta como si nada se comprimiera
 *     —los PDF ya vienen comprimidos y el ZIP los guarda tal cual—, más las
 *     cabeceras de cada entrada.
 *   - `pico`: lo que hace falta mientras se escribe, que es más: la copia
 *     consistente de la base se saca a un archivo aparte antes de meterla al
 *     ZIP, y durante ese rato existen las dos.
 *
 * Quedarse corto aquí es fallar a media escritura, que es justo lo que se
 * quiere evitar; pasarse es, como mucho, podar un respaldo viejo un poco antes.
 */
function estimar(completo) {
  const pesa = (ruta) => {
    try {
      return fs.statSync(ruta).size;
    } catch {
      return 0;
    }
  };
  // Lo que no se ha consolidado todavía vive en el diario (`-wal`) y también
  // entra en la copia.
  const base = pesa(rutaBase()) + pesa(`${rutaBase()}-wal`);
  const adjuntos = completo ? adjuntosARespaldar() : [];
  const cabeceras = adjuntos.reduce((a, f) => a + 76 + 2 * Buffer.byteLength(f.nombre), 0) + 4096;
  const zip = base + adjuntos.reduce((a, f) => a + f.bytes, 0) + cabeceras;
  return { zip, pico: zip + base };
}

/**
 * Se asegura de que el respaldo que viene quepa, podando antes si hace falta, y
 * se niega con un mensaje claro si no hay forma.
 *
 * Es el paso que faltaba. Antes un respaldo se intentaba siempre: con el disco
 * casi lleno empezaba a escribir, se quedaba sin sitio a la mitad y dejaba el
 * pedazo ocupando lo poco que quedaba. Intentarlo sabiendo que no cabe es
 * fallar a la mitad a propósito.
 *
 * Va aparte de `crear()` porque la agenda lo necesita ANTES de poner su marca
 * de intento: con el disco lleno ni esa marca se puede escribir, y hacer sitio
 * solo borra —no puede matar al proceso, que es de lo que la marca protege—.
 *
 * `medir` devuelve el espacio libre en bytes. Se puede pasar otro para las
 * pruebas, que así pueden ensayar un disco lleno sin llenar uno de verdad; el
 * resto del camino —los archivos, la bitácora, lo que se borra— es el real.
 */
export function hacerSitio({ motivo = 'manual', conArchivos, medir = libreAhora } = {}) {
  barrerRestos();
  const completo = decidirArchivos(motivo, conArchivos);
  const libre = medir();
  // Sin medida no se decide nada: si de verdad no hay sitio, la escritura
  // fallará y se limpiará sola, pero no se borra un respaldo por una suposición.
  if (libre === null) return { completo, podados: [] };

  const { zip, pico } = estimar(completo);
  const reserva = reservaPara(completo);
  const plan = planFirme((lista) => planearSitio({ lista, libre, necesidad: pico, reserva }));
  if (!plan.cabe) {
    const err = new SinEspacioError(
      `No se hizo el respaldo porque no cabe en el disco del servidor: pesaría unos ${enMB(zip)} y quedan ${enMB(libre)} libres` +
        (reserva ? ` (de los que ${enMB(reserva)} se reservan para que la base pueda seguir guardando)` : '') +
        '. ' +
        (plan.liberable
          ? `Borrando todos los respaldos que se pueden borrar se liberarían ${enMB(plan.liberable)}, y no alcanza. `
          : 'No queda ningún respaldo viejo que se pueda borrar para hacerle sitio. ') +
        'El respaldo completo más reciente no se borra nunca, así que no se borró nada: los respaldos que había siguen ahí. ' +
        'Qué hacer: abajo se ve qué ocupa el disco. Si son respaldos que ya tienes bajados, bórralos; si son los adjuntos, ' +
        'hay que agrandar el disco del servidor.'
    );
    // Para que la agenda sepa que lo que no cupo fue el completo y pueda, al
    // menos, respaldar la base.
    err.completo = completo;
    throw err;
  }
  return { completo, podados: soltar(plan.victimas) };
}

/**
 * Arma un respaldo y lo deja en el disco. Devuelve con qué quedó.
 *
 * La copia de la base se hace con VACUUM INTO sobre un archivo temporal: SQLite
 * la escribe consistente aunque haya escrituras en curso, y de paso sale
 * compactada. Copiar `ultra.db` a mano mientras el WAL tiene cambios sin
 * consolidar daría un archivo a medias, que es la peor clase de respaldo: uno
 * que parece existir.
 *
 * El orden es el contrato, y no se puede acortar:
 *
 *   1. Se comprueba que quepa (`hacerSitio`). Si no cabe ni podando, no se
 *      empieza.
 *   2. Se escribe con un nombre PROVISIONAL. Mientras se escribe no es un
 *      respaldo: no sale en la lista ni se puede bajar.
 *   3. Se comprueba entero: que la copia de la base esté sana y que cada
 *      archivo del ZIP se pueda sacar y coincida con lo que se metió.
 *   4. Solo entonces toma su nombre de respaldo. Renombrar es atómico: o está
 *      el respaldo completo y probado, o no hay nada.
 *   5. Y hasta entonces se poda lo viejo (`depurar`). Lo viejo se suelta
 *      después de que lo nuevo existe y está comprobado, no antes.
 *
 * Si algo falla en 2 o 3, el provisional se borra y los respaldos que había
 * quedan exactamente como estaban.
 */
export function crear({ motivo = 'manual', usuario = null, conArchivos, medir } = {}) {
  // `Object.hasOwn` y no `!MOTIVOS[motivo]`: con la segunda forma, un motivo
  // llamado `__proto__` o `toString` pasaba el guardia —son propiedades
  // heredadas de `Object.prototype`— y el respaldo se nombraba con él.
  if (!Object.hasOwn(MOTIVOS, motivo)) throw new ValidacionError('Motivo de respaldo desconocido.');
  const db = getDb();
  const dir = carpeta();
  const { completo, podados: antes } = hacerSitio({ motivo, conArchivos, medir });
  const nombre = `respaldo-${marca()}-${motivo}-${completo ? 'completo' : 'base'}.zip`;
  const destino = path.join(dir, nombre);
  const temporal = path.join(dir, `.copia-${process.pid}-${Date.now()}.db`);
  const provisional = path.join(dir, `.${PREFIJO_PROVISIONAL}${process.pid}-${Date.now()}-${nombre}`);

  try {
    db.prepare('VACUUM INTO ?').run(temporal);
    const baseBytes = fs.statSync(temporal).size;

    // La copia se revisa antes de guardarla. Un respaldo cuya base no abre no
    // es un respaldo, y es mejor saberlo hoy que el día que haga falta.
    const copia = new Database(temporal, { readonly: true });
    try {
      const integridad = copia.pragma('integrity_check', { simple: true });
      if (integridad !== 'ok') throw new Error(`La copia de la base no pasó la revisión de integridad: ${integridad}`);
    } finally {
      copia.close();
    }

    /**
     * Las entradas se apuntan por ruta, no por contenido.
     *
     * Antes se leía la base y CADA PDF a memoria antes de empezar a comprimir,
     * y el ZIP se armaba entero en memoria antes de tocar el disco: el pico era
     * como tres veces todo lo que hubiera guardado. Este respaldo lo dispara
     * sola la plataforma cada día, sin que nadie mire, y en un servidor de 512
     * MB terminaba de una sola manera —el sistema mata el proceso—. No es una
     * excepción que se pueda atrapar: el servidor desaparece y quien estuviera
     * navegando recibe un 502, sin nada en la bitácora que lo explique.
     *
     * Ahora las lee de una en una y las va soltando al disco.
     */
    const entradas = [{ nombre: 'ultra.db', ruta: temporal }];
    if (completo) entradas.push(...adjuntosARespaldar().map(({ nombre: n, ruta }) => ({ nombre: n, ruta })));

    const manifiesto = {
      plataforma: 'Ultra Seguridad Privada — Plataforma de Guardias',
      creado_en: new Date().toISOString(),
      fecha: hoy(),
      motivo,
      completo,
      creado_por: usuario?.nombre || usuario?.email || 'la plataforma',
      base_bytes: baseBytes,
      archivos: entradas.length - 1,
      conteos: conteos(db),
    };
    entradas.push({ nombre: 'respaldo.json', datos: Buffer.from(JSON.stringify(manifiesto, null, 2), 'utf8') });

    escribirZipAArchivo(provisional, entradas);

    const dentro = verificarZip(provisional);
    if (dentro.length !== entradas.length || !dentro.includes('ultra.db') || !dentro.includes('respaldo.json')) {
      throw new Error('El respaldo recién escrito no trae todo lo que se le metió.');
    }

    fs.renameSync(provisional, destino);
  } finally {
    // Aquí se limpia lo que haya quedado a medias, falle lo que falle: la copia
    // temporal de la base siempre, y el provisional si no llegó a renombrarse.
    // Es lo que impide que un respaldo fallido deje su pedazo ocupando sitio.
    fs.rmSync(temporal, { force: true });
    fs.rmSync(provisional, { force: true });
  }

  const hecho = listar().find((r) => r.nombre === nombre);
  // Se acaba de leer entero: no hace falta volver a hacerlo para confiar en él.
  A_FONDO.set(llaveDe(hecho), true);
  const bytes = hecho.bytes;
  if (usuario) {
    auditar(db, {
      usuario,
      accion: 'respaldo',
      entidad: 'sistema',
      entidad_id: null,
      detalle: `${nombre} (${(bytes / 1024 / 1024).toFixed(1)} MB)`,
    });
  }

  const podados = [...antes, ...depurar()];
  return { nombre, bytes, completo, borrados: podados.map((p) => p.nombre), podados };
}

// ---------------------------------------------------------------- depurar

/**
 * Poda lo que la política ya no conserva, para que el disco no se llene solo.
 *
 * Qué se queda y qué se va lo decide `politica()`, y ahí está explicado. Aquí
 * solo se ejecuta, y se ejecuta DESPUÉS de que el respaldo nuevo existe y está
 * comprobado: nunca hay un momento en que lo viejo ya no esté y lo nuevo
 * todavía no.
 *
 * Devuelve lo que borró, con su peso y su razón. Cada uno queda en la bitácora.
 */
export function depurar() {
  const plan = planFirme((lista) => ({
    victimas: politica(lista)
      .filter((d) => !d.conserva)
      .map((d) => ({ ...d.r, razon: d.razon })),
  }));
  return soltar(plan.victimas);
}

export function borrar(nombre, usuario) {
  const n = exigirNombre(nombre);
  const ruta = path.join(carpeta(), n);
  if (!fs.existsSync(ruta)) throw new ValidacionError('Ese respaldo ya no está en el servidor.');
  fs.rmSync(ruta, { force: true });
  auditar(getDb(), { usuario, accion: 'respaldo_borrado', entidad: 'sistema', entidad_id: null, detalle: n });
  return { nombre: n };
}

// --------------------------------------------------------------- restaurar

/**
 * Deja la plataforma como estaba el día de ese respaldo.
 *
 * Esta es la operación más destructiva que existe aquí: reemplaza la base
 * completa. Por eso el orden importa y no se puede acortar:
 *
 *   1. Se abre y se verifica el zip ANTES de tocar nada. Si viene dañado, o si
 *      la base que trae no pasa la revisión de integridad de SQLite, se rechaza
 *      y la operación sigue como estaba.
 *   2. Se hace un respaldo de lo que hay ahora mismo. Si restaurar fue un
 *      error, ese archivo es la vuelta atrás.
 *   3. Hasta entonces se cierra la base y se reemplazan los archivos.
 */
export function restaurar(buffer, usuario, { confirmacion } = {}) {
  if (String(confirmacion || '').trim().toUpperCase() !== 'RESTAURAR') {
    throw new ValidacionError('Para restaurar hay que escribir la palabra RESTAURAR. Es a propósito.');
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ValidacionError('No llegó ningún archivo.');

  let entradas;
  try {
    entradas = leerZip(buffer);
  } catch (e) {
    throw new ValidacionError(`Ese archivo no se puede leer como respaldo: ${e.message}`);
  }

  const base = entradas.find((e) => e.nombre === 'ultra.db');
  if (!base) throw new ValidacionError('El archivo no trae la base de datos: no es un respaldo de esta plataforma.');
  const manifiesto = entradas.find((e) => e.nombre === 'respaldo.json');
  let info = null;
  try {
    info = manifiesto ? JSON.parse(manifiesto.datos.toString('utf8')) : null;
  } catch {
    info = null;
  }

  // Se revisa la base traída, en un archivo aparte, antes de darle su lugar.
  const dir = carpeta();
  const candidata = path.join(dir, `.entrante-${process.pid}-${Date.now()}.db`);
  try {
    // Dentro del `try`, no antes: si el disco está lleno esta escritura se
    // corta, y lo que alcanzó a escribir tiene que borrarse en el `finally`
    // como todo lo demás. Estando fuera, cada intento de restaurar contra un
    // disco lleno dejaba otro pedazo de base ocupando sitio.
    fs.writeFileSync(candidata, base.datos);
    const prueba = new Database(candidata, { readonly: true });
    try {
      const integridad = prueba.pragma('integrity_check', { simple: true });
      if (integridad !== 'ok') throw new ValidacionError(`La base del respaldo está dañada: ${integridad}`);
      const tablas = prueba
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name);
      for (const t of ['servicios', 'aperturas', 'usuarios']) {
        if (!tablas.includes(t)) {
          throw new ValidacionError(`El respaldo no trae la tabla «${t}»: no es de esta plataforma.`);
        }
      }
      if (prueba.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n === 0) {
        throw new ValidacionError('El respaldo no trae ningún usuario: nadie podría entrar después de restaurarlo.');
      }
    } finally {
      prueba.close();
    }

    // Red de seguridad: lo que hay ahora, completo —con los PDF— porque es la
    // última oportunidad de conservarlo antes de reemplazar la base.
    let previo;
    try {
      previo = crear({ motivo: 'antes-de-restaurar', usuario: null, conArchivos: true });
    } catch (err) {
      if (!(err instanceof SinEspacioError)) throw err;
      // Sin red no se salta. El mensaje del respaldo que no cupo se conserva
      // —dice cuánto falta y qué hacer—, pero lo primero que hay que decir aquí
      // es que la restauración no llegó a empezar.
      throw new SinEspacioError(
        'No se restauró nada: la plataforma sigue exactamente como estaba. Antes de restaurar se guarda un respaldo de ' +
          `cómo está todo ahorita, por si la restauración fuera el error, y ese respaldo no se pudo hacer. ${err.message}`
      );
    }

    const destino = rutaBase();
    const aArchivos = carpetaArchivos();
    const adjuntosDelRespaldo = entradas
      .filter((e) => e.nombre.startsWith('archivos/'))
      .map((e) => ({ solo: path.basename(e.nombre), datos: e.datos }))
      .filter((e) => e.solo && !e.solo.startsWith('.'));

    /**
     * Última parada antes de tocar nada: ¿cabe lo que se va a escribir?
     *
     * De aquí para abajo se reemplaza la base y se reponen los adjuntos, y
     * ninguna de las dos cosas se puede dejar a medias: una base cortada es la
     * plataforma sin base. Se cuenta lo que de verdad hace falta —lo que cada
     * archivo crece respecto del que ya está en el disco, no su tamaño entero—
     * porque restaurar un respaldo sobre los mismos adjuntos no ocupa casi nada
     * y negarlo por una cuenta holgada sería quitarle a alguien la vuelta atrás
     * justo cuando la necesita.
     */
    const pesaHoy = (ruta) => (fs.existsSync(ruta) ? fs.statSync(ruta).size : 0);
    const crece = (ruta, nuevo) => Math.max(0, nuevo - pesaHoy(ruta));
    const hacenFalta =
      crece(destino, base.datos.length) +
      adjuntosDelRespaldo.reduce((a, e) => a + crece(path.join(aArchivos, e.solo), e.datos.length), 0);
    const libre = libreAhora();
    if (libre !== null && libre - hacenFalta < RESERVA_BYTES) {
      throw new SinEspacioError(
        `No se restauró nada: la plataforma sigue exactamente como estaba. Lo que trae ese respaldo necesita ${enMB(hacenFalta)} ` +
          `más de disco y quedan ${enMB(libre)} libres. Lo que había quedó guardado en ${previo.nombre}. ` +
          'Qué hacer: abajo se ve qué ocupa el disco; hay que hacer sitio o agrandar el disco del servidor antes de volver a intentarlo.'
      );
    }

    cerrarDb();
    fs.rmSync(`${destino}-wal`, { force: true });
    fs.rmSync(`${destino}-shm`, { force: true });
    fs.copyFileSync(candidata, destino);

    // Los adjuntos se reponen sin borrar los que ya estaban: si el respaldo es
    // viejo, las facturas subidas después siguen ahí y sus PDF no se pierden.
    let repuestos = 0;
    for (const e of adjuntosDelRespaldo) {
      fs.writeFileSync(path.join(aArchivos, e.solo), e.datos);
      repuestos++;
    }

    const db = getDb();
    auditar(db, {
      usuario,
      accion: 'restauracion',
      entidad: 'sistema',
      entidad_id: null,
      detalle: `Restaurado el respaldo del ${info?.fecha || 'origen desconocido'} · ${repuestos} archivos · respaldo previo ${previo.nombre}`,
    });

    return {
      restaurado: info,
      repuestos,
      // Un respaldo de solo base no trae los PDF, y eso hay que decirlo: los que
      // estén en el disco siguen ahí, pero los de un servidor perdido no vuelven.
      traiaArchivos: entradas.some((e) => e.nombre.startsWith('archivos/')),
      respaldoPrevio: previo.nombre,
      conteos: conteos(db),
    };
  } finally {
    fs.rmSync(candidata, { force: true });
  }
}
