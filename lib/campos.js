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
  facturado: { etiqueta: '¿Ya se facturó?', tipo: 'bool' },
  status_cobranza: { etiqueta: 'Status de cobranza', tipo: 'text' },
  fecha_pago: { etiqueta: 'Fecha de pago', tipo: 'date' },
  forma_pago: { etiqueta: 'Forma de pago', tipo: 'text' },
  cobro: { etiqueta: 'Cobro (transferencia, efectivo…)', tipo: 'text' },
  credito_maximo: { etiqueta: 'Importe de crédito máximo', tipo: 'money' },
  dias_credito: { etiqueta: 'Días de crédito', tipo: 'int' },
  importe_pendiente: { etiqueta: 'Importe pendiente de pago', tipo: 'money' },
  saldo_vencido: { etiqueta: 'Saldo vencido vs crédito', tipo: 'money' },

  // operativo (admin)
  razon_social: { etiqueta: 'Razón social', tipo: 'text' },
  direccion: { etiqueta: 'Dirección / ubicación', tipo: 'text' },
  // `catalogo` se pinta como lista desplegable: las opciones salen de la tabla
  // `catalogos`, que alimenta el administrador.
  zona: { etiqueta: 'Zona', tipo: 'catalogo', catalogo: 'zonas' },
  tipo: { etiqueta: 'Tipo', tipo: 'text' },
  cluster: { etiqueta: 'Cluster', tipo: 'text' },
  estado_geo: { etiqueta: 'Estado (geográfico)', tipo: 'text' },
  supervisor: { etiqueta: 'Supervisor', tipo: 'text' },
  asesor: { etiqueta: 'Asesor', tipo: 'catalogo', catalogo: 'asesores' },
  gerente: { etiqueta: 'Gerente a cargo', tipo: 'text' },
  precio_guardia: { etiqueta: 'Precio por guardia', tipo: 'money' },
  sueldo_base: { etiqueta: 'Sueldo base del elemento', tipo: 'money' },
  bono: { etiqueta: 'Bono', tipo: 'money' },
  uniforme: { etiqueta: 'Tipo de uniforme', tipo: 'text' },
  tipo_repse: { etiqueta: 'Tipo de REPSE', tipo: 'text' },
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
