/**
 * El reloj de la plataforma: lo que pasa sin que nadie lo pida.
 *
 * Hoy solo hay una tarea, el respaldo diario, y corre dentro del mismo proceso
 * del servidor. No hace falta un cron del sistema ni un servicio aparte, y eso
 * es deliberado: una pieza más que instalar es una pieza más que se puede
 * olvidar al cambiar de proveedor, y entonces los respaldos dejan de correr sin
 * que nadie se entere.
 *
 * Se enciende desde `getDb()`, o sea la primera vez que alguien toca la base
 * después de que el servidor arrancó. Suena flojo y no lo es: si nadie abrió la
 * plataforma, tampoco cambió nada que respaldar. Y de ahí en adelante el
 * temporizador sigue solo, aunque nadie vuelva a entrar en todo el día.
 *
 * Dos detalles que hacen que funcione de verdad:
 *
 *   - Al arrancar revisa si el último respaldo ya tiene más de un día y, si es
 *     así, hace uno enseguida. Un servidor que se reinicia —o que se durmió y
 *     despertó— no pierde el respaldo del día.
 *   - El temporizador va con `unref()`, para que nunca sea el motivo por el que
 *     el proceso no se deja cerrar.
 *
 * Si algo de esto dejara de correr, no pasa en silencio: el tablero avisa en
 * cuanto el último respaldo se pasa de dos días.
 */

import fs from 'node:fs';
import path from 'node:path';

const CADA = 6 * 60 * 60 * 1000; // se revisa cuatro veces al día
const VENCE = 20 * 60 * 60 * 1000; // y se respalda si el último ya tiene ~un día
const AL_ARRANCAR = 30 * 1000; // sin estorbar el arranque
/** Cuánto se espera antes de reintentar un respaldo que no llegó a terminar. */
const TRAS_FALLAR = 6 * 60 * 60 * 1000;

let andando = false;

/**
 * El freno contra el bucle de caídas.
 *
 * `revisar` está envuelto en un `try`, pero hay una falla que ningún `try`
 * atrapa: quedarse sin memoria. Ahí el sistema mata el proceso y no se ejecuta
 * nada más. El proveedor levanta otro, alguien entra, treinta segundos después
 * la agenda vuelve a mirar, ve que sigue sin haber respaldo de hoy, lo intenta
 * otra vez —y vuelve a morir—. Eso ya no es un respaldo que falla: es la
 * plataforma inservible, cayéndose cada pocos minutos.
 *
 * La marca se escribe en el disco ANTES de intentarlo, justamente porque tiene
 * que sobrevivir a la muerte del proceso: es la única manera de que el que
 * arranca después sepa que el anterior se quedó a medias. Se borra al terminar
 * bien. Mientras esté puesta y sea reciente, no se reintenta.
 *
 * Así, lo peor que puede pasar es una caída cada seis horas en vez de uno cada
 * pocos minutos, y el tablero avisa solo en cuanto el último respaldo se pasa
 * de dos días.
 */
export function rutaMarca() {
  const base = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'ultra.db');
  return path.join(path.dirname(base), 'respaldos', '.intento');
}

/** Devuelve cuándo se quedó a medias el intento anterior, o null si no hay. */
export function intentoReciente() {
  try {
    const st = fs.statSync(rutaMarca());
    return Date.now() - st.mtimeMs < TRAS_FALLAR ? st.mtimeMs : null;
  } catch {
    return null; // no hay marca: el anterior terminó bien
  }
}

async function revisar() {
  try {
    const { estado, crear } = await import('./respaldos');
    const e = estado();
    const ultimo = e.ultimo ? new Date(e.ultimo.creado_en).getTime() : 0;
    if (Date.now() - ultimo < VENCE) return;

    const cuando = intentoReciente();
    if (cuando !== null) {
      console.error(
        '[respaldos] el intento anterior no llegó a terminar ' +
          `(${new Date(cuando).toISOString()}). No se reintenta hasta dentro de unas horas, ` +
          'para no dejar el servidor cayéndose en bucle. Conviene revisar la bitácora.'
      );
      return;
    }

    const marca = rutaMarca();
    fs.mkdirSync(path.dirname(marca), { recursive: true });
    fs.writeFileSync(marca, new Date().toISOString());

    const { memoria } = await import('./vigilante');
    const r = crear({ motivo: 'automatico' });
    fs.rmSync(marca, { force: true }); // salió bien: se levanta el freno

    // La memoria va en la línea a propósito. Este respaldo es lo único pesado
    // que la plataforma hace sola, sin que nadie mire, y fue el sospechoso
    // cuando el servidor se murió sin dejar explicación. Con esto, la próxima
    // vez la bitácora dice si iba apretado o no.
    console.log(`[respaldos] ${r.nombre} · ${(r.bytes / 1024 / 1024).toFixed(1)} MB` +
      (r.borrados.length ? ` · se ralearon ${r.borrados.length} viejos` : '') +
      ` · ${memoria()}`);
  } catch (err) {
    // Que falle un respaldo no puede tumbar el servidor: la operación sigue y
    // la pantalla de Respaldos va a mostrar que el último se está atrasando. La
    // marca se queda puesta a propósito: si falló una vez, que espere.
    console.error('[respaldos] no se pudo hacer el respaldo automático:', err.message);
  }
}

export function arrancarAgenda() {
  if (andando) return;
  andando = true;
  setTimeout(revisar, AL_ARRANCAR).unref?.();
  setInterval(revisar, CADA).unref?.();
  console.log('[respaldos] respaldo automático activo (revisión cada 6 h)');
}
