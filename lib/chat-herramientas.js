/**
 * Las siete herramientas del asistente: su permiso, su esquema y su ejecución.
 *
 * La decisión que gobierna este archivo, y que es contrato del director: cada
 * quien le puede preguntar al asistente exactamente lo que ya puede ver
 * navegando. Cada herramienta declara DE QUÉ PANTALLA ES ESPEJO y hereda el
 * permiso de esa pantalla. No hay una tercera tabla de permisos que mantener, y
 * no se inventa ninguna lista de «qué campo ve cada rol»: esa lista no existe en
 * esta plataforma —los permisos de aquí gobiernan quién escribe y a qué pantalla
 * se entra, no qué valores se ven dentro de una pantalla abierta— y una lista
 * inventada queda más cerrada que las pantallas en unos sitios y más abierta en
 * otros, sin que nadie la actualice cuando una pantalla cambie.
 *
 * El permiso se comprueba DOS veces, y la segunda es la que vale:
 *
 *   1. Al armar la petición, `definicionesPara(rol)` solo ofrece las
 *      herramientas cuyo permiso tiene ese rol. Esto es cortesía: que no pida lo
 *      que no puede.
 *   2. Al ejecutar, `ejecutar()` vuelve a comprobar el permiso contra la sesión
 *      antes de leer nada. Esta es la cerradura, y hace falta porque el nombre
 *      de la herramienta llega en la respuesta del servicio externo: tratar ese
 *      nombre como autorización sería confiar en que nadie se equivoque nunca.
 *
 * Ninguna de las siete escribe nada. No hay herramienta que capture, corrija,
 * facture, comente ni marque leído, y no hay ninguna que reciba SQL, nombres de
 * tabla ni nombres de columna: reciben lo que recibe un filtro de pantalla —una
 * zona, un periodo, un texto a buscar— y devuelven lo que esa pantalla pinta.
 * Un asistente que pudiera redactar una consulta habría que auditarlo consulta
 * por consulta para siempre; uno que solo puede llamar a siete funciones
 * conocidas se audita una vez, leyendo siete funciones.
 *
 * La agenda de precios no entra en esta vuelta. El precio de un servicio
 * concreto ya sale en `ficha_de_servicio`, que es lo que la gente pregunta, y la
 * agenda completa son 217 renglones que no caben en una respuesta de chat. Queda
 * anotado como lo primero a sumar si alguien lo pide.
 */

import { puede, PERMISOS } from './rbac';
import { marcaDeLaOficina, mesActual } from './fechas';
import {
  kpisEstadoFuerza,
  distribucionPorTurno,
  distribucionPorZona,
  distribucionPorModalidad,
  movimientosPorPeriodo,
  motivosCancelacion,
  contratosPorVencer,
  periodoVigente,
} from './queries';
import { listarServicios, obtenerServicio } from './servicios';
import { resumenDe, kpisCobranza, facturasVencidas, pendientesDeFacturar } from './facturacion';
import { historialDe } from './precios';
import { movimientosDe, netoDelPeriodo, pendientesPorAntiguedad } from './movimientos';
import { estadoAlDia, movimientosDelDia, comoDia } from './dias';
import { kpisJuridico, carteraJuridica } from './juridico';

/** El modelo pidió una herramienta que su rol no tiene, o que no existe. */
export class FueraDeAlcance extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'FueraDeAlcance';
  }
}

/** A cuántos caracteres se recorta un texto que lo teclea el equipo. */
export const TOPE_TEXTO_LIBRE = 300;

/** Cuántos renglones devuelve como máximo una herramienta que lista. */
const TOPE_RENGLONES = 25;

/**
 * Los nombres de servicio, las observaciones y los comentarios los teclea el
 * equipo: son DATOS, no instrucciones.
 *
 * Tres saneamientos, y conviene saber qué protege cada uno y qué no:
 *
 *   · Se recorta a 300 caracteres. Un campo de dos mil caracteres puede traer un
 *     bloque entero de texto con forma de reglas.
 *   · Los saltos de línea y tabuladores se colapsan a un espacio, para que un
 *     campo no pueda parecer un turno de conversación ni un bloque de sistema.
 *   · Nunca se construye un enlace con texto de la base: los enlaces los arma
 *     este archivo con el id.
 *
 * Nada de esto impide que el modelo obedezca una orden escrita dentro de un
 * dato, y no se pretende. Lo que de verdad protege es que obedecer no sirva de
 * nada: no hay herramienta que escriba y no hay herramienta fuera del rol de
 * quien pregunta, así que el peor caso de un modelo perfectamente obediente es
 * que le diga una tontería a la persona que preguntó. Los tres saneamientos son
 * higiene; la frontera es la de arriba.
 */
export function saneado(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  // Cualquier racha de espacio en blanco —saltos de línea, tabuladores y los
  // separadores de línea raros de Unicode— se vuelve UN espacio. Se persigue la
  // clase entera y no una lista de caracteres: una lista es donde se esconde el
  // que falta, y aquí lo que importa es que el campo quede en un solo renglón.
  const plano = String(valor).replace(/\s+/g, ' ').trim();
  if (plano.length <= TOPE_TEXTO_LIBRE) return plano;
  return `${plano.slice(0, TOPE_TEXTO_LIBRE)}…`;
}

/** Un objeto con solo las llaves pedidas, con los textos ya saneados. */
function recorte(fila, llaves) {
  const out = {};
  for (const llave of llaves) out[llave] = saneado(fila?.[llave]);
  return out;
}

/** La ficha de un resultado: el hecho que el servidor pone debajo del texto. */
function ficha(pantalla, enlace, dato, valor) {
  return { pantalla, dato, valor: String(valor), enlace, consultado: marcaDeLaOficina() };
}

/** Un periodo AAAA-MM, o el vigente si no vino o no se entiende. */
function periodoPedido(crudo) {
  const texto = String(crudo || '').trim();
  if (/^\d{4}-\d{2}$/.test(texto)) return texto;
  // Sin periodo válido se contesta el vigente, no un error: «¿cuántas altas
  // hubo?» sin mes es la pregunta normal, y el vigente es la respuesta normal.
  return periodoVigente() || mesActual();
}

/**
 * Las siete, en orden fijo.
 *
 * El orden es fijo porque las definiciones van antes del punto de caché: una
 * lista que cambia de orden entre peticiones del mismo rol tira la caché del
 * prefijo sin que nada avise, y la señal sería una factura más alta sin causa
 * visible.
 */
export const HERRAMIENTAS = [
  {
    nombre: 'resumen_operacion',
    permiso: 'ver',
    pantalla: 'Tablero',
    enlace: '/',
    descripcion:
      'Cuántos servicios activos y cuántos guardias hay ahora mismo, y cómo se reparten por turno, ' +
      'por zona y por modalidad. Úsala para cualquier pregunta de totales de la operación. ' +
      'NO sirve para cobranza ni para un servicio concreto.',
    esquema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    ejecutar() {
      const kpis = kpisEstadoFuerza();
      const turnos = distribucionPorTurno();
      const zonas = distribucionPorZona();
      const modalidad = distribucionPorModalidad();
      return {
        datos: {
          serviciosActivos: kpis.servicios,
          guardias: kpis.guardias,
          promedioGuardiasPorServicio: kpis.promGuardias,
          serviciosDadosDeBaja: kpis.bajas,
          sinContrato: kpis.sinContrato,
          sinFacturar: kpis.sinFacturar,
          // Del reparto por turno se toma lo que la pantalla enseña, y también
          // cuántos guardias NO lo tienen capturado: sin ese segundo número el
          // reparto parece completo y es el 3% de la operación.
          porTurno: {
            turnos: turnos.turnos,
            guardiasRepartidos: turnos.total,
            serviciosSinDesglose: turnos.sinDesglose,
            guardiasSinDesglose: turnos.guardiasSinDesglose,
          },
          porZona: zonas.slice(0, TOPE_RENGLONES).map((z) => recorte(z, ['zona', 'servicios', 'guardias'])),
          porModalidad: modalidad.filas.map((m) => recorte(m, ['modalidad', 'servicios', 'guardias'])),
        },
        // El valor de la ficha sale de la consulta, no se escribe a mano aquí:
        // es la lección de las 15 aperturas, y vale igual para un chat.
        ficha: ficha('Tablero', '/', 'Servicios activos · guardias', `${kpis.servicios} · ${kpis.guardias}`),
      };
    },
  },

  {
    nombre: 'buscar_servicio',
    permiso: 'ver',
    pantalla: 'Estado de fuerza',
    enlace: '/estado-fuerza',
    descripcion:
      'Busca servicios por nombre o razón social, igual que la caja de buscar de Estado de fuerza. ' +
      'Devuelve el renglón de cada uno y su id. Úsala antes de «ficha_de_servicio» cuando quien ' +
      'pregunta nombra un cliente y no sabes su id.',
    esquema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Parte del nombre del servicio o de la razón social.' },
        zona: { type: 'string', description: 'Zona exacta, si la pregunta la nombra. Opcional.' },
      },
      required: ['texto'],
      additionalProperties: false,
    },
    ejecutar({ texto, zona }) {
      const filas = listarServicios({ estatus: 'ACTIVO', q: texto || '', zona: zona || '' });
      return {
        datos: {
          encontrados: filas.length,
          servicios: filas.slice(0, TOPE_RENGLONES).map((s) => ({
            ...recorte(s, ['id', 'servicio', 'razon_social', 'zona', 'asesor', 'total_guardias', 'modalidad']),
            // El enlace lo arma el servidor con el id. Nunca con texto de la base.
            enlace: `/estado-fuerza/${s.id}`,
          })),
          recortada: filas.length > TOPE_RENGLONES,
        },
        ficha: ficha(
          'Estado de fuerza',
          '/estado-fuerza',
          `Servicios que casan con «${saneado(texto)}»`,
          filas.length
        ),
      };
    },
  },

  {
    nombre: 'ficha_de_servicio',
    permiso: 'ver',
    pantalla: 'Ficha del servicio',
    enlace: '/estado-fuerza',
    descripcion:
      'Un servicio a fondo, como lo pinta su ficha: plantilla, turnos, zona, asesor, contrato, ' +
      'importe de factura, precio por guardia, su cobranza y su historia de precios. ' +
      'Necesita el id, que lo da «buscar_servicio».',
    esquema: {
      type: 'object',
      properties: { id: { type: 'integer', description: 'El id del servicio, de «buscar_servicio».' } },
      required: ['id'],
      additionalProperties: false,
    },
    ejecutar({ id }) {
      const s = obtenerServicio(Number(id));
      if (!s) {
        return {
          datos: { encontrado: false, nota: 'No hay un servicio con ese id.' },
          ficha: ficha('Estado de fuerza', '/estado-fuerza', 'Servicio con id pedido', 'no existe'),
        };
      }
      const cobranza = resumenDe(s.id);
      const precios = historialDe(s.id);
      return {
        datos: {
          encontrado: true,
          ...recorte(s, [
            'id',
            'servicio',
            'razon_social',
            'estatus',
            'zona',
            'asesor',
            'supervisor',
            'gerente',
            'direccion',
            'total_guardias',
            'modalidad',
            'fecha_alta',
            'fecha_fin_prevista',
            'tiene_contrato',
            'fecha_vencimiento_contrato',
            'importe_factura',
            'precio_guardia',
            'esquema_facturacion',
            'dias_credito',
            'observaciones',
            'comentarios_contrato',
            'condiciones_comerciales',
            'status_cobranza',
          ]),
          turnos: s.turnos,
          cobranzaDelServicio: cobranza,
          historiaDePrecios: precios
            .slice(0, TOPE_RENGLONES)
            .map((h) =>
              recorte(h, [
                'tipo',
                'porcentaje',
                'vigente_desde',
                'importe_anterior',
                'importe_nuevo',
                'precio_anterior',
                'precio_nuevo',
                'motivo',
              ])
            ),
          enlace: `/estado-fuerza/${s.id}`,
        },
        ficha: ficha(
          'Ficha del servicio',
          `/estado-fuerza/${s.id}`,
          `${saneado(s.servicio)} · guardias`,
          s.total_guardias
        ),
      };
    },
  },

  {
    nombre: 'movimientos',
    permiso: 'ver',
    pantalla: 'Aperturas y Cancelaciones',
    enlace: '/aperturas',
    descripcion:
      'Las altas y las bajas de un mes: cuántos movimientos, cuántos guardias entraron y salieron, ' +
      'los motivos de las cancelaciones y cuántas aperturas quedan sin aplicar. ' +
      'Úsala para «qué entró» y «qué se fue».',
    esquema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: 'El mes, como AAAA-MM. Si se omite, el mes vigente.' },
      },
      required: [],
      additionalProperties: false,
    },
    ejecutar({ periodo }) {
      const mes = periodoPedido(periodo);
      // El neto sale de `netoDelPeriodo`, que cuenta TODO el mes; las listas
      // salen de `movimientosDe`, que es la consulta de la pantalla y trae un
      // tope de renglones. Son dos preguntas distintas y el conteo bueno es el
      // primero: contar los renglones de una lista topada daría de menos sin
      // avisar, que es exactamente el error que este proyecto lleva cerrando.
      const neto = netoDelPeriodo(mes);
      const altas = movimientosDe('aperturas', mes).movimientos;
      const bajas = movimientosDe('cancelaciones', mes).movimientos;
      // Las pendientes se cuentan con su propia consulta y NO contando los
      // renglones de una lista: `movimientosDe` topa en 400 y un conteo sobre
      // una lista topada da de menos sin que nada avise. Esta además parte el
      // aviso en recientes y arrastre, que es como lo enseña la pantalla.
      const sinAplicar = pendientesPorAntiguedad();
      return {
        datos: {
          periodo: mes,
          altas: { movimientos: neto.alta.movimientos, guardias: neto.alta.guardias },
          bajas: { movimientos: neto.baja.movimientos, guardias: neto.baja.guardias },
          netoDeGuardias: neto.neto,
          aperturasSinAplicar: sinAplicar,
          porPeriodo: movimientosPorPeriodo(12),
          motivosDeBaja: motivosCancelacion(10),
          ultimasAltas: altas
            .slice(0, TOPE_RENGLONES)
            .map((a) => recorte(a, ['folio', 'servicio', 'zona', 'guardias', 'fecha', 'tipo'])),
          ultimasBajas: bajas
            .slice(0, TOPE_RENGLONES)
            .map((c) => recorte(c, ['folio', 'servicio', 'zona', 'guardias', 'fecha', 'motivo'])),
        },
        ficha: ficha(
          'Aperturas y Cancelaciones',
          '/aperturas',
          `Guardias que entraron y salieron en ${mes}`,
          `+${neto.alta.guardias} / −${neto.baja.guardias}`
        ),
      };
    },
  },

  {
    nombre: 'estado_de_un_dia',
    permiso: 'ver',
    pantalla: 'Estado de fuerza al día',
    enlace: '/estado-fuerza',
    descripcion:
      'Cómo amaneció la operación una fecha concreta: cuántos servicios y guardias había, y qué ' +
      'entró y salió ese día. Dice también hasta dónde llega la reconstrucción: si la fecha queda ' +
      'fuera de alcance, el total sale corto y hay que decirlo.',
    esquema: {
      type: 'object',
      properties: { dia: { type: 'string', description: 'La fecha, como AAAA-MM-DD.' } },
      required: ['dia'],
      additionalProperties: false,
    },
    ejecutar({ dia }) {
      const fecha = comoDia(dia);
      if (!fecha) {
        return {
          datos: { entendido: false, nota: 'La fecha no se entiende. Va como AAAA-MM-DD.' },
          ficha: ficha('Estado de fuerza al día', '/estado-fuerza', 'Fecha pedida', 'no se entiende'),
        };
      }
      const { servicios, exactitud, fueraDeAlcance, limite } = estadoAlDia(fecha);
      const guardias = servicios.reduce((a, s) => a + (s.total_guardias || 0), 0);
      return {
        datos: {
          entendido: true,
          dia: fecha,
          servicios: servicios.length,
          guardias,
          // Va siempre, con o sin problema: quien pregunte por una fecha vieja
          // tiene el mismo derecho a saber que el número se queda corto.
          fueraDeAlcance,
          hastaDondeEsDeFiar: limite,
          exactitud,
          entraronEseDia: movimientosDelDia(fecha)
            .entraron.slice(0, TOPE_RENGLONES)
            .map((m) => recorte(m, ['folio', 'tipo', 'servicio', 'zona', 'guardias'])),
          salieronEseDia: movimientosDelDia(fecha)
            .salieron.slice(0, TOPE_RENGLONES)
            .map((m) => recorte(m, ['folio', 'tipo', 'servicio', 'zona', 'guardias', 'motivo'])),
        },
        ficha: ficha(
          'Estado de fuerza al día',
          `/estado-fuerza?dia=${fecha}`,
          `Guardias el ${fecha}`,
          guardias
        ),
      };
    },
  },

  {
    nombre: 'contratos',
    permiso: 'ver',
    pantalla: 'Jurídico',
    enlace: '/juridico',
    descripcion:
      'El estado de los contratos: cuántos servicios están sin contrato, vencidos, por vencer y ' +
      'vigentes, con sus guardias y su monto, y la lista de los que hay que atender. ' +
      'Esta pantalla la ve todo el mundo.',
    esquema: {
      type: 'object',
      properties: {
        estado: {
          type: 'string',
          description: 'Un estado concreto para filtrar la lista, si la pregunta lo pide. Opcional.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    ejecutar({ estado }) {
      const kpis = kpisJuridico();
      const cartera = carteraJuridica({ estado: estado || '' });
      const filas = cartera.filas;
      const agenda = contratosPorVencer(90);
      const renglon = (s) =>
        recorte(s, ['id', 'servicio', 'zona', 'fecha_vencimiento_contrato', 'total_guardias']);
      return {
        datos: {
          porEstado: kpis.por,
          total: kpis.total,
          hayQueAtender: kpis.urgente,
          expedienteDigital: kpis.expediente,
          yaVencidos: agenda.vencidos.slice(0, TOPE_RENGLONES).map(renglon),
          vencenEn90Dias: agenda.porVencer.slice(0, TOPE_RENGLONES).map(renglon),
          subtotalDeLaLista: cartera.subtotal,
          lista: filas
            .slice(0, TOPE_RENGLONES)
            .map((s) => ({
              ...recorte(s, ['id', 'servicio', 'razon_social', 'zona', 'total_guardias']),
              estado: saneado(s.contrato?.clave),
              enlace: `/estado-fuerza/${s.id}`,
            })),
        },
        ficha: ficha(
          'Jurídico',
          '/juridico',
          'Servicios sin contrato o vencido',
          kpis.urgente.servicios
        ),
      };
    },
  },

  {
    /**
     * La única de las siete que NO es de todos.
     *
     * Hereda `editar_finanzas` porque ese es el permiso con el que se entra a la
     * pantalla de Cobranza, y nada más. A espectador, jurídico, operaciones y
     * ventas no se les ofrece, y si el servicio externo la pide de todas formas
     * `ejecutar()` la rechaza antes de leer una sola fila.
     */
    nombre: 'cobranza',
    permiso: 'editar_finanzas',
    pantalla: 'Cobranza',
    enlace: '/cobranza',
    descripcion:
      'La cobranza de toda la cartera: cartera vencida, por vencer, qué falta por facturar del mes y ' +
      'las facturas vencidas. Es la pantalla de Cobranza y solo la ven el administrador y finanzas.',
    esquema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: 'El mes a conciliar, como AAAA-MM. Si se omite, el vigente.' },
      },
      required: [],
      additionalProperties: false,
    },
    ejecutar({ periodo }) {
      const mes = periodoPedido(periodo);
      const kpis = kpisCobranza();
      const vencidas = facturasVencidas(TOPE_RENGLONES);
      const pendientes = pendientesDeFacturar(mes);
      return {
        datos: {
          periodo: mes,
          emitido: kpis.emitido,
          cobrado: kpis.cobrado,
          carteraVencida: kpis.vencido,
          porVencer: kpis.porVencer,
          pendienteTotal: kpis.pendiente,
          facturasVencidas: kpis.facturasVencidas,
          serviciosConAdeudo: kpis.serviciosConAdeudo,
          facturasVencidasDetalle: vencidas
            .slice(0, TOPE_RENGLONES)
            .map((f) => recorte(f, ['folio', 'servicio', 'periodo', 'importe', 'saldo', 'fecha_vencimiento'])),
          faltaPorFacturar: pendientes.porFacturar
            .slice(0, TOPE_RENGLONES)
            .map((s) => recorte(s, ['id', 'servicio', 'total_guardias', 'importe_factura', 'esquema_facturacion'])),
          sinCondicionesDeCobro: pendientes.sinCondiciones.length,
          yaFacturadosDelPeriodo: pendientes.facturados,
        },
        ficha: ficha('Cobranza', '/cobranza', 'Cartera vencida', kpis.vencido),
      };
    },
  },
];

/**
 * Las herramientas que ese rol puede usar, en el mismo orden fijo.
 *
 * Se deriva de `puede()`, que es el permiso de verdad de la plataforma. No hay
 * una lista de roles escrita aquí: el día que un rol gane o pierda un permiso en
 * `lib/rbac.js`, lo que el asistente le ofrece cambia con él.
 */
export function herramientasPara(rol) {
  return HERRAMIENTAS.filter((h) => puede(rol, h.permiso));
}

/** La forma que pide el servicio externo, con `strict` para que los argumentos lleguen válidos. */
export function definicionesPara(rol) {
  return herramientasPara(rol).map((h) => ({
    name: h.nombre,
    description: `${h.descripcion} Es el espejo de la pantalla «${h.pantalla}» (${h.enlace}).`,
    input_schema: h.esquema,
    strict: true,
  }));
}

/** La declarada con ese nombre, o nada. */
export function herramientaPorNombre(nombre) {
  return HERRAMIENTAS.find((h) => h.nombre === nombre) || null;
}

/**
 * La cerradura: ejecuta una herramienta comprobando otra vez el permiso.
 *
 * El nombre llega en la respuesta del servicio externo, o sea de fuera. Se
 * comprueban tres cosas antes de leer nada, y en este orden:
 *
 *   1. que la herramienta exista;
 *   2. que declare un permiso que de verdad existe en el RBAC —una herramienta
 *      con un permiso mal escrito no se ejecuta «por si acaso»: se rechaza,
 *      porque `puede(rol, 'editar_finanza')` sería falso para todos y el día que
 *      el error fuera al contrario abriría la pantalla a cualquiera;
 *   3. que el rol de la sesión tenga ese permiso.
 *
 * El mensaje del rechazo dice en qué pantalla se ve el dato, porque ese texto
 * acaba delante de la persona y «no tienes permiso» a secas no le dice a quién
 * pedirle.
 */
export function ejecutar(nombre, args, usuario) {
  const herramienta = herramientaPorNombre(nombre);
  if (!herramienta) {
    throw new FueraDeAlcance(`El asistente no tiene ninguna consulta llamada «${saneado(nombre)}».`);
  }
  if (!Object.hasOwn(PERMISOS, usuario?.rol || '')) {
    throw new FueraDeAlcance('La sesión no trae un rol conocido.');
  }
  const existeElPermiso = Object.values(PERMISOS).some((lista) => lista.includes(herramienta.permiso));
  if (!existeElPermiso) {
    throw new FueraDeAlcance(
      `La consulta «${herramienta.nombre}» declara un permiso que no existe en la plataforma.`
    );
  }
  if (!puede(usuario.rol, herramienta.permiso)) {
    throw new FueraDeAlcance(
      `Tu rol no entra a la pantalla «${herramienta.pantalla}», así que el asistente tampoco te puede ` +
        'contestar de ahí. Ese dato lo tienen el administrador y finanzas.'
    );
  }
  return herramienta.ejecutar(args || {}, usuario);
}

/**
 * Cómo viaja un resultado hacia el servicio externo.
 *
 * Va etiquetado con su fuente y su hora, y como JSON: así un campo de texto no
 * puede parecer un turno de conversación. Es parte del contrato y no estilo.
 */
export function serializar({ datos, ficha: f }) {
  return JSON.stringify({ fuente: f.pantalla, consultado: f.consultado, datos });
}
