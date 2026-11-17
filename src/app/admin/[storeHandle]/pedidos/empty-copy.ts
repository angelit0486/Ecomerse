/**
 * Estado vacío de Pedidos según la vista: «Sin pedidos» solo cuando de verdad
 * no hay ninguno (vista «Todos», primera página). Con un filtro o al pasar de
 * página, la tienda sí tiene pedidos: se dice y se ofrece volver a todos.
 */
export function ordersEmptyCopy(
  filter: string,
  filterLabel: string,
  paged: boolean,
): { title: string; description: string; showAll: boolean } {
  if (paged) {
    return {
      title: "Nada en esta vista",
      description: "No hay más pedidos en esta lista.",
      showAll: true,
    };
  }
  if (filter === "por-surtir") {
    return {
      title: "Nada por surtir",
      description: "Todos los pedidos pagados ya salieron. Los nuevos aparecerán aquí.",
      showAll: false,
    };
  }
  if (filter === "todos") {
    return {
      title: "Sin pedidos",
      description: "Los pedidos de tu tienda aparecerán aquí.",
      showAll: false,
    };
  }
  return {
    title: "Nada en esta vista",
    description: `No hay pedidos en «${filterLabel}».`,
    showAll: true,
  };
}
