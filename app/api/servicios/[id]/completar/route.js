import { NextResponse } from 'next/server';
import { conPermiso, leerObjeto } from '@/lib/api';
import { completarAlta } from '@/lib/servicios';

export const dynamic = 'force-dynamic';

/**
 * Terminar de capturar un alta que se abrió con lo mínimo.
 *
 * Es una ruta aparte y no un `PATCH /api/servicios/[id]` con otros campos, y la
 * diferencia no es de forma. La edición de la ficha respeta los grupos del
 * RBAC: los datos operativos son de administrador, los de cobranza de finanzas.
 * Completar un hueco lo puede hacer quien registró la apertura —ventas u
 * operaciones— porque es terminar su propia captura, no editar la de otro.
 * Mezclar las dos cosas en la misma ruta habría obligado a decidir por el valor
 * del campo qué permiso aplicar, y ese es el tipo de regla que se cuela por
 * donde nadie la mira.
 *
 * El permiso de entrada es `apertura`, el mismo que abre el servicio. `conPermiso`
 * se queda con el 401 y el 403 de rol; el alcance campo por campo —lista cerrada
 * y solo de vacío a valor— lo impone `completarAlta()`, que es quien escribe.
 *
 * Por aquí entra también la corrección del dato propio del mismo día, en
 * `correcciones`, y no por una ruta nueva al lado: tiene que heredar estas
 * mismas defensas —sesión, rol, `ACTIVO`, lista cerrada de campos, catálogos y
 * topes—, y una puerta aparte es una puerta más que mantener en pie. Lo que la
 * contiene no es la ruta sino `completarAlta()`: el dato tiene que ser suyo, del
 * mismo día, y pedido por su nombre.
 */
export const PATCH = conPermiso('apertura', async (request, { params, usuario }) => {
  // `leerObjeto` y no `leerJson`: con el cuerpo `"texto"` se recorrían los
  // índices de la cadena y la respuesta contestaba 200 diciendo que había
  // rechazado cinco campos llamados «0», «1», «2»…
  const body = await leerObjeto(request);
  return NextResponse.json(completarAlta(Number(params.id), body, usuario));
});
