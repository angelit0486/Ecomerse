#!/usr/bin/env bash
# =============================================================================
# Restauración de prueba de un respaldo hecho con backup-export.sh (Orden 05).
#
# Restaura en una base VACÍA y la compara contra lo que se midió al exportar:
# versión de esquema, filas de cada tabla, tablas, funciones, triggers, políticas,
# RLS forzado y llaves foráneas. Mide el tiempo (RTO de la base).
#
# Candados, para no escribir nunca sobre staging o producción:
#   - DESTINO_CONFIRMADO debe ser igual al nombre de la base de destino (PGDATABASE)
#     y al host (PGHOST), así: DESTINO_CONFIRMADO="<host>/<base>".
#   - La base de destino debe estar vacía (ninguna tabla en public, app, audit,
#     system); si no, se detiene sin tocar nada.
# Credenciales: PGHOST, PGPORT, PGUSER, PGDATABASE, PGSSLMODE; contraseña cuando
# se pida o desde ~/.pgpass. Nunca en el comando.
#
# Uso:  DESTINO_CONFIRMADO="<host>/<base>" bash restore-check.sh <carpeta-del-respaldo>
# Las filas de usuarios se cuentan aparte: el destino puede traer las suyas.
# =============================================================================
set -uo pipefail
fail() { echo "✗ $*" >&2; exit 1; }

src="${1:-}"
[ -d "$src" ] || fail "Uso: DESTINO_CONFIRMADO=\"<host>/<base>\" bash restore-check.sh <carpeta-del-respaldo>"
[ -n "${PGPASSWORD:-}" ] && fail "PGPASSWORD está definida. Quítala: la contraseña se escribe cuando se pida."
for v in PGHOST PGUSER PGDATABASE; do [ -n "${!v:-}" ] || fail "Falta la variable $v."; done
[ "${DESTINO_CONFIRMADO:-}" = "$PGHOST/$PGDATABASE" ] ||
  fail "Confirma el destino: DESTINO_CONFIRMADO=\"$PGHOST/$PGDATABASE\". Nunca uses el host de staging ni de producción."
case "$PGHOST" in
  *epgiglysldwoiulnwamf*) fail "Ese host es pruva-staging. La restauración de prueba va en un proyecto aparte." ;;
esac

propio=$(ls -1 "$src"/pruva-propio-*.dump 2> /dev/null | sort | tail -n 1)
conteos=$(ls -1 "$src"/pruva-conteos-*.txt 2> /dev/null | sort | tail -n 1)
auth=$(ls -1 "$src"/pruva-auth-storage-*.dump 2> /dev/null | sort | tail -n 1)
[ -n "$propio" ] || fail "No hay pruva-propio-*.dump en $src"
[ -n "$conteos" ] || fail "No hay pruva-conteos-*.txt en $src: sin él no hay contra qué comparar."
umask 077
out="$src/restauracion-$(date -u +%Y%m%dT%H%M%SZ).txt"
q() { psql -X -q -A -t -v ON_ERROR_STOP=1 -c "$1"; }
now() { date +%s; }

echo "▸ Destino: $PGHOST/$PGDATABASE"
ocupadas=$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where c.relkind in ('r','p') and n.nspname in ('public','app','audit','system')") ||
  fail "No se pudo conectar al destino."
[ "$ocupadas" = "0" ] || fail "El destino tiene $ocupadas tablas. Solo se restaura en una base vacía; no se tocó nada."

t0=$(now)
echo "▸ Extensiones y roles que el respaldo no trae"
for ext in pgcrypto pg_trgm btree_gin unaccent uuid-ossp pg_net; do
  if q "select 1 from pg_available_extensions where name = '$ext'" | grep -q 1; then
    q "create schema if not exists extensions; create extension if not exists \"$ext\" with schema extensions" > /dev/null 2>&1 ||
      q "create extension if not exists \"$ext\"" > /dev/null 2>&1 || echo "  ⚠ no se pudo activar $ext"
  else
    echo "  ⚠ $ext no está disponible en este servidor"
  fi
done
for role in storefront_gateway system_worker; do
  q "do \$\$ begin if not exists (select 1 from pg_roles where rolname = '$role') then
       create role $role nologin; end if; end \$\$" > /dev/null || echo "  ⚠ no se pudo crear el rol $role"
done

# Orden: (1) usuarios y buckets, porque 21 llaves foráneas de PRUVA apuntan a
# auth.users; (2) lo propio de PRUVA; (3) el trigger y las políticas que PRUVA pone
# sobre tablas de Supabase. Las filas de storage.objects NO se restauran: se
# recrean al subir los archivos desde la copia de imágenes.
: > "$out.pg_restore.log"
if [ -n "$auth" ]; then
  echo "▸ Restaurando usuarios y buckets de $(basename "$auth")"
  pg_restore --no-owner --data-only --table=users --table=identities --table=buckets \
    --dbname="$PGDATABASE" "$auth" 2>> "$out.pg_restore.log"
else
  echo "  ⚠ No hay pruva-auth-storage-*.dump: las llaves hacia usuarios fallarán"
fi
echo "▸ Restaurando $(basename "$propio")"
pg_restore --no-owner --dbname="$PGDATABASE" "$propio" 2>> "$out.pg_restore.log"
# Supabase concede por defecto permisos a anon, authenticated y service_role sobre
# todo objeto nuevo en public. pg_restore solo aplica los permisos del respaldo y
# no retira esos: la copia quedaría abierta. Se retiran y se vuelven a aplicar
# exactamente los del respaldo (las entradas ACL).
echo "▸ Restableciendo permisos exactos (quitando los que Supabase concede por defecto)"
q "do \$\$ declare s text; begin
     foreach s in array array['public','app','audit','private','storefront','system','supabase_migrations'] loop
       if exists (select 1 from pg_namespace where nspname = s) then
         execute format('revoke all on all tables in schema %I from anon, authenticated, service_role', s);
         execute format('revoke all on all sequences in schema %I from anon, authenticated, service_role', s);
         execute format('revoke all on all functions in schema %I from anon, authenticated, service_role', s);
       end if;
     end loop; end \$\$" > /dev/null 2>> "$out.pg_restore.log" ||
  echo "pg_restore: error: no se pudieron retirar los permisos por defecto" >> "$out.pg_restore.log"
pg_restore --list "$propio" | grep -E '^[0-9]+; [0-9]+ [0-9]+ ACL ' > "$out.acl.list"
pg_restore --no-owner --use-list="$out.acl.list" --dbname="$PGDATABASE" "$propio" 2>> "$out.pg_restore.log"
extras=$(ls -1 "$src"/pruva-extras-*.sql 2> /dev/null | sort | tail -n 1)
if [ -n "$extras" ]; then
  echo "▸ Aplicando $(basename "$extras")"
  psql -X -q -v ON_ERROR_STOP=1 -f "$extras" > /dev/null 2>> "$out.pg_restore.log" ||
    echo "pg_restore: error: no se aplicó $(basename "$extras")" >> "$out.pg_restore.log"
else
  echo "  ⚠ No hay pruva-extras-*.sql: falta el trigger de alta de usuarios y la política de subidas"
fi
# Inofensivo y siempre presente: Supabase ya trae el esquema public.
benignos='schema "public" already exists'
errores=$(grep 'error:' "$out.pg_restore.log" | grep -v -c -F "$benignos" || true)
t1=$(now)

echo "▸ Comparando contra lo medido al exportar"
estado=0
{
  echo "PRUVA · restauración de prueba (sin secretos)"
  echo "respaldo=$(basename "$propio")"
  echo "destino=$PGHOST/$PGDATABASE"
  echo "errores_pg_restore=$errores"
  esperada=$(grep '^app_schema_version=' "$conteos" | cut -d= -f2)
  obtenida=$(q "select public.app_schema_version()" 2> /dev/null)
  [ "$esperada" = "$obtenida" ] && m="✓" || { m="✗"; estado=1; }
  echo "$m versión de esquema: esperada=$esperada restaurada=$obtenida"

  q "with s(n) as (values ('public'),('app'),('audit'),('private'),('storefront'),('system'),('supabase_migrations'))
     select unnest(array[
      'TABLE=' || (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in (select n from s)),
      'FUNCTION=' || (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in (select n from s)),
      'TRIGGER=' || (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and t.tgparentid=0 and n.nspname in (select n from s)),
      'POLICY=' || (select count(*) from pg_policies where schemaname in (select n from s)),
      'ROW SECURITY=' || (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and c.relrowsecurity and n.nspname in (select n from s)),
      'FORCE RLS=' || (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and c.relforcerowsecurity and n.nspname in (select n from s)),
      'FK CONSTRAINT=' || (select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where c.contype='f' and c.conparentid=0 and n.nspname in (select n from s)),
      'EXTRA TRIGGER=' || (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace where not t.tgisinternal and n.nspname in ('auth','storage') and pn.nspname in (select n from s)),
      'EXTRA POLICY=' || (select count(*) from pg_policies where schemaname in ('auth','storage')),
      'PERMISOS ANON=' || (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p','v','m') and n.nspname in (select n from s) and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))),
      'FUNCIONES ANON=' || (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in (select n from s) and has_function_privilege('anon', p.oid, 'execute')),
      'PERMISOS SERVICE_ROLE=' || (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in (select n from s) and has_table_privilege('service_role', c.oid, 'select'))])" > "$out.catalogo"
  while IFS='=' read -r tipo valor; do
    esperado=$(grep "^catalogo:$tipo=" "$conteos" | cut -d= -f2)
    [ -z "$esperado" ] && continue
    [ "$esperado" = "$valor" ] && m="✓" || { m="✗"; estado=1; }
    printf '%s %-14s esperado=%s restaurado=%s\n' "$m" "$tipo" "$esperado" "$valor"
  done < "$out.catalogo"

  distintas=0; revisadas=0
  while IFS='=' read -r tabla filas; do
    case "$tabla" in public.*|app.*|audit.*|private.*|storefront.*|system.*) ;; *) continue ;; esac
    revisadas=$((revisadas + 1))
    obtenidas=$(q "select count(*) from $tabla" 2> /dev/null || echo "falta")
    if [ "$obtenidas" != "$filas" ]; then
      distintas=$((distintas + 1)); estado=1
      echo "✗ filas $tabla: esperadas=$filas restauradas=$obtenidas"
    fi
  done < <(grep -E '^[a-z_]+\.[a-z_0-9]+=' "$conteos")
  [ "$distintas" -eq 0 ] && echo "✓ filas idénticas en $revisadas tablas" || echo "✗ $distintas de $revisadas tablas con filas distintas"
  echo "tiempo_de_restauracion_s=$((t1 - t0))"
} > "$out"

[ "$errores" -gt 0 ] && { estado=1; echo "  Primeros errores de pg_restore:"; grep 'error:' "$out.pg_restore.log" | grep -v -F "$benignos" | grep -v 'errors ignored on restore' | head -n 10 | sed 's/^/    /'; }
cat "$out"
echo
if [ "$estado" -eq 0 ]; then
  echo "✓ RESTAURACIÓN PROBADA: la copia coincide con lo medido al exportar."
else
  echo "✗ La restauración no coincide. Revisa $out y $out.pg_restore.log."
  exit 1
fi
