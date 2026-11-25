-- =============================================================================
-- Promociones (ADR-070): aritmética pura del motor y de los totales.
-- app.promotion_apply y app.cart_totals no leen tablas: se prueban con JSON.
-- Reglas del propietario (2026-11-25): una promoción por pieza, gana la que más
-- ahorra (empate: la más específica, luego la más antigua), las presentaciones
-- cuentan juntas, el descuento cae en las piezas más baratas y por omisión no
-- aplica a piezas con precio de oferta.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

create function tests.ln(p_prod text, p_price bigint, p_qty int, p_sale boolean default false) returns jsonb
language sql immutable as $$
  select jsonb_build_object('product_id', p_prod, 'unit_price', p_price, 'quantity', p_qty, 'on_sale', p_sale)
$$;
create function tests.pr(p_id text, p_type text, p_rules jsonb, p_products text[] default null,
                         p_spec int default 1, p_sale boolean default false) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', p_id, 'label', 'L-' || p_id, 'type', p_type, 'rules', p_rules,
                            'product_ids', to_jsonb(p_products), 'specificity', p_spec,
                            'applies_to_sale_items', p_sale)
$$;
create function tests.pt(p_lines jsonb, p_promos jsonb) returns bigint language sql immutable as $$
  select (app.promotion_apply(p_lines, p_promos) ->> 'promotion_total')::bigint
$$;
create function tests.x32() returns jsonb language sql immutable as $$
  select tests.pr('a', 'buy_n_pay_m', '{"buy":3,"pay":2}')
$$;

-- ---------------------------------------------------------------- reglas válidas
select ok(app.promotion_rules_valid('buy_n_pay_m', '{"buy":3,"pay":2}'), '3×2 es válido');
select ok(not app.promotion_rules_valid('buy_n_pay_m', '{"buy":3,"pay":3}'), 'pagar lo mismo que se lleva no es promoción');
select ok(not app.promotion_rules_valid('buy_n_pay_m', '{"buy":3,"pay":0}'), 'pagar 0 no se permite');
select ok(app.promotion_rules_valid('nth_percent', '{"nth":2,"percent_bps":5000}'), 'la segunda al 50% es válida');
select ok(not app.promotion_rules_valid('nth_percent', '{"nth":1,"percent_bps":5000}'), 'la «primera» con descuento no es N-ésima');
select ok(not app.promotion_rules_valid('nth_percent', '{"nth":2,"percent_bps":10001}'), 'más de 100% no');
select ok(app.promotion_rules_valid('volume', '{"mode":"unit_price","tiers":[{"min_qty":5,"value":9000},{"min_qty":10,"value":8000}]}'),
          'mayoreo por precio unitario con escalones que bajan');
select ok(not app.promotion_rules_valid('volume', '{"mode":"unit_price","tiers":[{"min_qty":5,"value":9000},{"min_qty":10,"value":9500}]}'),
          'un escalón mayor no puede tener precio más alto');
select ok(not app.promotion_rules_valid('volume', '{"mode":"percent","tiers":[{"min_qty":1,"value":1000}]}'),
          'mayoreo desde 1 pieza no es mayoreo');
select ok(not app.promotion_rules_valid('volume', '{"mode":"percent","tiers":[{"min_qty":3,"value":1000},{"min_qty":3,"value":2000}]}'),
          'los escalones deben ir en cantidad creciente');
select ok(not app.promotion_rules_valid('2x1', '{}'), 'tipo desconocido');

-- ---------------------------------------------------------------- 3×2
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 2)), jsonb_build_array(tests.x32())), 0::bigint,
          '3×2 con 2 piezas: sin descuento');
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 3)), jsonb_build_array(tests.x32())), 10000::bigint,
          '3×2 con 3 piezas: una gratis');
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 7)), jsonb_build_array(tests.x32())), 20000::bigint,
          '3×2 con 7 piezas: dos gratis (la séptima se paga)');
select is(tests.pt(jsonb_build_array(tests.ln('a', 30000, 1), tests.ln('b', 20000, 1), tests.ln('c', 10000, 1)),
                   jsonb_build_array(tests.x32())), 10000::bigint,
          '3×2 con productos distintos: la gratis es la más barata');
select is(tests.pt(jsonb_build_array(tests.ln('a', 30000, 2), tests.ln('b', 10000, 1), tests.ln('c', 20000, 1),
                                     tests.ln('d', 5000, 2)),
                   jsonb_build_array(tests.x32())), 10000::bigint,
          '3×2 con 6 piezas de precios distintos: gratis las dos más baratas');

-- ---------------------------------------------------------------- N-ésima
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 3)),
                   jsonb_build_array(tests.pr('n', 'nth_percent', '{"nth":2,"percent_bps":5000}'))), 5000::bigint,
          'la segunda al 50% con 3 piezas: una con descuento');
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 4)),
                   jsonb_build_array(tests.pr('n', 'nth_percent', '{"nth":2,"percent_bps":5000}'))), 10000::bigint,
          'con 4 piezas: dos con descuento');
select is(tests.pt(jsonb_build_array(tests.ln('a', 20000, 1), tests.ln('b', 10000, 1)),
                   jsonb_build_array(tests.pr('n', 'nth_percent', '{"nth":2,"percent_bps":5000}'))), 5000::bigint,
          'el 50% cae en la más barata');
select is(tests.pt(jsonb_build_array(tests.ln('p', 999, 2)),
                   jsonb_build_array(tests.pr('n', 'nth_percent', '{"nth":2,"percent_bps":3333}'))), 333::bigint,
          'redondeo a centavos (mitad al par)');

-- ---------------------------------------------------------------- mayoreo
create function tests.vol() returns jsonb language sql immutable as $$
  select tests.pr('v', 'volume', '{"mode":"unit_price","tiers":[{"min_qty":5,"value":9000},{"min_qty":10,"value":8000}]}')
$$;
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 4)), jsonb_build_array(tests.vol())), 0::bigint,
          'mayoreo: 4 piezas no llegan al escalón');
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 5)), jsonb_build_array(tests.vol())), 5000::bigint,
          'mayoreo: desde 5, $90 c/u');
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 12)), jsonb_build_array(tests.vol())), 24000::bigint,
          'mayoreo: desde 10, $80 c/u en todas');
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 3), tests.ln('p', 10000, 2)), jsonb_build_array(tests.vol())),
          5000::bigint, 'las presentaciones del mismo producto cuentan juntas');
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 3), tests.ln('q', 10000, 2)), jsonb_build_array(tests.vol())),
          0::bigint, 'productos distintos no se suman para el mayoreo');
select is(tests.pt(jsonb_build_array(tests.ln('p', 8500, 5)), jsonb_build_array(tests.vol())), 0::bigint,
          'si el precio ya es menor que el escalón, no se cobra de más ni se «descuenta» negativo');
select is(tests.pt(jsonb_build_array(tests.ln('p', 333, 3)),
                   jsonb_build_array(tests.pr('v', 'volume', '{"mode":"percent","tiers":[{"min_qty":3,"value":1000}]}'))),
          100::bigint, 'mayoreo en porcentaje: 10% de $9.99 = $1.00 (mitad al par)');

-- ---------------------------------------------------------------- oferta y alcance
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 3, true)), jsonb_build_array(tests.x32())), 0::bigint,
          'por omisión no aplica a piezas con precio de oferta');
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 3, true)),
                   jsonb_build_array(tests.pr('a', 'buy_n_pay_m', '{"buy":3,"pay":2}', null, 1, true))), 10000::bigint,
          'sí aplica si la promoción lo permite');
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 3), tests.ln('q', 10000, 3)),
                   jsonb_build_array(tests.pr('a', 'buy_n_pay_m', '{"buy":3,"pay":2}', array['q'], 3))), 10000::bigint,
          'por producto: solo cuenta el producto elegido');

-- ---------------------------------------------------------------- varias promociones
select is(app.promotion_apply(jsonb_build_array(tests.ln('p', 10000, 3)),
            jsonb_build_array(tests.x32(), tests.pr('n', 'nth_percent', '{"nth":2,"percent_bps":5000}', array['p'], 3)))
            -> 'applied' -> 0 ->> 'promotion_id', 'a',
          'gana la que más ahorra aunque la otra sea más específica');
select is(app.promotion_apply(jsonb_build_array(tests.ln('p', 10000, 3)),
            jsonb_build_array(tests.x32(), tests.pr('n', 'nth_percent', '{"nth":3,"percent_bps":10000}', array['p'], 3)))
            -> 'applied' -> 0 ->> 'promotion_id', 'n',
          'empate en ahorro: gana la más específica');
select is(app.promotion_apply(jsonb_build_array(tests.ln('p', 10000, 3)),
            jsonb_build_array(tests.x32(), tests.pr('b', 'buy_n_pay_m', '{"buy":3,"pay":2}')))
            -> 'applied' -> 0 ->> 'promotion_id', 'a',
          'empate total: gana la más antigua');
select is((select array_agg((l ->> 'in_promotion')::boolean order by n)
             from jsonb_array_elements(app.promotion_apply(
                    jsonb_build_array(tests.ln('a', 30000, 1), tests.ln('b', 20000, 1), tests.ln('c', 10000, 1),
                                      tests.ln('d', 40000, 1)),
                    jsonb_build_array(tests.x32())) -> 'lines') with ordinality e(l, n)),
          array[true, true, true, false],
          'el motor marca las piezas que usó: las 3 más baratas, la cuarta queda libre');
select is(jsonb_array_length(app.promotion_apply(jsonb_build_array(tests.ln('p', 10000, 3)),
            jsonb_build_array(tests.x32(), tests.pr('b', 'buy_n_pay_m', '{"buy":3,"pay":2}'))) -> 'applied'), 1,
          'una sola promoción por pieza');
select is(tests.pt(jsonb_build_array(tests.ln('p', 10000, 3), tests.ln('q', 5000, 5)),
                   jsonb_build_array(tests.pr('a', 'buy_n_pay_m', '{"buy":3,"pay":2}', array['p'], 3),
                                     tests.pr('v', 'volume', '{"mode":"percent","tiers":[{"min_qty":5,"value":2000}]}',
                                              array['q'], 3))),
          15000::bigint, 'promociones distintas en productos distintos se suman');
select is((select sum((l ->> 'promotion_allocation')::bigint)::bigint
             from jsonb_array_elements(app.promotion_apply(
                    jsonb_build_array(tests.ln('a', 30000, 2), tests.ln('b', 10000, 1), tests.ln('d', 5000, 4)),
                    jsonb_build_array(tests.x32())) -> 'lines') l),
          tests.pt(jsonb_build_array(tests.ln('a', 30000, 2), tests.ln('b', 10000, 1), tests.ln('d', 5000, 4)),
                   jsonb_build_array(tests.x32())),
          'el reparto por línea suma exactamente el total');

-- ---------------------------------------------------------------- totales con cupón
create function tests.ct(p_combines boolean) returns jsonb language sql immutable as $$
  select app.cart_totals(
    jsonb_build_array(jsonb_build_object('unit_price', 1000, 'quantity', 1, 'promotion_allocation', 300),
                      jsonb_build_object('unit_price', 500, 'quantity', 1)),
    jsonb_build_object('discount', jsonb_build_object('type', 'percentage', 'value', 1000,
                                                      'combines_with_promotions', p_combines)))
$$;
select is(tests.ct(false) ->> 'coupon_total', '50', 'cupón que no se combina: solo descuenta líneas sin promoción');
select is(app.cart_totals(
            '[{"unit_price":1000,"quantity":1,"in_promotion":true},{"unit_price":500,"quantity":1,"in_promotion":false}]',
            '{"discount":{"type":"percentage","value":1000}}') ->> 'coupon_total', '50',
          'tampoco descuenta la pieza que la promoción usó aunque no llevara el descuento (la cara del 3×2)');
select is(tests.ct(true) ->> 'coupon_total', '120', 'cupón combinable: descuenta lo que queda tras la promoción');
select is((select array[(r ->> 'promotion_total')::bigint, (r ->> 'discount_total')::bigint, (r ->> 'total')::bigint]
             from (select tests.ct(false) r) t), array[300, 350, 1150]::bigint[],
          'el total resta promoción y cupón');
select is(app.cart_totals('[{"unit_price":1000,"quantity":1,"promotion_allocation":300}]',
                          '{"discount":{"type":"free_shipping"},"shipping":{"type":"flat","price":9900}}')
            ->> 'shipping_total', '0', 'envío gratis siempre se combina');
select throws_ok($$ select app.cart_totals('[{"unit_price":1000,"quantity":1,"promotion_allocation":1001}]', '{}') $$,
                 '22023', 'línea inválida', 'una promoción no puede pasar del valor de la línea');

select * from finish();
rollback;
