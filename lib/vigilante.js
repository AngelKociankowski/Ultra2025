/**
 * Que una caída deje rastro.
 *
 * Se reportó la plataforma con un 502 —«Bad Gateway»— al entrar a una pantalla.
 * Un 502 no lo produce la aplicación: lo produce el portero de Render cuando
 * detrás no hay nadie que conteste, o sea cuando el proceso de Node se murió. Y
 * las tres razones por las que se muere se ven idénticas desde fuera —la página
 * deja de responder un rato y vuelve—, así que sin registro no hay manera de
 * saber cuál fue:
 *
 *   · Quedarse sin memoria. Contra eso no hay `catch` que valga: el sistema
 *     operativo mata el proceso y no se escribe nada.
 *   · Una excepción o una promesa rechazada fuera del ciclo de una petición.
 *   · Un cierre pedido —un despliegue, un reinicio del proveedor—, que no es una
 *     caída aunque se sienta igual.
 *
 * Lo que esto hace es dejar constancia de las tres, con cuánta memoria había en
 * ese momento, que es justo el dato que distingue la primera de las otras dos.
 *
 * Lo que NO hace, a propósito:
 *
 *   · No mata el proceso. Next ya registra sus propios manejadores de
 *     `uncaughtException` y `unhandledRejection` que solo anotan el error y
 *     mantienen el servidor en pie. Agregar aquí un `process.exit` convertiría
 *     un error que la plataforma hoy sobrevive en una caída de verdad: sería
 *     empeorar exactamente lo que se vino a arreglar.
 *   · No se traga nada. Los manejadores de Next siguen corriendo después de
 *     estos y el error sigue apareciendo completo en la bitácora.
 *
 * Por eso se registran con `prependListener` y no con `on`: los de Next se
 * instalan al arrancar el servidor, antes que este archivo, y el de cierre
 * termina el proceso. Si estos fueran detrás, nunca alcanzarían a escribir.
 */

let puesto = false;

/** El estado de la memoria en una línea, que es lo que hay que leer después. */
export function memoria() {
  const m = process.memoryUsage();
  const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;
  return `rss ${mb(m.rss)} · heap ${mb(m.heapUsed)}/${mb(m.heapTotal)} · externo ${mb(m.external)}`;
}

export function vigilar() {
  if (puesto) return;
  puesto = true;

  process.prependListener('unhandledRejection', (razon) => {
    console.error(
      `[ultra] promesa rechazada sin capturar · ${memoria()}\n`,
      razon instanceof Error ? razon.stack : razon
    );
  });

  process.prependListener('uncaughtException', (err) => {
    console.error(`[ultra] excepción sin capturar · ${memoria()}\n`, err?.stack || err);
  });

  // Esto no es un error, y por eso va aparte: es el aviso de que alguien pidió
  // el cierre. Sirve para distinguir «lo reiniciaron» de «se cayó» al leer la
  // bitácora, que suele ser la primera pregunta.
  for (const senal of ['SIGTERM', 'SIGINT']) {
    process.prependListener(senal, () => {
      console.log(`[ultra] ${senal}: cierre pedido desde fuera, no es una caída · ${memoria()}`);
    });
  }

  console.log(`[ultra] en pie · node ${process.version} · ${memoria()}`);
}
