/**
 * Resuelve los `import './algo'` sin extensión de `lib/`, que en la aplicación
 * los resuelve Next.
 *
 * Existe solo para las pruebas: casi todo este directorio prueba contra el
 * servidor de verdad, pero cuando lo que se ataca es la FUENTE de una regla
 * derivada —el tipo con que `lib/campos.js` dice que se pinta un control— hay
 * que poder cargar `lib/captura.js` directamente y mover esa fuente en memoria.
 * Sin esto, `import './campos'` desde `lib/captura.js` no se resuelve fuera de
 * Next y no hay forma de hacerle esa pregunta al módulo.
 */

import fs from 'node:fs';

export async function resolve(especificador, contexto, siguiente) {
  try {
    return await siguiente(especificador, contexto);
  } catch (error) {
    if (especificador.startsWith('.') && contexto.parentURL) {
      const base = new URL(especificador, contexto.parentURL);
      for (const extension of ['.js', '.mjs']) {
        if (fs.existsSync(new URL(base.href + extension))) {
          return siguiente(especificador + extension, contexto);
        }
      }
    }
    throw error;
  }
}
