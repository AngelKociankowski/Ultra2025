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
  espectador: {
    etiqueta: 'Espectador',
    descripcion: 'Consulta todo y no modifica nada. Ni siquiera un comentario.',
    color: 'slate',
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
    // Ni el saldo pendiente ni el vencido están aquí, y no es un olvido: los
    // calcula el libro de facturas. Lo que se captura son las condiciones de
    // cobro; el adeudo se sigue de ellas y de los pagos registrados.
    campos: [
      'guardias_en_factura',
      'importe_factura',
      'importe_sin_iva',
      'resultado_servicio',
      'pct_utilidad',
      'utilidad_bruta',
      'status_cobranza',
      'esquema_facturacion',
      'forma_pago',
      'cobro',
      'credito_maximo',
      'dias_credito',
    ],
  },
  /**
   * El REPSE, aparte y abierto a más roles.
   *
   * Está vacío en los 217 servicios: la columna existe desde el principio y
   * nunca se llenó, porque el único que podía tocarla era el administrador y no
   * es quien tiene el dato. Lo saben ventas cuando cierra, operaciones cuando
   * monta y cobranza cuando factura —es requisito de la autoridad para poder
   * cobrar—, así que los cuatro pueden capturarlo.
   *
   * Va en su propio grupo y no dentro de «datos operativos» a propósito: ese
   * bloque trae precios, sueldos y bonos, y abrirlo entero para que se pueda
   * escribir el REPSE sería regalar mucho más de lo que se pidió.
   */
  /**
   * La nómina, también de operaciones.
   *
   * No es un dato contable que se captura una vez y se olvida: cambia mes a mes
   * —horas extra, cubres, un elemento que entra a media quincena— y quien lo
   * sabe primero es quien arma los turnos. Tenerlo cerrado a finanzas obligaba
   * a que el dato viajara por correo antes de llegar a la plataforma, y por eso
   * está capturado en 128 de 217 servicios.
   *
   * Lo que NO se les abre es el resultado ni el porcentaje de utilidad: esos se
   * siguen de la nómina y del importe, y quien los interpreta es finanzas.
   */
  nomina: {
    etiqueta: 'Nómina',
    roles: ['admin', 'finanzas', 'operaciones'],
    campos: ['nomina_total', 'nomina_prestaciones'],
  },
  repse: {
    etiqueta: 'REPSE',
    roles: ['admin', 'ventas', 'operaciones', 'finanzas'],
    campos: ['tipo_repse'],
  },
  operativo: {
    etiqueta: 'Datos operativos',
    roles: ['admin'],
    campos: [
      'direccion',
      'zona',
      'tipo',
      'cluster',
      'estado_geo',
      'supervisor',
      // Todo lo que venía de los archivos nació como fijo, porque hasta ahora
      // no había dónde decir otra cosa. Marcar los temporales que ya están
      // operando solo se puede hacer aquí.
      'modalidad',
      'fecha_fin_prevista',
      'asesor',
      'gerente',
      'precio_guardia',
      'sueldo_base',
      'bono',
      'uniforme',
      'observaciones',
      'mes_incremento',
      'anio_ultimo_incremento',
    ],
  },
};

// `tipo_repse` no se repite en «operativo»: un campo en dos grupos se acabaría
// editando desde dos formularios distintos con reglas distintas. El
// administrador lo alcanza por el grupo de arriba, que también es suyo.

/**
 * Campos que el admin puede arreglar con una CORRECCIÓN.
 *
 * Son justo los que la edición normal tiene bloqueados, porque describen el
 * estado de fuerza y no un dato administrativo. La corrección no es un permiso
 * de edición más: es el reconocimiento de que una captura puede salir mal y
 * alguien tiene que poder arreglarla sin inventar un movimiento que nunca
 * ocurrió. Exige motivo escrito y queda registrada aparte.
 */
export const CAMPOS_CORREGIBLES = ['servicio', 'razon_social', 'total_guardias', 'turnos', 'estatus', 'fecha_alta'];

/**
 * Qué puede corregir cada rol.
 *
 * La corrección no es un permiso de todo o nada. El administrador arregla lo
 * que describe el estado de fuerza —nombre, plantilla, turnos, fecha de alta—.
 * Jurídico entra solo por la razón social, que es el nombre legal del cliente:
 * el que va en el contrato y en la factura, no el corto con el que lo nombra
 * operaciones. De 217 servicios activos, 193 tienen una razón social distinta
 * de su nombre, y quien sabe cuál es la buena es quien lleva el contrato.
 *
 * Deliberadamente NO se le dan a jurídico la plantilla ni el estatus. Pidieron
 * que pudiera corregir la razón social, no que pudiera mover guardias ni
 * revivir un servicio dado de baja.
 */
export const CORRECCION_POR_ROL = {
  admin: CAMPOS_CORREGIBLES,
  juridico: ['razon_social'],
};

/** Los campos que ese rol puede tocar en una corrección. Vacío = no puede. */
export function camposCorregibles(rol) {
  return CORRECCION_POR_ROL[rol] || [];
}

/** Campos que nunca se editan por API (los mueve el flujo apertura/cancelación). */
export const CAMPOS_BLOQUEADOS = [
  'id',
  'servicio',
  // La razón social es el nombre legal del cliente: lo que dice el contrato y
  // lo que va en la factura. Se cambia por corrección —con motivo escrito y
  // registro aparte— y no por la edición corriente de la ficha, igual que el
  // nombre del servicio.
  'razon_social',
  'estatus',
  'total_guardias',
  'turnos_json',
  'apertura_id',
  'cancelacion_id',
  'fecha_alta',
  'fecha_baja',
  'creado_en',
  'actualizado_en',
  // los mueve el libro de facturas, no la edición de la ficha
  'importe_pendiente',
  'saldo_vencido',
  'fecha_pago',
];

export const PERMISOS = {
  admin: ['ver', 'comentar', 'apertura', 'cancelacion', 'corregir', 'editar_contrato', 'editar_finanzas', 'editar_operativo', 'usuarios', 'catalogos', 'bitacora', 'precios', 'respaldos'],
  juridico: ['ver', 'comentar', 'editar_contrato', 'corregir', 'bitacora'],
  finanzas: ['ver', 'comentar', 'editar_finanzas', 'bitacora', 'precios'],
  operaciones: ['ver', 'comentar', 'apertura', 'cancelacion'],
  ventas: ['ver', 'comentar', 'apertura', 'cancelacion', 'precios'],
  // Un espectador ve todo lo que ve cualquiera y no deja huella en ningún lado.
  // «Ver» y «comentar» van separados a propósito: escribir una nota en la ficha
  // de un servicio es modificar la plataforma, aunque no mueva ninguna cifra.
  espectador: ['ver'],
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
    { href: '/cobranza', etiqueta: 'Cobranza', icono: '💰', permiso: 'editar_finanzas' },
    // A diferencia de cobranza, esta la ve todo el mundo. No es una excepción
    // caprichosa: el estado del contrato de un servicio ya se enseña en el
    // estado de fuerza, y saber si un cliente está operando sin papel le sirve
    // a ventas y a operaciones tanto como a jurídico. Modificarlo sigue siendo
    // de jurídico y del administrador, que son quienes tienen `editar_contrato`.
    { href: '/juridico', etiqueta: 'Jurídico', icono: '⚖️', permiso: 'ver' },
    // Lo de `grupo: 'admin'` no se usa a diario: se junta bajo un solo botón
    // para que las pestañas de todos los días quepan en una laptop.
    { href: '/precios', etiqueta: 'Precios', icono: '🏷️', permiso: 'precios', grupo: 'admin' },
    { href: '/bitacora', etiqueta: 'Bitácora', icono: '📝', permiso: 'bitacora', grupo: 'admin' },
    { href: '/catalogos', etiqueta: 'Catálogos', icono: '🗂️', permiso: 'catalogos', grupo: 'admin' },
    { href: '/usuarios', etiqueta: 'Usuarios', icono: '👥', permiso: 'usuarios', grupo: 'admin' },
    { href: '/respaldos', etiqueta: 'Respaldos', icono: '💾', permiso: 'respaldos', grupo: 'admin' },
  ];
  return items.filter((i) => puede(rol, i.permiso));
}
