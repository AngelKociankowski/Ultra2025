export const formatCurrency = (value) => {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
};

export const formatNumber = (value) => {
  return new Intl.NumberFormat('es-MX').format(value);
};

export const formatPercent = (value) => {
  return `${value}%`;
};

/*
 * Aquí vivían cinco ayudantes de semáforo —getStatusColor, getStatusBg,
 * getStatusIcon, getTrendIcon y getTrendColor— que no usaba ni una pantalla.
 * Se fueron con la revisión de interfaz: el de icono devolvía «✅», «⚠️» y
 * «🚨» según un porcentaje, que es justo la clase de señal que esta plataforma
 * no da —un porcentaje no sabe si algo está bien, eso depende del servicio— y
 * los tres emoji los dibujaba cada sistema operativo a su manera.
 *
 * Los colores de estado se deciden hoy en el sitio donde se usan, que es donde
 * se sabe qué significa cada uno: ámbar es «falta capturarlo», rojo es «esto ya
 * es un adeudo», verde es «cuadra».
 */

/**
 * Hoy, en la zona horaria de quien está capturando.
 *
 * Se usa para las fechas que trae puestas un formulario. `toISOString()` habría
 * sido lo cómodo, pero devuelve UTC: a partir de las seis de la tarde en México
 * proponía la fecha de mañana, y una factura registrada al cierre del día salía
 * fechada al día siguiente. `en-CA` da el formato AAAA-MM-DD que la base espera.
 */
export const hoyLocal = () => new Date().toLocaleDateString('en-CA');
