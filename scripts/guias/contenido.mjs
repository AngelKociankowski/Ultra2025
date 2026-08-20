/**
 * El contenido de las guías, un archivo por rol.
 *
 * Están escritas para alguien que no usa computadora todo el día. Eso cambia
 * cómo se escribe, no solo cuánto:
 *
 *   · Se dice el nombre exacto del botón, entre comillas, tal como aparece en
 *     la pantalla. «Registrar apertura» y no «guardar el formulario».
 *   · Cada tarea va en pasos numerados y cada paso es una sola acción.
 *   · No hay vocabulario de sistemas. Ni «módulo», ni «registro», ni «campo
 *     obligatorio»: se dice «pantalla», «renglón» y «esto hay que llenarlo».
 *   · Lo que la plataforma NO deja hacer se explica con su razón, porque un
 *     «no se puede» sin motivo se lee como una falla y alguien va a llamar
 *     para reportarlo.
 *
 * Los permisos de cada rol no están inventados aquí: salen de `lib/rbac.js`, y
 * se verificaron contra las rutas de la API antes de escribir cada guía.
 */

export const MARCA = {
  empresa: 'Ultra Seguridad Privada',
  sistema: 'Plataforma de Guardias',
  sitio: 'estado-de-fuerza.corporativoultra.com',
};

/** Lo que vale para todos, y por eso no se repite en cada guía. */
const COMUNES = {
  entrar: {
    titulo: 'Lo primero: entrar',
    pasos: [
      'Abre el navegador y escribe <b>estado-de-fuerza.corporativoultra.com</b>',
      'Escribe tu correo de la empresa y la contraseña que te dieron.',
      'La primera vez te va a pedir que cambies la contraseña. Ponle una que solo tú sepas, de al menos 8 letras o números.',
      'Listo. De ahí en adelante, entras con esa.',
    ],
    nota: 'Si se te olvida la contraseña, no la puedes recuperar tú: pídele al administrador que te la reinicie. Es a propósito — así nadie puede entrar a tu cuenta pidiendo un cambio por correo.',
  },
  verUnDia: {
    titulo: 'Ver cómo estaba un día',
    intro: 'Sirve para contestar «¿con cuántos elementos amanecimos el 5?» sin tener que acordarse.',
    pasos: [
      'Entra a <b>Estado de fuerza</b>.',
      'En la barra de filtros, junto al mes, hay una casilla que dice <b>o al día</b>. Escoge la fecha.',
      'La tabla se rehace como estaba esa mañana, y arriba te dice qué entró y qué salió ese día.',
      'Para volver al día de hoy, da clic en el tache que sale al lado de la fecha.',
    ],
    nota: 'Debajo de la fecha hay una fila de <b>«Días con movimiento»</b>: son los días en que de verdad entró o salió gente ese mes. Da clic en uno para saltar directo, en vez de ir probando fechas.',
    aviso:
      'Solo alcanza para las fechas recientes, y la pantalla te lo dice en rojo cuando te pasas. Más atrás faltan los servicios que se cancelaron antes de que se cargara el histórico: no están en el sistema, así que el total saldría más bajo de lo que fue. Para una fecha vieja, el bueno es el <b>corte de ese mes</b>, que se escoge en la casilla del mes.',
  },
  moverse: {
    titulo: 'Cómo moverte',
    pasos: [
      'Arriba están las pestañas. Cada una es una pantalla distinta.',
      'Para buscar un servicio, entra a <b>Estado de fuerza</b> y escribe su nombre en la caja de buscar. Sirve el nombre corto o la razón social.',
      'Da clic en el nombre de un servicio para ver su ficha completa: sus guardias, su contrato, sus facturas y sus notas.',
      'El icono de luna o sol, arriba a la derecha, cambia entre pantalla clara y oscura. Usa la que te canse menos la vista.',
    ],
  },
};

/** La regla que gobierna todo y que conviene que todos entiendan igual. */
const REGLA_DE_ORO = {
  titulo: 'La regla que no cambia',
  texto:
    'Un servicio entra al estado de fuerza <b>solo</b> por una apertura, y sale <b>solo</b> por una cancelación. Nadie —ni el administrador— puede agregar o quitar un servicio a mano.',
  porque:
    'Suena estricto y lo es a propósito. Así, el número de guardias que ves en pantalla siempre se puede explicar: cada guardia que entró tiene su folio de apertura y cada uno que salió tiene su folio de cancelación. Si se pudieran mover a mano, el total dejaría de cuadrar con los movimientos y nadie sabría cuál de los dos creer.',
};

export const GUIAS = [
  // ------------------------------------------------------------------ VENTAS
  {
    rol: 'ventas',
    titulo: 'Ventas',
    color: '#2563eb',
    resumen: 'Das de alta los servicios que cierras y registras cuando un cliente reduce o se va.',
    pestanas: ['Tablero', 'Estado de fuerza', 'Aperturas', 'Cancelaciones', 'Jurídico', 'Precios'],
    secciones: [
      COMUNES.entrar,
      COMUNES.moverse,
      COMUNES.verUnDia,
      {
        titulo: 'Tu trabajo principal: dar de alta un servicio nuevo',
        intro: 'Esto es lo que haces cuando cierras con un cliente. Es la única forma de que el servicio exista en el sistema.',
        pasos: [
          'Entra a la pestaña <b>Aperturas</b>.',
          'Da clic en el botón verde <b>«Nueva apertura»</b>, arriba a la derecha.',
          'Arriba salen tres botones: <b>APERTURA</b>, <b>INCREMENTO</b> y <b>TEMPORAL</b>. Deja APERTURA si es un cliente nuevo.',
          'Abajo te pregunta <b>«¿El servicio es fijo o termina?»</b>. Si el cliente lo contrató sin fecha de fin, deja <b>Fijo</b>. Si es por unos meses, escoge <b>Temporal</b> y pon hasta cuándo.',
          'Llena el nombre del servicio y la fecha de apertura. Esos dos son obligatorios.',
          'Llena lo demás con las listas: zona, asesor, gerente, supervisor, estado, si el cliente pide REPSE, uniforme. <b>Son listas, no se escribe</b> — escoges de las opciones.',
          'En <b>Desglose de turnos</b> pon cuántos guardias van en cada horario. El total se suma solo.',
          'En <b>Equipo que se le entrega</b> pon cuántos chalecos, lámparas, radios, etc. Deja en blanco lo que no lleve.',
          'En <b>Comercial</b> pon el precio, el sueldo base y el bono.',
          'En <b>Cómo se cobra</b> pon cuándo se factura y la forma de pago.',
          'Marca las <b>Autorizaciones</b> que ya tengas firmadas.',
          'Da clic en <b>«Registrar apertura»</b>. El servicio ya está en el estado de fuerza.',
        ],
        aviso:
          'Si le pones una <b>fecha futura</b> —porque el montaje es la semana que entra— el servicio queda registrado pero <b>no cuenta todavía</b> en el estado de fuerza. Es a propósito: hasta que llegue ese día no hay nadie parado en esa puerta. Lo ves en el aviso de arriba de la tabla, o escogiendo <b>«Por arrancar»</b> en el filtro de estatus. El día que llegue, entra solo: no hay que activarlo.',
        nota: 'Si el nombre que pusiste ya existe y está activo, el sistema no te va a dejar. Te dirá que uses INCREMENTO si le vas a sumar gente, o que le pongas otro nombre si de verdad es otro servicio (otra torre, otro turno, otro domicilio).',
      },
      {
        titulo: 'Cuando a un cliente que ya tienes le sumas guardias',
        intro: 'Eso NO es una apertura nueva. Es un incremento sobre el servicio que ya existe.',
        pasos: [
          'Entra a <b>Aperturas</b> → <b>«Nueva apertura»</b>.',
          'Arriba, escoge el botón <b>INCREMENTO</b>.',
          'Escoge el servicio de la lista de servicios activos.',
          'Pon cuántos guardias se le suman, en qué turno.',
          'Da clic en <b>«Registrar apertura»</b>.',
        ],
        nota: 'Si abres uno nuevo con el mismo nombre en lugar de incrementar, el cliente aparece dos veces y sus guardias se cuentan doble. Por eso el sistema lo frena.',
      },
      {
        titulo: 'Cuando un cliente se va o baja guardias',
        pasos: [
          'Entra a la pestaña <b>Cancelaciones</b>.',
          'Da clic en <b>«Movimiento de guardias»</b>.',
          'Escoge <b>CANCELACIÓN</b> si el cliente se va completo, o <b>REDUCCIÓN</b> si solo baja algunos guardias.',
          'Escoge el servicio y cuántos guardias salen.',
          'Escribe el <b>motivo</b>. Es obligatorio, y sale en el reporte de por qué se van los clientes.',
          'Da clic en guardar.',
        ],
        aviso:
          'Si el cliente <b>para el servicio pero va a volver</b>, eso no es una cancelación. Pídele a operaciones que lo <b>suspenda</b>: así deja de contar sin que aparezca como un cliente perdido en tus números.',
      },
      {
        titulo: 'Poner el precio por tipo de guardia',
        intro: 'Un jefe de servicio no cuesta lo mismo que un guardia básico. Aquí se captura renglón por renglón.',
        pasos: [
          'Busca el servicio en <b>Estado de fuerza</b> y da clic en su nombre.',
          'Baja hasta <b>Precio por puesto</b>.',
          'Da clic en <b>«Capturar el desglose»</b>.',
          'Agrega un renglón por cada tipo: Guardia básico, Guardia ODS, Guardia bilingüe, Jefe de turno, Jefe de servicio, Monitorista.',
          'Pon cuántos van y cuánto cuesta cada uno. El importe del mes se suma solo.',
          'Da clic en guardar.',
        ],
      },
      {
        titulo: 'Ver si un cliente tiene contrato',
        pasos: [
          'Entra a la pestaña <b>Jurídico</b>.',
          'Arriba ves cuántos servicios están sin contrato y cuántos ya vencieron.',
          'Da clic en cualquiera de esos números para ver la lista.',
          'Puedes buscar tu cliente por nombre en la caja de buscar.',
        ],
        nota: 'Tú puedes ver esta pantalla pero no modificarla. Los contratos los lleva jurídico.',
      },
      REGLA_DE_ORO,
      {
        titulo: 'Lo que no puedes hacer, y a quién pedirle',
        lista: [
          ['Subir el contrato firmado', 'Jurídico'],
          ['Cambiar la razón social', 'Jurídico'],
          ['Facturar o registrar un pago', 'Cobranza'],
          ['Capturar la nómina', 'Operaciones o cobranza'],
          ['Suspender un servicio', 'Operaciones'],
          ['Corregir un dato mal capturado del estado de fuerza', 'El administrador'],
          ['Agregar una zona, un asesor o un supervisor a las listas', 'El administrador'],
        ],
      },
    ],
  },

  // ------------------------------------------------------------- OPERACIONES
  {
    rol: 'operaciones',
    titulo: 'Operaciones',
    color: '#0891b2',
    resumen: 'Mueves el estado de fuerza: das de alta, sumas, reduces, pausas y capturas la nómina.',
    pestanas: ['Tablero', 'Estado de fuerza', 'Aperturas', 'Cancelaciones', 'Jurídico'],
    secciones: [
      COMUNES.entrar,
      COMUNES.moverse,
      COMUNES.verUnDia,
      {
        titulo: 'Dar de alta, sumar o bajar guardias',
        intro: 'Es lo mismo que hace ventas y funciona igual. Lo importante es escoger bien de qué se trata.',
        pasos: [
          'Para un cliente nuevo: <b>Aperturas</b> → <b>«Nueva apertura»</b> → botón <b>APERTURA</b>.',
          'Para sumarle gente a uno que ya existe: el mismo camino, pero botón <b>INCREMENTO</b> y escoges el servicio de la lista.',
          'Para bajarle gente o cerrarlo: <b>Cancelaciones</b> → <b>«Movimiento de guardias»</b> → <b>REDUCCIÓN</b> o <b>CANCELACIÓN</b>.',
          'Siempre escribe el motivo cuando sea una baja.',
        ],
      },
      {
        titulo: 'Cuando un cliente para el servicio pero va a volver',
        intro: 'Esto NO es una cancelación. Para eso está suspender.',
        pasos: [
          'Busca el servicio en <b>Estado de fuerza</b> y da clic en su nombre.',
          'Baja hasta el bloque <b>Pausar el servicio</b>.',
          'Da clic en <b>«Suspender»</b>.',
          'Escribe por qué se pausa.',
          'Cuando el cliente regrese, entra igual y da clic en <b>«Reactivar el servicio»</b>.',
        ],
        aviso:
          'La diferencia importa. Una <b>cancelación</b> dice que el cliente se fue: sale en las bajas del mes y en el reporte de motivos. Una <b>suspensión</b> dice que paró y va a volver: sus guardias dejan de contar, deja de proponerse para facturar, pero conserva su plantilla, su precio y su contrato. Si usas cancelación cuando era una pausa, tus números de bajas mienten.',
      },
      {
        titulo: 'Capturar la nómina',
        intro: 'Es lo que cuesta sostener el servicio. Cambia mes a mes —horas extra, cubres, alguien que entra a media quincena— y por eso lo capturas tú, que lo sabes primero.',
        pasos: [
          'Busca el servicio en <b>Estado de fuerza</b> y da clic en su nombre.',
          'Baja hasta el bloque de edición y busca <b>Nómina</b>.',
          'Escribe la nómina total del mes y, si aplica, las prestaciones.',
          'Da clic en guardar.',
        ],
        nota: 'Mientras la nómina esté vacía, la tabla del estado de fuerza dice «utilidad sin sustento» en ese servicio. No es un error: es que sin costo capturado, el porcentaje de utilidad no significa nada.',
      },
      {
        titulo: 'Aperturas que están anotadas pero no aplicadas',
        intro: 'Son movimientos que se registraron pero a los que nunca se les creó el servicio. Sus guardias no están sumando.',
        pasos: [
          'Entra a <b>Aperturas</b>. Si hay pendientes, arriba sale un aviso en amarillo.',
          'Da clic en <b>«Ver solo las pendientes»</b>.',
          'Revisa si ese servicio de verdad está operando hoy.',
          'Si sí: da clic en <b>«Aplicar»</b>. El servicio entra al estado de fuerza.',
          'Si no —porque es viejo y ya no existe—: da clic en <b>«Descartar»</b> y escribe por qué. No se borra, solo deja de contar como pendiente.',
        ],
        nota: 'Si el botón dice <b>«Corregir»</b> en amarillo, es que esa apertura trae un dato que ya no existe en las listas (por ejemplo una zona que se dejó de usar). Da clic ahí primero y escoge el bueno.',
      },
      {
        titulo: 'Decir si el cliente pide REPSE',
        pasos: [
          'Busca el servicio y abre su ficha.',
          'Busca el bloque <b>REPSE</b> y escoge <b>Sí</b> o <b>No</b>, según si ese cliente nos lo pide.',
          'Da clic en guardar.',
        ],
        nota: 'Déjalo vacío si no lo sabes, no pongas «No» por salir del paso. En la tabla del estado de fuerza hay una columna <b>REPSE</b>: lo que está vacío dice «Dato faltante» en amarillo, y así se ve de un vistazo qué queda por revisar. Un «No» puesto a la ligera se ve igual que uno revisado.',
      },
      {
        titulo: 'Cambiar el supervisor o el gerente a cargo',
        intro: 'Cuando repartes una zona distinto, cuando alguien sale de vacaciones o cuando entra un supervisor nuevo, el cambio lo haces tú.',
        pasos: [
          'Busca el servicio en <b>Estado de fuerza</b> y da clic en su nombre.',
          'Baja al bloque de edición y da clic en la pestaña <b>Supervisión a cargo</b>.',
          'Escoge de la lista el supervisor y, si cambia, el gerente.',
          'Da clic en guardar.',
        ],
        porque:
          'El supervisor que aparece en la ficha es a quien se le llama cuando hay una incidencia en ese servicio. Si sigue el anterior, la llamada va a la persona equivocada en el peor momento.',
        nota: 'Son listas: si el supervisor nuevo todavía no aparece, pídele al administrador que lo dé de alta en Catálogos. Se hace así a propósito, para que la misma persona no acabe escrita de tres maneras distintas.',
      },
      REGLA_DE_ORO,
      {
        titulo: 'Lo que no puedes hacer, y a quién pedirle',
        lista: [
          ['Facturar o registrar un pago', 'Cobranza'],
          ['Cambiar el precio o el importe del servicio', 'Cobranza o el administrador'],
          ['Subir el contrato firmado', 'Jurídico'],
          ['Cambiar la razón social', 'Jurídico'],
          ['Corregir el nombre o el total de guardias mal capturado', 'El administrador'],
          ['Cambiar el asesor comercial del servicio', 'El administrador'],
          ['Agregar una zona, un supervisor o un turno a las listas', 'El administrador'],
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- COBRANZA
  {
    rol: 'finanzas',
    titulo: 'Cobranza y Finanzas',
    color: '#059669',
    resumen: 'Facturas el mes, persigues los pagos y vigilas que lo que se cobra cuadre con lo que está en la calle.',
    pestanas: ['Tablero', 'Estado de fuerza', 'Aperturas', 'Cancelaciones', 'Cobranza', 'Jurídico', 'Precios'],
    secciones: [
      COMUNES.entrar,
      COMUNES.moverse,
      COMUNES.verUnDia,
      {
        titulo: 'Facturar el mes',
        intro: 'Es tu tarea principal, normalmente a principios del mes siguiente.',
        pasos: [
          'Entra a la pestaña <b>Cobranza</b>.',
          'Arriba escoge el mes que vas a facturar.',
          'En la tabla <b>Por facturar</b> están los servicios que todavía no tienen su factura de ese mes.',
          'Da clic en el renglón del servicio. Se abre un formulario chico.',
          'Revisa la <b>fecha</b> (viene propuesta según cómo se le cobra a ese cliente).',
          'Revisa el <b>importe</b> (viene propuesto del precio de su ficha).',
          'Revisa los <b>guardias facturados</b>. Viene propuesta la plantilla que tiene en la calle.',
          'Pon el <b>folio fiscal</b> si ya lo tienes.',
          'Si quieres, adjunta el PDF o el XML de la factura. También lo puedes subir después.',
          'Da clic en <b>«Guardar factura»</b>.',
        ],
        aviso:
          'Fíjate en los <b>guardias facturados</b>. Si pones menos de los que el servicio tiene, el campo se pone amarillo y te dice cuántos quedan sin cobrar. Eso es dinero que se está regalando todos los meses.',
      },
      {
        titulo: 'Revisar que lo facturado cuadre con lo que está en la calle',
        intro:
          'Es la revisión más valiosa de la pantalla, y la única que ningún total hace solo. La suma de tus facturas cuadra consigo misma. La plantilla del estado de fuerza cuadra consigo misma. Las dos pueden estar diciendo cosas distintas sin que nada se queje.',
        pasos: [
          'En <b>Cobranza</b>, baja al bloque <b>«Lo facturado contra lo que está en la calle»</b>.',
          'Arriba ves cuántos servicios cuadran, cuántos guardias quedaron sin cobrar y cuánto dinero representa al mes.',
          'Abajo está la lista de los que no cuadran, del más caro al más barato.',
          'Cada renglón te dice exactamente qué pasa: «Se facturaron 56 guardias y el servicio tiene 60: 4 sin cobrar».',
        ],
        nota:
          'Lo <b>rojo</b> es dinero que se está regalando: nadie te lo va a reclamar, y por eso se puede perder años. Lo <b>amarillo</b> es que se facturó de más: el cliente lo va a rebotar y se descubre solo, pero verlo antes te ahorra la nota de crédito.',
      },
      {
        titulo: 'Registrar un pago',
        pasos: [
          'En <b>Cobranza</b>, baja a la tabla de facturas emitidas del mes.',
          'Busca la factura y da clic en registrar el pago.',
          'Pon la fecha y el importe que entró.',
          'Si el cliente pagó solo una parte, pon lo que pagó. El saldo se recalcula solo.',
        ],
      },
      {
        titulo: 'La cartera vencida',
        intro: 'Es lo que ya se pasó del plazo de crédito. Lo demás, aunque no esté pagado, todavía está en tiempo.',
        pasos: [
          'En <b>Cobranza</b>, baja hasta <b>Cartera vencida</b>.',
          'Está ordenada de lo más atrasado a lo más reciente.',
          'Cada renglón trae el servicio, su razón social —que es el nombre con el que factura—, el asesor y cuántos días lleva vencido.',
        ],
        nota: 'Arriba de todo distingue <b>«Por vencer»</b> de <b>«Vencido»</b>. Solo lo vencido es adeudo; lo otro todavía corre dentro del plazo que se le dio al cliente.',
      },
      {
        titulo: 'La revisión anual de precios',
        pasos: [
          'Entra a <b>Administrar</b> → <b>Precios</b>.',
          'Ahí ves qué servicios les toca aumento este mes y a cuáles ya se les pasó.',
          'Escoge los servicios que vas a subir.',
          'Escoge el tipo de aumento: por porcentaje, por monto fijo, o poniendo el precio nuevo.',
          'Pon desde cuándo aplica y escribe el motivo.',
          'Revisa la vista previa: te dice el precio de antes y el de después, servicio por servicio.',
          'Da clic en aplicar.',
        ],
      },
      REGLA_DE_ORO,
      {
        titulo: 'Lo que no puedes hacer, y a quién pedirle',
        lista: [
          ['Dar de alta o dar de baja un servicio', 'Ventas u operaciones'],
          ['Subir el contrato firmado', 'Jurídico'],
          ['Cambiar la razón social', 'Jurídico'],
          ['Cambiar el supervisor o el gerente a cargo', 'Operaciones'],
          ['Cambiar la zona o el asesor', 'El administrador'],
          ['Corregir el nombre o el total de guardias', 'El administrador'],
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- JURÍDICO
  {
    rol: 'juridico',
    titulo: 'Jurídico',
    color: '#d97706',
    resumen: 'Vigilas con qué papel opera cada servicio: contratos, vigencias y el nombre legal de cada cliente.',
    pestanas: ['Tablero', 'Estado de fuerza', 'Aperturas', 'Cancelaciones', 'Jurídico', 'Bitácora'],
    secciones: [
      COMUNES.entrar,
      COMUNES.moverse,
      COMUNES.verUnDia,
      {
        titulo: 'Tu pantalla: la pestaña Jurídico',
        intro: 'Todo lo tuyo está ahí. Arriba, cinco números que resumen la situación de los contratos.',
        pasos: [
          'Entra a la pestaña <b>Jurídico</b>.',
          '<b>Sin contrato</b>: servicios operando sin papel firmado. Da clic para ver la lista.',
          '<b>Contrato vencido</b>: ya se pasó la vigencia y el servicio sigue trabajando.',
          '<b>Vence en 90 días</b>: es el momento de moverlo, todavía hay tiempo.',
          '<b>Sin vigencia capturada</b>: dice que tiene contrato pero nadie puso hasta cuándo vale.',
          '<b>Vigente</b>: firmado y en plazo.',
        ],
        nota:
          'Cada número trae también cuántos guardias y cuánto dinero al mes representa. No es adorno: dice de qué tamaño es el problema. «58 contratos vencidos» no mueve a nadie; «58 vencidos, 331 guardias, 7.1 millones al mes» sí.',
      },
      {
        titulo: 'La agenda de renovaciones',
        intro: 'Una gráfica por mes con los contratos que van a vencer.',
        pasos: [
          'Está en la misma pantalla, debajo de los números.',
          'Cada barra es un mes y dice cuántos contratos vencen.',
          'Pasa el ratón sobre una barra para ver los guardias y el dinero de ese mes.',
        ],
        nota: 'Saber con meses de anticipación es la diferencia entre renovar a tiempo y enterarte cuando el contrato ya venció.',
      },
      {
        titulo: 'Actualizar un contrato',
        intro: 'Lo puedes hacer sin salir de la lista. No hace falta abrir cada servicio.',
        pasos: [
          'En la pestaña <b>Jurídico</b>, baja a <b>Cartera de contratos</b>.',
          'Da clic en el renglón del servicio. Se abre debajo.',
          'Marca o desmarca <b>«Cuenta con contrato»</b>.',
          'Pon la <b>fecha de firma</b> y la de <b>vencimiento</b>.',
          'Pon las <b>condiciones comerciales</b> (por ejemplo: «A los 20 días de cada mes»).',
          'En <b>Notas de jurídico</b> escribe en qué va la renovación, qué falta, con quién se está negociando.',
          'Da clic en <b>«Guardar»</b>.',
        ],
      },
      {
        titulo: 'Subir el PDF del contrato',
        intro: 'Hoy hay cero contratos cargados. Un contrato que nadie encuentra es, en la práctica, un contrato que no está.',
        pasos: [
          'En el mismo renglón que abriste, da clic en <b>«Subir el PDF del contrato»</b>.',
          'Escoge el archivo. Solo acepta PDF.',
          'Una vez subido, cualquiera puede abrirlo desde el estado de fuerza dando clic en «Con contrato».',
        ],
      },
      {
        titulo: 'Corregir la razón social',
        intro:
          'Es el nombre legal del cliente: el que va en el contrato y en la factura, no el corto con el que lo nombra operaciones. De 217 servicios, 193 lo tienen distinto. Solo tú y el administrador la pueden cambiar.',
        pasos: [
          'Busca el servicio en <b>Estado de fuerza</b> y da clic en su nombre.',
          'Baja hasta <b>Corregir captura</b> y da clic en <b>«Corregir»</b>.',
          'Te va a salir solo el campo de <b>Razón social</b>. Es lo único que tu rol corrige.',
          'Escribe el nombre legal correcto.',
          'Escribe el <b>motivo</b>: por qué estaba mal. Es obligatorio.',
          'Da clic en <b>«Guardar corrección»</b>.',
        ],
        nota: 'Queda registrado quién lo cambió, cuándo y por qué. Lo puedes revisar en la pestaña Bitácora.',
      },
      {
        titulo: 'Las capturas que se contradicen',
        intro: 'En la pestaña Jurídico hay un bloque amarillo con los renglones donde el dato dice dos cosas a la vez.',
        pasos: [
          '<b>«Dicen sin contrato pero traen fechas»</b>: o el contrato existe y falta marcarlo, o las fechas son de uno que ya venció.',
          '<b>«Dicen con contrato y no hay nada»</b>: sin fecha de firma, sin vigencia y sin PDF.',
          'Da clic en cualquiera para abrir ese servicio y arreglarlo.',
        ],
        nota:
          'La plataforma no los corrigió sola a propósito. Cuál de las dos versiones es la buena lo sabes tú, no el sistema. «Arreglarlos» automáticamente habría sido inventar un dato.',
      },
      REGLA_DE_ORO,
      {
        titulo: 'Lo que no puedes hacer, y a quién pedirle',
        lista: [
          ['Dar de alta o dar de baja un servicio', 'Ventas u operaciones'],
          ['Cambiar el número de guardias', 'Operaciones (con un movimiento) o el administrador (si fue error de captura)'],
          ['Facturar o registrar un pago', 'Cobranza'],
          ['Cambiar la zona, el asesor o el precio', 'El administrador'],
        ],
      },
    ],
  },

  // ----------------------------------------------------------- ADMINISTRADOR
  {
    rol: 'admin',
    titulo: 'Administrador',
    color: '#7c3aed',
    resumen: 'Puedes hacer todo lo de los demás, y además llevas las cuentas, las listas y los respaldos.',
    pestanas: ['Tablero', 'Estado de fuerza', 'Aperturas', 'Cancelaciones', 'Cobranza', 'Jurídico', 'Precios', 'Bitácora', 'Catálogos', 'Usuarios', 'Respaldos'],
    secciones: [
      COMUNES.entrar,
      COMUNES.moverse,
      COMUNES.verUnDia,
      {
        titulo: 'Dar de alta a alguien del equipo',
        pasos: [
          'Entra a <b>Administrar</b> → <b>Usuarios</b>.',
          'Da clic en agregar usuario.',
          'Pon su correo de la empresa y su nombre.',
          'Escoge su rol. Piénsalo bien: el rol decide qué puede ver y tocar.',
          'Dale la contraseña temporal que sale. La persona la cambia la primera vez que entra.',
        ],
        lista: [
          ['Administrador', 'Todo'],
          ['Jurídico', 'Contratos, razón social, consulta todo'],
          ['Finanzas', 'Cobranza, precios, nómina, consulta todo'],
          ['Operaciones', 'Aperturas, cancelaciones, suspender, nómina, REPSE, supervisor y gerente'],
          ['Ventas', 'Aperturas, cancelaciones, precios, REPSE'],
          ['Espectador', 'Solo mira. No puede ni escribir una nota'],
        ],
      },
      {
        titulo: 'Las listas de captura (Catálogos)',
        intro: 'Zonas, asesores, gerentes, supervisores, turnos, puestos, estados, REPSE, uniformes y formas de pago. Lo que no está en la lista no se puede capturar.',
        pasos: [
          'Entra a <b>Administrar</b> → <b>Catálogos</b>.',
          'Arriba escoge de qué lista se trata.',
          'Para agregar una opción, escríbela y da clic en <b>«Agregar»</b>.',
          '<b>Renombrar</b> corrige también hacia atrás: cambia el valor en los servicios que lo traen.',
          '<b>Desactivar</b> deja de ofrecerla en capturas nuevas sin tocarle el dato a nadie. Es lo que corresponde cuando un asesor se va.',
          '<b>Borrar</b> solo funciona si ningún servicio la usa.',
        ],
      },
      {
        titulo: 'Unir dos opciones que son la misma',
        intro:
          'Pasa cuando el mismo nombre se escribió de dos maneras. En los datos que se cargaron hay seis supervisores partidos en doce renglones: «JUAN JAIR TREJO» con 1 servicio y «JUAN JAIR TREJO TREJO» con 26 son la misma persona.',
        pasos: [
          'En <b>Catálogos</b>, escoge la lista (por ejemplo Supervisores).',
          'Busca el renglón de la versión que sobra.',
          'Da clic en <b>«Fusionar»</b>.',
          'Te muestra la lista numerada. Escribe el número de la versión buena.',
          'Confirma. Sus servicios y movimientos pasan al nombre bueno y la sobrante se borra.',
        ],
        nota: 'Los cortes de meses anteriores no se tocan. Corregir el presente no es reescribir el pasado.',
      },
      {
        titulo: 'Corregir un dato mal capturado',
        intro:
          'Es la salida de emergencia para cuando el dato nació mal. No es para uso diario: si a un servicio de verdad le subieron o le bajaron guardias, eso es un movimiento, no una corrección.',
        pasos: [
          'Busca el servicio y abre su ficha.',
          'Baja hasta <b>Corregir captura</b> y da clic en <b>«Corregir»</b>.',
          'Puedes cambiar el nombre, la razón social, el total de guardias, los turnos y la fecha de alta.',
          'Escribe el <b>motivo</b>: qué estaba mal. Es obligatorio.',
          'Si el servicio está dado de baja por error, aquí lo puedes reactivar.',
          'Da clic en <b>«Guardar corrección»</b>.',
        ],
      },
      {
        titulo: 'Los respaldos',
        intro: 'La plataforma se respalda sola todos los días. Esto es para cuando necesitas uno a mano.',
        pasos: [
          'Entra a <b>Administrar</b> → <b>Respaldos</b>.',
          'Da clic en crear un respaldo. Escoge si quieres incluir los archivos (contratos y facturas) o solo la base.',
          'Se descarga como un archivo .zip.',
          'Para volver a un respaldo, súbelo y confirma. Antes de reemplazar nada, la plataforma hace otro respaldo de lo que hay ahora.',
        ],
        aviso: 'Restaurar reemplaza TODO lo que hay hoy por lo que había en ese respaldo. Todo lo capturado después se pierde. Úsalo solo si de verdad hace falta.',
      },
      {
        titulo: 'La bitácora',
        intro: 'Cada cambio queda registrado: quién, cuándo, qué cambió y por qué.',
        pasos: [
          'Entra a <b>Administrar</b> → <b>Bitácora</b>.',
          'Está ordenada del cambio más reciente al más viejo.',
          'Sirve para saber quién movió qué cuando un número no cuadra.',
        ],
      },
      REGLA_DE_ORO,
      {
        titulo: 'Lo que ni tú puedes hacer',
        lista: [
          ['Agregar un servicio a mano', 'Solo entra por una apertura'],
          ['Quitar un servicio a mano', 'Solo sale por una cancelación'],
          ['Borrar una factura', 'Se cancela con motivo, y deja de contar para el saldo'],
          ['Borrar una apertura', 'Se descarta o se deshace, pero queda en el histórico'],
          ['Cambiar un corte de un mes anterior', 'Es el respaldo de lo que se facturó ese mes'],
        ],
        nota: 'No son limitaciones por descuido. Cada una existe para que los números de la plataforma siempre se puedan explicar.',
      },
    ],
  },

  // -------------------------------------------------------------- ESPECTADOR
  {
    rol: 'espectador',
    titulo: 'Espectador',
    color: '#64748b',
    resumen: 'Puedes ver toda la operación. No modificas nada, ni siquiera una nota.',
    pestanas: ['Tablero', 'Estado de fuerza', 'Aperturas', 'Cancelaciones', 'Jurídico'],
    secciones: [
      COMUNES.entrar,
      COMUNES.moverse,
      COMUNES.verUnDia,
      {
        titulo: 'Qué puedes ver',
        lista: [
          ['Tablero', 'El resumen: cuántos servicios y guardias hay, cómo se reparten, los movimientos recientes'],
          ['Estado de fuerza', 'Todos los servicios con sus guardias, turnos, importe, contrato y factura'],
          ['Aperturas', 'Los movimientos de alta, mes por mes, con sus totales'],
          ['Cancelaciones', 'Las bajas y reducciones, mes por mes, con sus motivos'],
          ['Jurídico', 'La situación de los contratos: vencidos, por vencer, sin contrato'],
        ],
      },
      {
        titulo: 'Cómo leer el tablero',
        pasos: [
          '<b>Servicios activos</b> y <b>guardias</b>: la operación de hoy.',
          '<b>Guardias por turno</b>: cómo está armada la plantilla. Doce guardias en 24 HRS y doce en 12X12 son la misma cifra y dos operaciones distintas.',
          '<b>Fijos y temporales</b>: qué parte de la operación tiene fecha de término.',
          '<b>Por zona</b> y <b>Asesores por guardias</b>: cómo se reparte.',
          '<b>Movimientos recientes</b>: las últimas altas y bajas, por la fecha en que ocurrieron.',
        ],
      },
      {
        titulo: 'Cómo ver un servicio a fondo',
        pasos: [
          'Entra a <b>Estado de fuerza</b>.',
          'Escribe el nombre en la caja de buscar.',
          'Da clic en el nombre del servicio.',
          'Ahí está todo: sus datos, su contrato, sus facturas, su historia de movimientos y las notas que le han dejado.',
        ],
      },
      {
        titulo: 'Ver el contrato o la factura de un servicio',
        pasos: [
          'En la tabla del estado de fuerza, la columna <b>Contrato</b> dice si tiene o no.',
          'Si dice «Con contrato», da clic y se descarga el PDF.',
          'La columna <b>Factura</b> hace lo mismo con la factura de ese mes.',
        ],
      },
      {
        titulo: 'Lo que no puedes hacer',
        intro: 'Tu cuenta es de solo consulta. Los botones de capturar no te aparecen, y si intentaras entrar por otro camino la plataforma no te lo permitiría.',
        lista: [
          ['Registrar una apertura o una cancelación', 'Ventas u operaciones'],
          ['Escribir una nota en un servicio', 'Cualquiera de los otros roles'],
          ['Cambiar cualquier dato', 'Depende del dato: consulta con quien corresponda'],
        ],
        nota: 'Es a propósito y no es desconfianza: hay quien necesita ver la operación sin poder alterarla —una dirección, un socio, un auditor—. Ese es tu rol.',
      },
    ],
  },
];
