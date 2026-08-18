import { NextResponse } from 'next/server';
import { requerirUsuario, NoAutenticado } from '@/lib/auth';
import { serviciosDeCorte } from '@/lib/queries';
import { listarServicios } from '@/lib/servicios';
import { estadoAlDia, comoDia } from '@/lib/dias';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Descarga de un corte en CSV, para conciliar facturación fuera de la
 * plataforma. Es solo lectura y para cualquier rol autenticado: es la misma
 * información que ya ve en pantalla, en un archivo que se abre en Excel.
 *
 * `periodo` puede ser un corte cerrado (2026-01) o `actual`, que exporta la
 * plantilla viva. Con `?dia=AAAA-MM-DD` sale la reconstrucción de esa fecha,
 * que es la misma que se ve en pantalla: quien la baja para llevarla a una
 * junta se lleva lo que vio, no otra cosa parecida.
 */

const COLUMNAS = [
  ['servicio', 'Servicio'],
  ['razon_social', 'Razón social'],
  ['zona', 'Zona'],
  ['tipo', 'Tipo'],
  ['supervisor', 'Supervisor'],
  ['asesor', 'Asesor'],
  ['total_guardias', 'Guardias'],
  ['guardias_en_factura', 'Guardias en factura'],
  ['importe_factura', 'Importe de factura'],
  ['importe_sin_iva', 'Importe sin IVA'],
  ['factura_mensual', 'Factura mensual'],
  ['nomina_total', 'Nómina total'],
  ['resultado_servicio', 'Resultado del servicio'],
  ['pct_utilidad', '% utilidad'],
  ['status_cobranza', 'Status de cobranza'],
  ['fecha_pago', 'Fecha de pago'],
  ['dias_credito', 'Días de crédito'],
  ['importe_pendiente', 'Importe pendiente'],
  ['saldo_vencido', 'Saldo vencido'],
  ['tiene_contrato', '¿Cuenta con contrato?'],
  ['fecha_contrato', 'Firma de contrato'],
  ['fecha_vencimiento_contrato', 'Vencimiento de contrato'],
  ['condiciones_comerciales', 'Condiciones comerciales'],
  ['observaciones', 'Observaciones'],
];

/**
 * Excel en español interpreta la coma como separador decimal, así que el CSV
 * va con punto y coma. El BOM al inicio es lo que hace que abra los acentos
 * bien sin pedir nada al usuario.
 */
/**
 * El REPSE solo en la plantilla viva.
 *
 * Los cortes cerrados no lo guardan: la foto mensual se diseñó antes de que el
 * campo existiera. Sacarlo igual dejaría una columna vacía en cada exportación
 * histórica, que se lee como «a ninguno se lo piden» en vez de «el corte no
 * guarda ese dato».
 */
const COLUMNAS_ACTUAL = [['tipo_repse', '¿El cliente pide REPSE?']];

const SEPARADOR = ';';
const BOM = '﻿';

function celda(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  const s = String(v).replace(/\r?\n/g, ' ').trim();
  return /[";]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request, { params }) {
  try {
    requerirUsuario();

    const periodo = params.periodo;
    const esActual = periodo === 'actual';

    if (!esActual && !/^\d{4}-\d{2}$/.test(periodo)) {
      return NextResponse.json({ error: 'Periodo inválido. Usa AAAA-MM o "actual".' }, { status: 400 });
    }

    const dia = comoDia(new URL(request.url).searchParams.get('dia'));

    let filas;
    if (dia) {
      filas = estadoAlDia(dia).servicios;
    } else if (esActual) {
      filas = listarServicios({ estatus: 'ACTIVO' });
    } else {
      const existe = getDb().prepare('SELECT 1 FROM snapshots WHERE periodo = ? LIMIT 1').get(periodo);
      if (!existe) {
        return NextResponse.json({ error: `No hay corte para ${periodo}.` }, { status: 404 });
      }
      filas = serviciosDeCorte(periodo);
    }

    // La reconstrucción de un día lleva una columna más: cuántos elementos se
    // le revirtieron a ese servicio. Sin ella, el archivo enseña una plantilla
    // ajustada sin decir que se ajustó, y fuera de la pantalla ya no hay quién
    // lo explique.
    const columnas = dia
      ? [...COLUMNAS, ...COLUMNAS_ACTUAL, ['plantilla_ajustada', 'Ajuste aplicado a la plantilla']]
      : esActual
        ? [...COLUMNAS, ...COLUMNAS_ACTUAL]
        : COLUMNAS;
    const lineas = [
      columnas.map(([, et]) => celda(et)).join(SEPARADOR),
      ...filas.map((f) =>
        columnas.map(([c]) => {
          if (c === 'tiene_contrato') return f[c] ? 'SI' : 'NO';
          return celda(f[c]);
        }).join(SEPARADOR)
      ),
    ];

    return new NextResponse(BOM + lineas.join('\r\n') + '\r\n', {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="estado-fuerza-${dia || (esActual ? 'actual' : periodo)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof NoAutenticado) {
      return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
    }
    throw e;
  }
}
