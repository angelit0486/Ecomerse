-- =============================================================================
-- Fase 2 · Onboarding: datos de la tienda y branding con contraste (F2-T11).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('cat', 'cat@a.io');
select tests.create_user('mkt', 'mkt@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'cat', 'catalog_manager');
select tests.add_store_member('a', 'mkt', 'marketing_manager');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

-- Contraste (mismos valores que src/lib/color/contrast.ts).
select is(round(app.contrast_ratio('#ffffff', '#000000')::numeric, 2), 21.00, 'blanco/negro = 21:1');
select ok(app.contrast_ratio('#777777', '#ffffff') < 4.5, '#777 sobre blanco no llega a 4.5:1');
select is(app.theme_contrast_issues('{}'::jsonb), '{}'::text[], 'la paleta por defecto es válida');
select is(app.theme_contrast_issues('{"colors":{"foreground":"#aaaaaa"}}'), array['foreground'],
  'texto gris claro sobre blanco: falla foreground');
select is(app.theme_contrast_issues('{"colors":{"primary":"#ffff00"}}'), array['primary'],
  'amarillo sobre blanco: el botón no se distingue del fondo');
select is(app.theme_contrast_issues('{"colors":{"accent":"#fde68a","muted":"#d1d5db"}}'), array['muted', 'accent'],
  'acento y texto secundario claros sobre blanco: fallan ambos');

-- Guardar borrador.
select tests.logout(); select tests.login('owner');
select lives_ok($$ select public.appearance_save_theme_draft(tests.fx('store_a'),
  '{"colors":{"primary":"#0f766e","background":"#ffffff","foreground":"#0b1320"},"shape":{"radius":"md","button_style":"solid"}}') $$,
  'paleta con buen contraste: se guarda');
select throws_like($$ select public.appearance_save_theme_draft(tests.fx('store_a'), '{"colors":{"foreground":"#cccccc"}}') $$,
  'validation_failed', 'contraste insuficiente: no se guarda');
select throws_like($$ select public.appearance_save_theme_draft(tests.fx('store_a'), '{"css":"body{}"}') $$,
  'validation_failed', 'forma inválida (CSS libre): no se guarda');
select is(tests.sqlstate_as('authenticated', $$ update public.store_themes set draft_settings = '{}' $$), '42501',
  'el borrador ya no se edita por tabla');
select tests.logout(); select tests.login('mkt');
select lives_ok($$ select public.appearance_save_theme_draft(tests.fx('store_a'), '{"colors":{"accent":"#9a3412"}}') $$,
  'marketing_manager tiene appearance.manage');
select tests.logout(); select tests.login('cat');
select throws_ok($$ select public.appearance_save_theme_draft(tests.fx('store_a'), '{}') $$,
  '42501', 'forbidden', 'catalog_manager no edita la apariencia');
select tests.logout(); select tests.login('owner_b');
select throws_ok($$ select public.appearance_save_theme_draft(tests.fx('store_a'), '{}') $$,
  '42501', 'forbidden', 'otro tenant no edita la apariencia');
select tests.logout(); select tests.login('owner', 'aal1');
select throws_ok($$ select public.appearance_save_theme_draft(tests.fx('store_a'), '{}') $$,
  '42501', 'mfa_required', 'exige 2FA');
select tests.logout();

-- Publicar exige contraste aunque el borrador hubiera llegado por otra vía.
update public.store_themes set draft_settings = '{"colors":{"foreground":"#dddddd"}}' where store_id = tests.fx('store_a');
select tests.logout(); select tests.login('owner');
select throws_like($$ select public.appearance_publish_theme(tests.fx('store_a')) $$,
  'validation_failed', 'publicar con contraste insuficiente: bloqueado');
select tests.logout();

-- Datos de la tienda.
select tests.logout(); select tests.login('owner');
select lives_ok($$ select public.store_update_profile(tests.fx('store_a'), 'Moda Ana', 'Hola@ModaAna.mx',
  '+52 55 1234 5678', 'America/Monterrey') $$, 'el dueño actualiza los datos de la tienda');
select throws_like($$ select public.store_update_profile(tests.fx('store_a'), 'Moda Ana', 'no-es-email', null,
  'America/Monterrey') $$, 'validation_failed', 'email de contacto inválido');
select throws_like($$ select public.store_update_profile(tests.fx('store_a'), 'Moda Ana', 'a@b.mx', null,
  'Marte/Olympus') $$, 'validation_failed', 'zona horaria inexistente');
select throws_like($$ select public.store_update_profile(tests.fx('store_a'), 'M', 'a@b.mx', null,
  'America/Monterrey') $$, 'validation_failed', 'nombre demasiado corto');
select tests.logout(); select tests.login('cat');
select throws_ok($$ select public.store_update_profile(tests.fx('store_a'), 'X tienda', 'a@b.mx', null,
  'America/Monterrey') $$, '42501', 'forbidden', 'catalog_manager no edita los datos de la tienda');
select tests.logout(); select tests.login('owner_b');
select throws_ok($$ select public.store_update_profile(tests.fx('store_a'), 'Robada', 'a@b.mx', null,
  'America/Monterrey') $$, '42501', 'forbidden', 'otro tenant no edita los datos');
select tests.logout();
select is((select contact_email || '|' || timezone from public.stores where id = tests.fx('store_a')),
  'hola@modaana.mx|America/Monterrey', 'email normalizado y zona horaria guardados');
select is((select count(*)::int from audit.audit_logs where action = 'store.updated' and store_id = tests.fx('store_a')),
  1, 'cambio de datos auditado');
select is((select count(*)::int from audit.audit_logs where action = 'theme.draft_saved' and store_id = tests.fx('store_a')),
  2, 'borradores guardados auditados');

select * from finish();
rollback;
