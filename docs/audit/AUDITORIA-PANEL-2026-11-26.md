# Auditoría completa del panel — 26 nov 2026

Pedido del propietario: auditar cada función del panel, potenciar lo más funcional e implementar lo que falte.

## Resultado

El panel no tiene fallas técnicas: 46 pantallas sin errores, sin desbordes en celular y sin fallas graves de accesibilidad, y los permisos se respetan en 5 roles. Se corrigieron 5 detalles de uso; lo demás queda como recomendación o decisión del propietario.

## Qué se revisó y cómo

| Capa                       | Método                                                                                                                                                     | Resultado                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pantallas del panel        | Recorrido automático por los enlaces del panel con una tienda con datos reales (productos, existencias, pedidos pagados y pendientes), en 390 px y 1280 px | 46 pantallas: 0 errores del servidor, 0 errores en consola, 0 desbordes horizontales, 0 fallas graves de accesibilidad (axe), todas con título; 1.4–2.2 s por pantalla en local |
| Permisos                   | El mismo recorrido con 5 roles limitados: visor, pedidos, catálogo, diseño y soporte                                                                       | 0 errores; cada rol ve solo su menú; lo demás responde 404 (o 403 en la vista previa privada)                                                                                   |
| Tienda del comprador       | Portada, catálogo, ficha, búsqueda, carrito, pago, cuenta y 404, en celular                                                                                | 0 errores, 0 desbordes, 0 fallas graves de accesibilidad; 0.6–0.8 s por página en local                                                                                         |
| Base de datos              | `pnpm db:test`: pgTAP (aislamiento entre tiendas, permisos) e integración                                                                                  | 3,327 pruebas en 159 archivos y 468 pruebas de integración: todas pasan                                                                                                         |
| Código                     | `pnpm verify`                                                                                                                                              | 1,795 pruebas unitarias pasan                                                                                                                                                   |
| Navegador de punta a punta | Playwright, suite completa                                                                                                                                 | 198 de 198 (26 nov, antes de estas correcciones); las 8 pruebas que tocan lo corregido pasan                                                                                    |
| Staging                    | Asesores de Supabase (seguridad y rendimiento) y encabezados HTTP                                                                                          | Sin errores; encabezados completos (CSP con nonce, HSTS, sin iframes, nosniff)                                                                                                  |

## Corregido en esta auditoría

1. **Inicio, «1 pendientes de pago»:** ahora «1 pendiente de pago» y «1 necesita atención». Una prueba E2E esperaba el error; se corrigió.
2. **Inicio, gráfica de ventas por día:** era una barra sin fechas ni montos. Ahora muestra el periodo y «Día más alto: fecha · monto».
3. **Ficha de producto en el celular:** el precio de la variante se cortaba («34» en vez de «349.00»). Los campos de la tabla tienen ancho mínimo y la tabla se desplaza.
4. **Historial del pedido:** decía «Pedido recibido · Pedido recibido». El mensaje ya no se repite.
5. **Clientes:** la columna «Pedidos» contaba solo pedidos pagados y un cliente con un pedido pendiente salía con 0. Se llama «Pedidos pagados».

## Recomendaciones (no se hicieron: requieren decisión o migración)

| Tema                                       | Por qué importa                                                    | Qué hace falta                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Correo real en staging                     | `EMAIL_PROVIDER = fake`: los compradores no reciben confirmaciones | Elegir proveedor y guardar su llave en Vercel (propietario)                                                                           |
| Dominio propio                             | Construido, pero sin `VERCEL_DOMAINS_TOKEN` no verifica            | Token en Vercel (propietario)                                                                                                         |
| Protección de contraseñas filtradas        | Asesor de Supabase: apagada                                        | Encenderla en Supabase → Auth (propietario)                                                                                           |
| Esquema `respaldo_20261118` en staging     | 98 tablas de un respaldo del 18 nov dentro de la base              | Decidir si se borra (propietario; acción destructiva)                                                                                 |
| Lista de pedidos sin columna «Cliente»     | Para operar rápido conviene ver a quién es cada pedido             | El nombre pasa por `orders_get_contact` (datos personales auditados): necesita una función de lista con las mismas reglas (migración) |
| 54 llaves foráneas sin índice              | Rendimiento cuando haya muchas tiendas                             | Migración de índices, con autorización                                                                                                |
| «Mis clientes» con miles de tiendas        | ~3.6 s con 8,597 tiendas de prueba                                 | Revisar el plan de la consulta (D-CON-01)                                                                                             |
| Políticas permisivas dobles en `customers` | Rendimiento menor (asesor)                                         | Unificar en una migración                                                                                                             |

Hallazgos del asesor que son intencionales: funciones `SECURITY DEFINER` ejecutables por la sesión (cada una valida permisos por dentro) y tablas de auditoría sin políticas (nadie las lee directo).

## Pantallas que el recorrido no alcanzó

Rentabilidad, Salud, Devoluciones y Despachos están detrás de interruptores o solo aparecen con datos; cada una tiene su propia prueba E2E en la suite.
