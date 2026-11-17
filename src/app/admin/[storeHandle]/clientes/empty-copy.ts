/**
 * Estado vacío de Clientes: sin búsqueda, la tienda aún no tiene clientes; con
 * búsqueda, sí los tiene pero ninguno coincide (no son lo mismo).
 */
export function customersEmptyCopy(query: string): { title: string; description: string } {
  const q = query.trim();
  if (!q) {
    return { title: "Sin clientes", description: "Aparecen cuando alguien compra en tu tienda." };
  }
  return {
    title: "Sin resultados",
    description: `Ningún cliente coincide con «${q}». Revisa el email o el nombre, o deja el buscador vacío para ver todos.`,
  };
}
