import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
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
 */
export const PATCH = conPermiso('apertura', async (request, { params, usuario }) => {
  const body = await leerJson(request);
  return NextResponse.json(completarAlta(Number(params.id), body, usuario));
});
