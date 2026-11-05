/**
 * Ayuda dentro del panel (auditoría global, paso 22; interruptor `panel_help`).
 * Guías cortas con los nombres reales de botones y campos del panel. `path` es
 * la pantalla a la que lleva «Ir a…», relativa a /admin/[tienda]; una prueba
 * comprueba que exista. Mantener al día cuando cambie una pantalla.
 */
export interface HelpGuide {
  slug: string;
  title: string;
  summary: string;
  path: string;
  pathLabel: string;
  steps: string[];
  tips?: string[];
}

export const HELP_GUIDES: HelpGuide[] = [
  {
    slug: "recibir-y-enviar-pedidos",
    title: "Recibir, empacar y enviar un pedido",
    summary: "Del pedido pagado a «va en camino», con número de guía.",
    path: "/pedidos?estado=por-surtir",
    pathLabel: "Ir a Por surtir",
    steps: [
      "Entra a Pedidos → «Por surtir». Ahí está todo lo pagado que falta enviar, del más antiguo al más reciente.",
      "Abre el pedido y revisa productos, cantidades, dirección y teléfono. Solo empaca lo que dice «Pagado».",
      "Empaca y genera la guía en la página de tu paquetería.",
      "En el pedido, en «Registrar envío», escribe la paquetería, el número de guía y, si tienes, el enlace de rastreo (https). Toca «Registrar envío».",
      "Tu cliente recibe un correo «Tu pedido va en camino» con la guía.",
      "Cuando la paquetería confirme la entrega, toca «Marcar entregado».",
    ],
    tips: [
      "Si falta stock de un producto, registra solo lo que mandas: el pedido queda «parcial» y el resto sale en otro envío.",
      "Con «Notas de empaque» encendida en Ajustes → Funciones puedes imprimir la nota de cada pedido o todas las de «Por surtir».",
    ],
  },
  {
    slug: "cobrar",
    title: "Cobrar con Mercado Pago o transferencia",
    summary: "Conectar tu cuenta de Mercado Pago y ofrecer transferencia.",
    path: "/ajustes/pagos",
    pathLabel: "Ir a Ajustes → Pagos",
    steps: [
      "Entra a Ajustes → Pagos.",
      "Toca «Conectar Mercado Pago» e inicia sesión con tu cuenta de Mercado Pago. El dinero llega directo a esa cuenta.",
      "Para transferencia, escribe en «Instrucciones de pago» tu banco y CLABE, y toca «Guardar pago».",
      "Un pedido solo queda «Pagado» cuando Mercado Pago lo confirma: regresar a la tienda no cuenta como pago.",
    ],
    tips: [
      "Los pagos por transferencia los confirmas tú desde el pedido cuando veas el dinero en tu banco.",
    ],
  },
  {
    slug: "envios",
    title: "Configurar zonas y tarifas de envío",
    summary: "A dónde envías y cuánto cuesta.",
    path: "/envios",
    pathLabel: "Ir a Envíos",
    steps: [
      "Entra a Envíos y toca «Crear zona». Elige el país y, si solo envías a algunos estados, escríbelos en «Regiones (opcional)». Toca «Guardar zona».",
      "En la zona, toca «Agregar tarifa» y elige el tipo: «Precio fijo», «Gratis desde un monto» o «Recoger en tienda».",
      "Escribe el precio y los días de entrega («Días (mín.)» y «Días (máx.)»). Toca «Guardar tarifa».",
      "Si un cliente escribe una dirección fuera de tus zonas, la tienda le dice que todavía no envías a su estado.",
    ],
  },
  {
    slug: "productos",
    title: "Dar de alta un producto",
    summary: "Nombre, precio, existencias y fotos.",
    path: "/productos/nuevo",
    pathLabel: "Ir a Nuevo producto",
    steps: [
      "Entra a Productos → «Nuevo producto».",
      "Escribe «Nombre», «Precio» y «Existencias». Si quieres mostrar una oferta, pon el precio anterior en «Precio antes».",
      "Agrega «Código interno (SKU)», «Categoría», «Marca» y «Peso para envío (gramos)».",
      "Toca «Crear producto». Después, en la ficha, sube las fotos y publica cuando diga «Tiene lo necesario para publicarse».",
    ],
    tips: ["Para cargar muchos productos a la vez usa Productos → Importar con un archivo CSV."],
  },
  {
    slug: "inventario",
    title: "Ajustar existencias",
    summary: "Sumar mercancía, registrar mermas o fijar la cantidad.",
    path: "/inventario",
    pathLabel: "Ir a Inventario",
    steps: [
      "Entra a Inventario y busca el producto en «Buscar en el inventario».",
      "Abre el producto y elige «Cómo»: «Sumar o restar» o «Fijar en».",
      "Elige el «Motivo» (por ejemplo «Ajuste», «Daño» o «Pérdida») y guarda.",
      "«Disponible» es lo que se puede vender; «Reservado» es lo apartado por pedidos sin pagar o sin enviar.",
    ],
  },
  {
    slug: "reembolsos-y-cancelaciones",
    title: "Cancelar o reembolsar un pedido",
    summary: "Todo o una parte, siempre desde el panel.",
    path: "/pedidos",
    pathLabel: "Ir a Pedidos",
    steps: [
      "Abre el pedido.",
      "Si todavía no sale: «Cancelar el pedido», marca la casilla de confirmación y toca «Cancelar pedido». Se cancela, se libera el stock y se reembolsa todo.",
      "Si ya salió o es solo una parte: «Reembolsar dinero», escribe el monto en pesos (por ejemplo 150.00), toca «Solicitar reembolso» y confirma.",
      "El dinero regresa por Mercado Pago a la tarjeta o cuenta del cliente; los tiempos los pone el banco (de 2 a 10 días hábiles).",
    ],
    tips: [
      "No reembolses desde el panel de Mercado Pago: la tienda lo detecta, pero el registro oficial es el de aquí.",
    ],
  },
  {
    slug: "descuentos",
    title: "Crear un código de descuento",
    summary: "Porcentaje, monto fijo o envío gratis.",
    path: "/descuentos",
    pathLabel: "Ir a Descuentos",
    steps: [
      "Entra a Descuentos.",
      "Escribe el «Código» que usarán tus clientes y elige el «Tipo»: «Porcentaje», «Monto fijo» o «Envío gratis».",
      "Si quieres, limita las fechas («Desde» y «Hasta») y los usos («Usos totales» y «Usos por cliente»).",
      "Toca «Crear descuento». El cliente lo escribe en el carrito, en «¿Tienes un código de descuento?».",
    ],
  },
  {
    slug: "portada",
    title: "Cambiar la portada de tu tienda",
    summary: "Bloques, imágenes y publicar sin riesgo.",
    path: "/apariencia?seccion=portada",
    pathLabel: "Ir a Apariencia → Portada",
    steps: [
      "Entra a Apariencia → Portada.",
      "En «Nuevo bloque» elige el tipo (por ejemplo «Portada de imágenes» o «Productos destacados») y toca «Agregar bloque».",
      "Llena el bloque. La vista previa en vivo muestra cómo se ve en celular y en computadora.",
      "Toca «Guardar portada en el borrador» y, cuando te guste, «Publicar». Hasta publicar, tus clientes ven la portada anterior.",
    ],
    tips: [
      "Las imágenes de portada se ven mejor a 2400 × 1029 px en computadora; el panel avisa si una se verá borrosa.",
    ],
  },
  {
    slug: "equipo",
    title: "Invitar a alguien a tu equipo",
    summary: "Que otra persona te ayude con permisos limitados.",
    path: "/ajustes/equipo",
    pathLabel: "Ir a Ajustes → Equipo",
    steps: [
      "Entra a Ajustes → Equipo → «Invitar a alguien».",
      "Escribe su «Email» y elige el «Rol»: cada rol solo ve lo que necesita.",
      "Toca «Invitar a la tienda». La persona recibe un correo para entrar.",
      "Para quitar a alguien, toca «Quitar» en su fila.",
    ],
  },
  {
    slug: "funciones",
    title: "Encender funciones nuevas",
    summary: "Probar mejoras en tu tienda y apagarlas cuando quieras.",
    path: "/ajustes/funciones",
    pathLabel: "Ir a Ajustes → Funciones",
    steps: [
      "Entra a Ajustes → Funciones.",
      "Lee qué hace cada función y dónde se nota.",
      "Toca «Encender …». El cambio se aplica al momento.",
      "Si no te convence, toca «Apagar …»: todo vuelve a como estaba.",
    ],
  },
];

export function findGuide(slug: string): HelpGuide | undefined {
  return HELP_GUIDES.find((g) => g.slug === slug);
}
