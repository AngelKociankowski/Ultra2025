/**
 * Roles y permisos de la plataforma.
 *
 * Regla invariante del negocio: los servicios del estado de fuerza no se dan de
 * alta ni de baja directamente. Solo el flujo de APERTURA crea un servicio y
 * solo el flujo de CANCELACION lo da de baja. Ningún rol — incluido admin —
 * tiene un permiso de "crear servicio" o "borrar servicio".
 */

export const ROLES = {
  admin: {
    etiqueta: 'Administrador',
    descripcion: 'Aperturas, cancelaciones, facturas, contratos y usuarios.',
    color: 'violet',
  },
  juridico: {
    etiqueta: 'Jurídico',
    descripcion: 'Consulta todas las bases y modifica contratos.',
    color: 'amber',
  },
  finanzas: {
    etiqueta: 'Finanzas',
    descripcion: 'Consulta todas las bases y modifica facturación y cobranza.',
    color: 'emerald',
  },
  operaciones: {
    etiqueta: 'Operaciones',
    descripcion: 'Registra aperturas y cancelaciones.',
    color: 'cyan',
  },
  ventas: {
    etiqueta: 'Ventas',
    descripcion: 'Registra aperturas y cancelaciones.',
    color: 'blue',
  },
};

/** Grupos de campos de `servicios` y quién puede editarlos. */
export const GRUPOS_CAMPOS = {
  contrato: {
    etiqueta: 'Contrato',
    roles: ['admin', 'juridico'],
    campos: [
      'tiene_contrato',
      'fecha_contrato',
      'fecha_vencimiento_contrato',
      'condiciones_comerciales',
      'comentarios_contrato',
    ],
  },
  finanzas: {
    etiqueta: 'Facturación y cobranza',
    roles: ['admin', 'finanzas'],
    campos: [
      'guardias_en_factura',
      'importe_factura',
      'importe_sin_iva',
      'nomina_total',
      'nomina_prestaciones',
      'resultado_servicio',
      'pct_utilidad',
      'utilidad_bruta',
      'facturado',
      'status_cobranza',
      'fecha_pago',
      'forma_pago',
      'cobro',
      'credito_maximo',
      'dias_credito',
      'importe_pendiente',
      'saldo_vencido',
    ],
  },
  operativo: {
    etiqueta: 'Datos operativos',
    roles: ['admin'],
    campos: [
      'razon_social',
      'direccion',
      'zona',
      'tipo',
      'cluster',
      'estado_geo',
      'supervisor',
      'asesor',
      'gerente',
      'precio_guardia',
      'sueldo_base',
      'bono',
      'uniforme',
      'tipo_repse',
      'observaciones',
      'mes_incremento',
      'anio_ultimo_incremento',
    ],
  },
};

/**
 * Campos que el admin puede arreglar con una CORRECCIÓN.
 *
 * Son justo los que la edición normal tiene bloqueados, porque describen el
 * estado de fuerza y no un dato administrativo. La corrección no es un permiso
 * de edición más: es el reconocimiento de que una captura puede salir mal y
 * alguien tiene que poder arreglarla sin inventar un movimiento que nunca
 * ocurrió. Exige motivo escrito y queda registrada aparte.
 */
export const CAMPOS_CORREGIBLES = ['servicio', 'total_guardias', 'turnos', 'estatus', 'fecha_alta'];

/** Campos que nunca se editan por API (los mueve el flujo apertura/cancelación). */
export const CAMPOS_BLOQUEADOS = [
  'id',
  'servicio',
  'estatus',
  'total_guardias',
  'turnos_json',
  'apertura_id',
  'cancelacion_id',
  'fecha_alta',
  'fecha_baja',
  'creado_en',
  'actualizado_en',
];

export const PERMISOS = {
  admin: ['ver', 'apertura', 'cancelacion', 'corregir', 'editar_contrato', 'editar_finanzas', 'editar_operativo', 'usuarios', 'catalogos', 'bitacora'],
  juridico: ['ver', 'editar_contrato', 'bitacora'],
  finanzas: ['ver', 'editar_finanzas', 'bitacora'],
  operaciones: ['ver', 'apertura', 'cancelacion'],
  ventas: ['ver', 'apertura', 'cancelacion'],
};

export function puede(rol, permiso) {
  return (PERMISOS[rol] || []).includes(permiso);
}

/** Lista de campos de `servicios` que un rol puede escribir. */
export function camposEditables(rol) {
  const out = [];
  for (const [clave, grupo] of Object.entries(GRUPOS_CAMPOS)) {
    if (grupo.roles.includes(rol)) out.push(...grupo.campos);
  }
  return out;
}

/** Grupos visibles como editables en la UI para ese rol. */
export function gruposEditables(rol) {
  return Object.entries(GRUPOS_CAMPOS)
    .filter(([, g]) => g.roles.includes(rol))
    .map(([clave, g]) => ({ clave, ...g }));
}

/**
 * Filtra un payload dejando solo los campos que el rol puede escribir.
 * Devuelve { datos, rechazados }.
 */
export function filtrarCampos(rol, payload) {
  const permitidos = new Set(camposEditables(rol));
  const datos = {};
  const rechazados = [];
  for (const [k, v] of Object.entries(payload || {})) {
    if (CAMPOS_BLOQUEADOS.includes(k)) {
      rechazados.push(k);
    } else if (permitidos.has(k)) {
      datos[k] = v;
    } else {
      rechazados.push(k);
    }
  }
  return { datos, rechazados };
}

/** Navegación por rol. */
export function navegacion(rol) {
  const items = [
    { href: '/', etiqueta: 'Tablero', icono: '📊', permiso: 'ver' },
    { href: '/estado-fuerza', etiqueta: 'Estado de fuerza', icono: '🛡️', permiso: 'ver' },
    { href: '/aperturas', etiqueta: 'Aperturas', icono: '➕', permiso: 'ver' },
    { href: '/cancelaciones', etiqueta: 'Cancelaciones', icono: '➖', permiso: 'ver' },
    { href: '/bitacora', etiqueta: 'Bitácora', icono: '📝', permiso: 'bitacora' },
    { href: '/catalogos', etiqueta: 'Catálogos', icono: '🗂️', permiso: 'catalogos' },
    { href: '/usuarios', etiqueta: 'Usuarios', icono: '👥', permiso: 'usuarios' },
  ];
  return items.filter((i) => puede(rol, i.permiso));
}
