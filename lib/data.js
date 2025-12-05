// Configuración de Metas
export const CONFIG = {
  NUM_ASESORES: 10,
  META_VENTAS_POR_ASESOR: 150000,
  META_GUARDIAS_POR_ASESOR: 4,
  COSTO_PROMEDIO_GUARDIA: 10000,
  YEAR: 2025,
  MESES_VENTAS: 11, // Ene-Nov
  MESES_OPERACIONES: 12 // Ene-Dic
};

export const METAS = {
  ventasMensual: CONFIG.NUM_ASESORES * CONFIG.META_VENTAS_POR_ASESOR,
  guardiasMensual: CONFIG.NUM_ASESORES * CONFIG.META_GUARDIAS_POR_ASESOR,
  ventasYTD: CONFIG.NUM_ASESORES * CONFIG.META_VENTAS_POR_ASESOR * CONFIG.MESES_VENTAS,
  guardiasYTD: CONFIG.NUM_ASESORES * CONFIG.META_GUARDIAS_POR_ASESOR * CONFIG.MESES_OPERACIONES
};

// Datos de Ventas Mensuales
export const ventasMensuales = [
  { mes: 'Ene', mesNum: 1, ventas: 3247882, serviciosVendidos: 12, ticketPromedio: 270657 },
  { mes: 'Feb', mesNum: 2, ventas: 2401594, serviciosVendidos: 9, ticketPromedio: 266844 },
  { mes: 'Mar', mesNum: 3, ventas: 1787941, serviciosVendidos: 7, ticketPromedio: 255420 },
  { mes: 'Abr', mesNum: 4, ventas: 2085264, serviciosVendidos: 8, ticketPromedio: 260658 },
  { mes: 'May', mesNum: 5, ventas: 3081420, serviciosVendidos: 11, ticketPromedio: 280129 },
  { mes: 'Jun', mesNum: 6, ventas: 3152610, serviciosVendidos: 11, ticketPromedio: 286601 },
  { mes: 'Jul', mesNum: 7, ventas: 2027486, serviciosVendidos: 8, ticketPromedio: 253436 },
  { mes: 'Ago', mesNum: 8, ventas: 2387246, serviciosVendidos: 10, ticketPromedio: 238725 },
  { mes: 'Sep', mesNum: 9, ventas: 2620726, serviciosVendidos: 9, ticketPromedio: 291192 },
  { mes: 'Oct', mesNum: 10, ventas: 2005710, serviciosVendidos: 8, ticketPromedio: 250714 },
  { mes: 'Nov', mesNum: 11, ventas: 2999280, serviciosVendidos: 10, ticketPromedio: 299928 }
].map(m => ({
  ...m,
  meta: METAS.ventasMensual,
  cumplimiento: ((m.ventas / METAS.ventasMensual) * 100).toFixed(1),
  diferencia: m.ventas - METAS.ventasMensual,
  sobreMeta: m.ventas >= METAS.ventasMensual
}));

// Datos de Asesores
export const asesores = [
  { id: 1, nombre: 'Miguel Torres', ventas: 9909861, servicios: 35, zona: 'Norte', antiguedad: 5 },
  { id: 2, nombre: 'Carlos Loaiza', ventas: 5181688, servicios: 19, zona: 'Norte', antiguedad: 4 },
  { id: 3, nombre: 'Alberto Milla', ventas: 2412004, servicios: 9, zona: 'Sur', antiguedad: 3 },
  { id: 4, nombre: 'Humberto Martinez', ventas: 2360248, servicios: 9, zona: 'Sur', antiguedad: 3 },
  { id: 5, nombre: 'Geovanni Jimenez', ventas: 1875834, servicios: 7, zona: 'Norte', antiguedad: 2 },
  { id: 6, nombre: 'Eduardo Rodriguez', ventas: 1546073, servicios: 6, zona: 'Sur', antiguedad: 2 },
  { id: 7, nombre: 'Armando Lopez', ventas: 1457291, servicios: 5, zona: 'Norte', antiguedad: 2 },
  { id: 8, nombre: 'Mauricio Valenzuela', ventas: 1052025, servicios: 4, zona: 'Sur', antiguedad: 1 },
  { id: 9, nombre: 'Rocío Zamora', ventas: 979324, servicios: 4, zona: 'Alpura', antiguedad: 1 },
  { id: 10, nombre: 'Isaí Alvarado', ventas: 937310, servicios: 3, zona: 'Alpura', antiguedad: 1 }
].map((a, i) => {
  const metaIndividual = CONFIG.META_VENTAS_POR_ASESOR * CONFIG.MESES_VENTAS;
  return {
    ...a,
    rank: i + 1,
    participacion: 0, // Se calcula después
    metaYTD: metaIndividual,
    cumplimiento: ((a.ventas / metaIndividual) * 100).toFixed(1),
    sobreMeta: a.ventas >= metaIndividual,
    ticketPromedio: Math.round(a.ventas / a.servicios),
    color: ['#10b981', '#06b6d4', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#a855f7', '#64748b'][i]
  };
});

// Calcular participación
const totalVentas = asesores.reduce((sum, a) => sum + a.ventas, 0);
asesores.forEach(a => {
  a.participacion = ((a.ventas / totalVentas) * 100).toFixed(1);
});

// Datos de Operaciones (Guardias)
export const operacionesMensuales = [
  { mes: 'Ene', mesNum: 1, guardiasApert: 4, guardiasCancl: 8, serviciosApert: 1, serviciosCancl: 2 },
  { mes: 'Feb', mesNum: 2, guardiasApert: 28, guardiasCancl: 68, serviciosApert: 7, serviciosCancl: 17 },
  { mes: 'Mar', mesNum: 3, guardiasApert: 21, guardiasCancl: 16, serviciosApert: 5, serviciosCancl: 4 },
  { mes: 'Abr', mesNum: 4, guardiasApert: 15, guardiasCancl: 14, serviciosApert: 4, serviciosCancl: 4 },
  { mes: 'May', mesNum: 5, guardiasApert: 32, guardiasCancl: 28, serviciosApert: 8, serviciosCancl: 7 },
  { mes: 'Jun', mesNum: 6, guardiasApert: 16, guardiasCancl: 7, serviciosApert: 4, serviciosCancl: 2 },
  { mes: 'Jul', mesNum: 7, guardiasApert: 36, guardiasCancl: 27, serviciosApert: 9, serviciosCancl: 7 },
  { mes: 'Ago', mesNum: 8, guardiasApert: 52, guardiasCancl: 12, serviciosApert: 13, serviciosCancl: 3 },
  { mes: 'Sep', mesNum: 9, guardiasApert: 20, guardiasCancl: 18, serviciosApert: 5, serviciosCancl: 5 },
  { mes: 'Oct', mesNum: 10, guardiasApert: 52, guardiasCancl: 28, serviciosApert: 13, serviciosCancl: 7 },
  { mes: 'Nov', mesNum: 11, guardiasApert: 8, guardiasCancl: 18, serviciosApert: 2, serviciosCancl: 5 },
  { mes: 'Dic', mesNum: 12, guardiasApert: 32, guardiasCancl: 34, serviciosApert: 8, serviciosCancl: 9 }
].map(m => ({
  ...m,
  meta: METAS.guardiasMensual,
  neto: m.guardiasApert - m.guardiasCancl,
  netoServicios: m.serviciosApert - m.serviciosCancl,
  cumplimiento: ((m.guardiasApert / METAS.guardiasMensual) * 100).toFixed(1),
  sobreMeta: m.guardiasApert >= METAS.guardiasMensual,
  costoOportunidad: m.guardiasCancl * CONFIG.COSTO_PROMEDIO_GUARDIA
}));

// Motivos de Cancelación
export const motivosCancelacion = [
  { motivo: 'Reducción de plantilla', cantidad: 14, porcentaje: 31.8, guardias: 98, color: '#ef4444' },
  { motivo: 'Fin de contrato', cantidad: 7, porcentaje: 15.9, guardias: 49, color: '#f97316' },
  { motivo: 'Cierre de servicio', cantidad: 6, porcentaje: 13.6, guardias: 42, color: '#eab308' },
  { motivo: 'Fin de servicio', cantidad: 4, porcentaje: 9.1, guardias: 28, color: '#84cc16' },
  { motivo: 'Falta de cobertura', cantidad: 3, porcentaje: 6.8, guardias: 21, color: '#22c55e' },
  { motivo: 'Insatisfacción', cantidad: 3, porcentaje: 6.8, guardias: 21, color: '#14b8a6' },
  { motivo: 'Cambio de proveedor', cantidad: 2, porcentaje: 4.5, guardias: 14, color: '#06b6d4' },
  { motivo: 'Otros', cantidad: 5, porcentaje: 11.4, guardias: 35, color: '#64748b' }
];

// Estado de Fuerza - Servicios Activos
export const serviciosActivos = [
  { mes: 'Ene', mesNum: 1, servicios: 198, guardias: 892 },
  { mes: 'Feb', mesNum: 2, servicios: 202, guardias: 856 },
  { mes: 'Mar', mesNum: 3, servicios: 208, guardias: 861 },
  { mes: 'Abr', mesNum: 4, servicios: 202, guardias: 848 },
  { mes: 'May', mesNum: 5, servicios: 210, guardias: 852 },
  { mes: 'Jun', mesNum: 6, servicios: 207, guardias: 854 },
  { mes: 'Jul', mesNum: 7, servicios: 214, guardias: 863 },
  { mes: 'Ago', mesNum: 8, servicios: 227, guardias: 903 },
  { mes: 'Sep', mesNum: 9, servicios: 233, guardias: 905 },
  { mes: 'Oct', mesNum: 10, servicios: 235, guardias: 929 },
  { mes: 'Nov', mesNum: 11, servicios: 233, guardias: 919 },
  { mes: 'Dic', mesNum: 12, servicios: 224, guardias: 893 }
].map((m, i, arr) => ({
  ...m,
  variacion: i === 0 ? 0 : m.servicios - arr[i-1].servicios,
  variacionGuardias: i === 0 ? 0 : m.guardias - arr[i-1].guardias,
  promGuardiasPorServicio: (m.guardias / m.servicios).toFixed(1)
}));

// Distribución por Zona
export const distribucionZona = [
  { zona: 'Norte', servicios: 117, guardias: 527, participacion: 50.2, color: '#10b981', tendencia: '+5%' },
  { zona: 'Sur', servicios: 92, guardias: 368, participacion: 39.5, color: '#06b6d4', tendencia: '+3%' },
  { zona: 'Alpura', servicios: 27, guardias: 108, participacion: 11.6, color: '#8b5cf6', tendencia: '-2%' }
];

// Distribución por Tipo de Cliente
export const distribucionTipo = [
  { tipo: 'Servicios', cantidad: 93, participacion: 39.9, ingresoProm: 285000, color: '#10b981' },
  { tipo: 'Industria', cantidad: 73, participacion: 31.3, ingresoProm: 420000, color: '#06b6d4' },
  { tipo: 'Condominios', cantidad: 40, participacion: 17.2, ingresoProm: 180000, color: '#f59e0b' },
  { tipo: 'Comercio', cantidad: 18, participacion: 7.7, ingresoProm: 150000, color: '#ef4444' },
  { tipo: 'Otros', cantidad: 9, participacion: 3.9, ingresoProm: 200000, color: '#64748b' }
];

// Top Clientes
export const topClientes = [
  { nombre: 'Grupo Industrial Alfa', guardias: 45, ingresoMensual: 450000, antiguedad: 8, zona: 'Norte' },
  { nombre: 'Condominio Las Palmas', guardias: 32, ingresoMensual: 320000, antiguedad: 5, zona: 'Sur' },
  { nombre: 'Alpura SA de CV', guardias: 28, ingresoMensual: 280000, antiguedad: 6, zona: 'Alpura' },
  { nombre: 'Plaza Comercial Centro', guardias: 24, ingresoMensual: 240000, antiguedad: 4, zona: 'Norte' },
  { nombre: 'Fábrica Textil del Norte', guardias: 22, ingresoMensual: 220000, antiguedad: 3, zona: 'Norte' }
];

// KPIs Calculados
export const calcularKPIs = () => {
  const totalVentasYTD = ventasMensuales.reduce((sum, m) => sum + m.ventas, 0);
  const totalGuardiasApert = operacionesMensuales.reduce((sum, m) => sum + m.guardiasApert, 0);
  const totalGuardiasCancl = operacionesMensuales.reduce((sum, m) => sum + m.guardiasCancl, 0);
  const ultimoMesServicios = serviciosActivos[serviciosActivos.length - 2]; // Nov
  const primerMesServicios = serviciosActivos[0];
  
  return {
    // Ventas
    ventasYTD: totalVentasYTD,
    ventasMetaYTD: METAS.ventasYTD,
    ventasCumplimiento: ((totalVentasYTD / METAS.ventasYTD) * 100).toFixed(1),
    ventasPromMensual: Math.round(totalVentasYTD / CONFIG.MESES_VENTAS),
    ventasMejorMes: ventasMensuales.reduce((max, m) => m.ventas > max.ventas ? m : max),
    ventasPeorMes: ventasMensuales.reduce((min, m) => m.ventas < min.ventas ? m : min),
    mesesSobreMetaVentas: ventasMensuales.filter(m => m.sobreMeta).length,
    
    // Operaciones
    guardiasApertYTD: totalGuardiasApert,
    guardiasCancelYTD: totalGuardiasCancl,
    guardiasNetoYTD: totalGuardiasApert - totalGuardiasCancl,
    guardiasMetaYTD: METAS.guardiasYTD,
    guardiasCumplimiento: ((totalGuardiasApert / METAS.guardiasYTD) * 100).toFixed(1),
    tasaRetencion: (((totalGuardiasApert - totalGuardiasCancl + 900) / 900) * 100).toFixed(1),
    costoOportunidadTotal: totalGuardiasCancl * CONFIG.COSTO_PROMEDIO_GUARDIA,
    mesesSobreMetaGuardias: operacionesMensuales.filter(m => m.sobreMeta).length,
    mejorMesAperturas: operacionesMensuales.reduce((max, m) => m.guardiasApert > max.guardiasApert ? m : max),
    peorMesCancelaciones: operacionesMensuales.reduce((max, m) => m.guardiasCancl > max.guardiasCancl ? m : max),
    
    // Estado de Fuerza
    serviciosActuales: ultimoMesServicios.servicios,
    guardiasActuales: ultimoMesServicios.guardias,
    crecimientoServicios: (((ultimoMesServicios.servicios - primerMesServicios.servicios) / primerMesServicios.servicios) * 100).toFixed(1),
    promGuardiasPorServicio: (ultimoMesServicios.guardias / ultimoMesServicios.servicios).toFixed(1),
    
    // Comercial
    asesoresSobreMeta: asesores.filter(a => a.sobreMeta).length,
    asesoresBajoMeta: asesores.filter(a => !a.sobreMeta).length,
    concentracionTop2: (parseFloat(asesores[0].participacion) + parseFloat(asesores[1].participacion)).toFixed(1),
    ticketPromedioGeneral: Math.round(totalVentasYTD / ventasMensuales.reduce((sum, m) => sum + m.serviciosVendidos, 0))
  };
};

export const KPIs = calcularKPIs();
