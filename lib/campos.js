/** Etiquetas y tipos de los campos editables de `servicios`, para la UI. */
export const CAMPOS = {
  // contrato
  tiene_contrato: { etiqueta: '¿Cuenta con contrato?', tipo: 'bool' },
  fecha_contrato: { etiqueta: 'Fecha de firma del contrato', tipo: 'date' },
  fecha_vencimiento_contrato: { etiqueta: 'Vencimiento del contrato', tipo: 'date' },
  condiciones_comerciales: { etiqueta: 'Condiciones comerciales', tipo: 'text' },
  comentarios_contrato: { etiqueta: 'Comentarios / negativa del contrato', tipo: 'textarea' },

  // finanzas
  guardias_en_factura: { etiqueta: 'Guardias en factura', tipo: 'int' },
  importe_factura: { etiqueta: 'Importe de factura', tipo: 'money' },
  importe_sin_iva: { etiqueta: 'Importe sin IVA', tipo: 'money' },
  nomina_total: { etiqueta: 'Nómina total del servicio', tipo: 'money' },
  nomina_prestaciones: { etiqueta: 'Nómina + prestaciones', tipo: 'money' },
  resultado_servicio: { etiqueta: 'Resultado del servicio', tipo: 'money' },
  pct_utilidad: { etiqueta: '% utilidad', tipo: 'number' },
  utilidad_bruta: { etiqueta: 'Utilidad bruta', tipo: 'money' },
  status_cobranza: { etiqueta: 'Status de cobranza (nota libre)', tipo: 'text' },

  // Condiciones de cobro. De estas tres sale todo lo demás: el esquema dice
  // cuándo se emite la factura, los días de crédito cuándo vence, y el crédito
  // máximo hasta dónde puede crecer el saldo antes de encender el semáforo.
  esquema_facturacion: { etiqueta: 'Cuándo se factura', tipo: 'catalogo', catalogo: 'esquemas' },
  dias_credito: { etiqueta: 'Días de crédito', tipo: 'int' },
  credito_maximo: { etiqueta: 'Línea de crédito', tipo: 'money' },
  forma_pago: { etiqueta: 'Forma de pago', tipo: 'catalogo', catalogo: 'formasPago' },
  cobro: { etiqueta: 'Detalle del cobro (banco, cuenta…)', tipo: 'text' },

  // operativo (admin)
  razon_social: { etiqueta: 'Razón social', tipo: 'text' },
  direccion: { etiqueta: 'Dirección / ubicación', tipo: 'text' },
  // `catalogo` se pinta como lista desplegable: las opciones salen de la tabla
  // `catalogos`, que alimenta el administrador.
  zona: { etiqueta: 'Zona', tipo: 'catalogo', catalogo: 'zonas' },
  tipo: { etiqueta: 'Tipo', tipo: 'text' },
  cluster: { etiqueta: 'Cluster', tipo: 'text' },
  estado_geo: { etiqueta: 'Estado', tipo: 'catalogo', catalogo: 'estados' },
  supervisor: { etiqueta: 'Supervisor a cargo', tipo: 'catalogo', catalogo: 'supervisores' },
  asesor: { etiqueta: 'Asesor', tipo: 'catalogo', catalogo: 'asesores' },
  gerente: { etiqueta: 'Gerente a cargo', tipo: 'catalogo', catalogo: 'gerentes' },
  // Fijo, temporal o de evento, y hasta cuándo. Se puede cambiar aquí porque
  // todo lo que ya estaba nació como fijo —antes no había dónde decir otra
  // cosa— y marcar los temporales que ya operan solo se puede hacer a mano.
  modalidad: { etiqueta: '¿Fijo o temporal?', tipo: 'opciones', opciones: ['FIJO', 'TEMPORAL', 'EVENTO'] },
  fecha_fin_prevista: { etiqueta: 'Termina el (si no es fijo)', tipo: 'date' },
  precio_guardia: { etiqueta: 'Precio por guardia', tipo: 'money' },
  sueldo_base: { etiqueta: 'Sueldo base del elemento', tipo: 'money' },
  bono: { etiqueta: 'Bono', tipo: 'money' },
  uniforme: { etiqueta: 'Tipo de uniforme', tipo: 'catalogo', catalogo: 'uniformes' },
  tipo_repse: { etiqueta: '¿El cliente pide REPSE?', tipo: 'catalogo', catalogo: 'tiposRepse' },
  observaciones: { etiqueta: 'Observaciones', tipo: 'textarea' },
  mes_incremento: { etiqueta: 'Mes de incremento', tipo: 'text' },
  anio_ultimo_incremento: { etiqueta: 'Último año de incremento', tipo: 'text' },
};

export const MOTIVOS_CANCELACION = [
  'FIN DE CONTRATO',
  'REDUCCIÓN DE PLANTILLA',
  'CIERRE DE SERVICIO',
  'FIN DE SERVICIO',
  'FALTA DE COBERTURA',
  'INSATISFACCIÓN DEL CLIENTE',
  'CAMBIO DE PROVEEDOR',
  'FALTA DE PAGO',
  'DEMOLICIÓN DEL SITIO',
  'OTRO',
];

export const AUTORIZACIONES_APERTURA = [
  ['ventas', 'Ventas (Dirección)'],
  ['cxc', 'CXC'],
  ['operacion', 'Operación (Dirección)'],
  ['capacitacion', 'Capacitación'],
  ['sistemas', 'Sistemas'],
  ['juridico', 'Jurídico'],
  ['contraloria', 'Contraloría'],
];

export const AUTORIZACIONES_CANCELACION = [
  ['ventas', 'Ventas (Dirección)'],
  ['cxc', 'CXC'],
  ['operacion', 'Operación (Dirección)'],
  ['sistemas', 'Sistemas / teléfonos devueltos'],
  ['juridico', 'Jurídico'],
  ['contraloria', 'Contraloría'],
];

/**
 * El expediente de un movimiento, agrupado como se lee.
 *
 * Un renglón de la lista solo puede enseñar seis o siete columnas, y en la
 * captura se llenan treinta campos. Todo lo demás se quedaba escrito y sin
 * nadie que lo viera: esto es lo que se abre al desplegar el renglón.
 *
 * Vive aquí, y no en la pantalla, porque lo usan el navegador y el servidor:
 * en `lib/movimientos.js` viven las consultas, que arrastran better-sqlite3 y
 * por eso no pueden viajar a un componente de cliente.
 */
export const EXPEDIENTE_APERTURA = [
  {
    titulo: 'El cliente',
    campos: [
      ['razon_social', 'Razón social'],
      ['direccion', 'Dirección'],
      ['zona', 'Zona'],
      ['cluster', 'Clúster'],
      ['estado_geo', 'Estado'],
      ['tipo_repse', '¿Pide REPSE?'],
    ],
  },
  {
    titulo: 'Quién lo lleva',
    campos: [
      ['asesor', 'Asesor'],
      ['gerente', 'Gerente'],
      ['supervisor', 'Supervisor'],
      ['reporta', 'Lo reportó'],
    ],
  },
  {
    titulo: 'Cómo arranca',
    campos: [
      ['modalidad', '¿Fijo o temporal?'],
      ['fecha_fin_prevista', 'Termina el'],
      ['hora_apertura', 'Hora de apertura'],
      ['vehiculos_custodia', 'Vehículos de custodia'],
    ],
  },
  {
    titulo: 'Dinero',
    campos: [
      ['precio_guardia', 'Precio por guardia', 'money'],
      ['sueldo_base', 'Sueldo base', 'money'],
      ['bono', 'Bono', 'money'],
      ['uniforme', 'Uniforme'],
    ],
  },
  {
    titulo: 'Cómo se cobra',
    campos: [
      ['esquema_facturacion', 'Cuándo se factura'],
      ['forma_pago', 'Forma de pago'],
      ['dias_credito', 'Días de crédito'],
      ['credito_maximo', 'Crédito máximo', 'money'],
      ['credito_plazo', 'Plazo (texto del archivo)'],
      ['cobro', 'Cobro'],
    ],
  },
];

export const EXPEDIENTE_CANCELACION = [
  {
    // El motivo no va aquí: se enseña completo en su propio recuadro, porque
    // suele ser una frase y no un dato de una línea.
    titulo: 'Cómo se cerró',
    campos: [
      ['auditoria', 'Auditoría'],
      ['cxc', 'Cuentas por cobrar al cerrar', 'money'],
      ['fecha', 'Fecha del movimiento'],
      ['periodo', 'Periodo'],
    ],
  },
  {
    titulo: 'Quién lo llevaba',
    campos: [
      ['zona', 'Zona'],
      ['asesor', 'Asesor'],
      ['reporta', 'Lo reportó'],
    ],
  },
];
