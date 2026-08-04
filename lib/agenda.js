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

const CADA = 6 * 60 * 60 * 1000; // se revisa cuatro veces al día
const VENCE = 20 * 60 * 60 * 1000; // y se respalda si el último ya tiene ~un día
const AL_ARRANCAR = 30 * 1000; // sin estorbar el arranque

let andando = false;

async function revisar() {
  try {
    const { estado, crear } = await import('./respaldos');
    const e = estado();
    const ultimo = e.ultimo ? new Date(e.ultimo.creado_en).getTime() : 0;
    if (Date.now() - ultimo < VENCE) return;

    const r = crear({ motivo: 'automatico' });
    console.log(`[respaldos] ${r.nombre} · ${(r.bytes / 1024 / 1024).toFixed(1)} MB` +
      (r.borrados.length ? ` · se ralearon ${r.borrados.length} viejos` : ''));
  } catch (err) {
    // Que falle un respaldo no puede tumbar el servidor: la operación sigue y
    // la pantalla de Respaldos va a mostrar que el último se está atrasando.
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
