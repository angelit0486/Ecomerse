-- T03: lo que piden el panel (como la dueña, RLS activo) y la tienda en línea
-- (rol storefront_gateway) a una tienda. Variables: :idx (tienda), :n (productos).
\set ON_ERROR_STOP 1
\pset format unaligned
\pset fieldsep '|'
\pset tuples_only on
select capgen.id('pruva:' || :idx || ':store') as s, capgen.user_id(:idx, 'owner') as u,
       capgen.id('pruva:' || :idx || ':cat:1:1') as cat, capgen.id('pruva:' || :idx || ':brand:3') as brand,
       capgen.id('pruva:' || :idx || ':p:' || (:n / 2)) as pid \gset
begin;
select capgen.login(:'u');
\set B 'select * from capgen.bench('
select * from capgen.bench('panel.lista.recientes', format($$select * from public.catalog_search_products(%L, null, null, null, false, null, 26)$$, :'s'));
select * from capgen.bench('panel.lista.100', format($$select * from public.catalog_search_products(%L, null, null, null, false, null, 100)$$, :'s'));
select * from capgen.bench('panel.lista.nombre', format($$select * from public.catalog_search_products(%L, null, null, null, false, null, 26, null, null, 'nombre')$$, :'s'));
select * from capgen.bench('panel.lista.precio_desc', format($$select * from public.catalog_search_products(%L, null, null, null, false, null, 26, null, null, 'precio_desc')$$, :'s'));
select * from capgen.bench('panel.lista.pagina_profunda(nombre)', format($$select * from public.catalog_search_products(%L, null, null, null, false, %L::jsonb, 26, null, null, 'nombre')$$, :'s',
  (select jsonb_build_object('k', lower(title), 'id', id) from public.products where store_id = :'s' order by lower(title) offset (:n * 9 / 10) limit 1)::text));
select * from capgen.bench('panel.lista.borradores', format($$select * from public.catalog_search_products(%L, null, 'draft', null, false, null, 26)$$, :'s'));
select * from capgen.bench('panel.lista.categoria', format($$select * from public.catalog_search_products(%L, null, null, %L, false, null, 26)$$, :'s', :'cat'));
select * from capgen.bench('panel.lista.marca', format($$select * from public.catalog_search_products(%L, null, null, null, false, null, 26, %L)$$, :'s', :'brand'));
select * from capgen.bench('panel.lista.agotados', format($$select * from public.catalog_search_products(%L, null, null, null, false, null, 26, null, 'agotados')$$, :'s'));
select * from capgen.bench('panel.lista.sin_foto', format($$select * from public.catalog_search_products(%L, null, null, null, false, null, 26, null, 'sin_foto')$$, :'s'));
select * from capgen.bench('panel.lista.pocas_existencias', format($$select * from public.catalog_search_products(%L, null, null, null, false, null, 26, null, 'pocas_existencias')$$, :'s'));
select * from capgen.bench('panel.buscar.palabra', format($$select * from public.catalog_search_products(%L, 'playera', null, null, false, null, 26)$$, :'s'));
select * from capgen.bench('panel.buscar.frase', format($$select * from public.catalog_search_products(%L, 'tenis urbana rojo', null, null, false, null, 26)$$, :'s'));
select * from capgen.bench('panel.buscar.sku', format($$select * from public.catalog_search_products(%L, %L, null, null, false, null, 26)$$, :'s', 'c' || :idx || '-' || (:n / 2) || '-0'));
select * from capgen.bench('panel.buscar.sin_resultado', format($$select * from public.catalog_search_products(%L, 'zzzqqq', null, null, false, null, 26)$$, :'s'));
select * from capgen.bench('panel.producto.detalle', format($$select (select count(*) from public.products where store_id = %1$L and id = %2$L)
  + (select count(*) from public.product_options o left join public.product_option_values v on v.option_id = o.id where o.product_id = %2$L)
  + (select count(*) from public.product_variants where product_id = %2$L and deleted_at is null)
  + (select count(*) from public.product_categories where product_id = %2$L)
  + (select count(*) from public.media where product_id = %2$L and deleted_at is null)$$, :'s', :'pid'));
select * from capgen.bench('panel.inventario.lista', format($$select * from public.inventory_search(%L)$$, :'s'));
select * from capgen.bench('panel.inventario.buscar', format($$select * from public.inventory_search(%L, 'mochila')$$, :'s'));
select * from capgen.bench('panel.inventario.pocas', format($$select * from public.inventory_search(%L, null, true)$$, :'s'));
select * from capgen.bench('panel.inventario.pagina_profunda', format($$select * from public.inventory_search(%L, null, false, %s, 50)$$, :'s', :n));
select * from capgen.bench('panel.calidad_catalogo', format($$select public.catalog_quality_report(%L)$$, :'s'), 3);
select * from capgen.bench('panel.inicio.kpis', format($$select public.dashboard_kpis(%L, null, null)$$, :'s'), 3);
select * from capgen.bench('panel.categorias', format($$select id, parent_id, name from public.categories where store_id = %L and deleted_at is null$$, :'s'));
select * from capgen.bench('panel.editar.estado', format($$select public.catalog_set_product_status(%L, %L, 'archived')$$, :'s', :'pid'), 1);
select * from capgen.bench('panel.editar.publicar', format($$select public.catalog_publish_product(%L, %L)$$, :'s', :'pid'), 1);
select * from capgen.bench('panel.bloque.etiquetas_100', format($$select public.catalog_bulk_tags(%L, array(select id from public.products where store_id = %1$L order by id limit 100), 'promo', 'add')$$, :'s'), 1);
select * from capgen.bench('panel.bloque.precios_100(vista previa)', format($$select public.catalog_bulk_adjust_prices(%L, array(select id from public.products where store_id = %1$L order by id limit 100), 10, 'peso', false)$$, :'s'), 1);
select * from capgen.bench('panel.bloque.precios_100(aplicar)', format($$select public.catalog_bulk_adjust_prices(%L, array(select id from public.products where store_id = %1$L order by id limit 100), 10, 'peso', true)$$, :'s'), 1);
rollback;

begin;
set local role storefront_gateway;
select * from capgen.bench('tienda.lista', format($$select * from storefront.list_products(%L)$$, :'s'));
select * from capgen.bench('tienda.lista.categoria', format($$select * from storefront.list_products(%L, 'cat-1/cat-1-1')$$, :'s'));
select * from capgen.bench('tienda.lista.categoria_raiz', format($$select * from storefront.list_products(%L, 'cat-1')$$, :'s'));
select * from capgen.bench('tienda.lista.marca', format($$select * from storefront.list_products(%L, null, 'marca-3')$$, :'s'));
select * from capgen.bench('tienda.lista.precio_asc', format($$select * from storefront.list_products(%L, null, null, null, 'price_asc')$$, :'s'));
select * from capgen.bench('tienda.lista.rango_precio', format($$select * from storefront.list_products(%L, null, null, null, null, 100000, 200000)$$, :'s'));
select * from capgen.bench('tienda.lista.disponibles', format($$select * from storefront.list_products(%L, null, null, null, null, null, null, true)$$, :'s'));
select * from capgen.bench('tienda.lista.en_oferta', format($$select * from storefront.list_products(%L, p_on_sale => true)$$, :'s'));
select * from capgen.bench('tienda.buscar.palabra', format($$select * from storefront.list_products(%L, null, null, 'playera')$$, :'s'));
select * from capgen.bench('tienda.buscar.frase', format($$select * from storefront.list_products(%L, null, null, 'mochila premium azul')$$, :'s'));
select * from capgen.bench('tienda.buscar.sin_resultado', format($$select * from storefront.list_products(%L, null, null, 'zzzqqq')$$, :'s'));
select * from capgen.bench('tienda.filtros', format($$select storefront.list_facets(%L)$$, :'s'));
select * from capgen.bench('tienda.filtros.categoria', format($$select storefront.list_facets(%L, 'cat-1')$$, :'s'));
select * from capgen.bench('tienda.filtros.busqueda', format($$select storefront.list_facets(%L, null, null, 'playera')$$, :'s'));
select * from capgen.bench('tienda.sugerencias', format($$select storefront.search_suggestions(%L, 'pla')$$, :'s'));
select * from capgen.bench('tienda.producto', format($$select storefront.get_product(%L, %L)$$, :'s', 'p-' || (:n / 2 + 1)));
select * from capgen.bench('tienda.relacionados', format($$select storefront.related_products(%L, %L)$$, :'s', 'p-' || (:n / 2 + 1)));
select * from capgen.bench('tienda.categoria', format($$select storefront.get_category(%L, 'cat-1/cat-1-1')$$, :'s'));
select * from capgen.bench('tienda.mapa_del_sitio', format($$select * from storefront.sitemap_entries(%L)$$, :'s'), 3);
select * from capgen.bench('tienda.inicio', format($$select storefront.get_home(%L)$$, :'s'), 3);
rollback;
