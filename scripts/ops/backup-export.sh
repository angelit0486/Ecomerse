#!/usr/bin/env bash
# =============================================================================
# Respaldo de PostgreSQL de PRUVA en un solo comando (Orden de trabajo 05).
#
# Se ejecuta en la computadora del propietario; el respaldo nunca sale de ella.
#   1. Comprueba que pg_dump/pg_restore sean versión 17 o mayor.
#   2. Exporta lo propio de PRUVA (7 esquemas) y, solo datos, usuarios y el
#      catálogo de Storage. Formato custom, sin dueños, con permisos.
#   3. Toma los conteos de filas por tabla (para comparar al restaurar).
#   4. Verifica: tamaño, SHA-256, lectura completa, lista de objetos y advertencias.
#   5. Escribe evidencia.txt, que no contiene secretos y se puede compartir.
#
# Credenciales: usa las variables PGHOST, PGPORT, PGUSER, PGDATABASE y
# PGSSLMODE. La contraseña NO va en el comando ni en ninguna variable: la pide
# cada herramienta al conectarse (3 veces) o la toma de ~/.pgpass si existe.
#
# Uso:  bash backup-export.sh <carpeta-de-destino>
# =============================================================================
set -uo pipefail

dest="${1:-}"
if [ -z "$dest" ]; then
  echo "Uso: bash backup-export.sh <carpeta-de-destino>" >&2
  exit 2
fi

fail() { echo "✗ $*" >&2; exit 1; }

# --- Seguridad: nada de contraseñas en variables ni respaldos dentro de Git ---
[ -n "${PGPASSWORD:-}" ] && fail "PGPASSWORD está definida. Quítala (unset PGPASSWORD): la contraseña se escribe cuando se pida."
for v in PGHOST PGUSER; do
  [ -n "${!v:-}" ] || fail "Falta la variable $v (ver la guía, paso 3)."
done
: "${PGPORT:=5432}" "${PGDATABASE:=postgres}" "${PGSSLMODE:=require}"
export PGPORT PGDATABASE PGSSLMODE
[ "$PGPORT" = "6543" ] && fail "El puerto 6543 (modo transacción) no sirve para pg_dump. Usa el pooler de sesión, puerto 5432."

mkdir -p "$dest" || fail "No se pudo crear $dest"
dest="$(cd "$dest" && pwd)"
if git -C "$dest" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  fail "$dest está dentro de un repositorio de Git. Elige una carpeta privada fuera de cualquier repositorio."
fi
chmod 700 "$dest" 2> /dev/null || true
cd "$dest" || exit 1
umask 077

# --- Herramientas ---
# MIN_PG_MAJOR solo existe para probar el script contra una base local más vieja;
# contra Supabase (PostgreSQL 17) déjalo sin definir.
min_major="${MIN_PG_MAJOR:-17}"
major() { "$1" --version 2> /dev/null | sed -E 's/.* ([0-9]+)(\.[0-9]+)*.*/\1/' | head -n 1; }
for tool in pg_dump pg_restore psql; do
  command -v "$tool" > /dev/null || fail "No se encontró $tool. Instala el cliente de PostgreSQL 17 (guía, paso 1)."
  m=$(major "$tool")
  [ -n "$m" ] && [ "$m" -ge "$min_major" ] || fail "$tool es versión $m; se necesita $min_major o mayor (el servidor es 17)."
done
if command -v sha256sum > /dev/null; then sha() { sha256sum "$1" | cut -d' ' -f1; }
else sha() { shasum -a 256 "$1" | cut -d' ' -f1; }; fi
bytes() { wc -c < "$1" | tr -d ' '; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
propio="pruva-propio-$stamp.dump"
auth="pruva-auth-storage-$stamp.dump"
conteos="pruva-conteos-$stamp.txt"
ev="evidencia-$stamp.txt"

echo "▸ Exportando lo propio de PRUVA (te pedirá la contraseña)"
pg_dump --format=custom --no-owner --verbose \
  --schema=public --schema=app --schema=audit --schema=private \
  --schema=storefront --schema=system --schema=supabase_migrations \
  --file="$propio" 2> "${propio%.dump}.log"
r1=$?

echo "▸ Exportando usuarios y catálogo de Storage, solo datos (otra vez la contraseña)"
pg_dump --format=custom --data-only --no-owner --verbose \
  --table=auth.users --table=auth.identities \
  --table=storage.buckets --table=storage.objects \
  --file="$auth" 2> "${auth%.dump}.log"
r2=$?

extras="pruva-extras-$stamp.sql"
consulta="consulta-$stamp.sql"
# Una sola conexión para tres cosas: conteos de filas, conteos del catálogo y
# los objetos que nuestras migraciones ponen sobre tablas de Supabase (el
# trigger de alta de perfil en auth.users y las políticas de storage.objects).
# Un respaldo por esquemas no los incluye; sin ellos un PRUVA restaurado no
# registra usuarios ni sube imágenes.
cat > "$consulta" <<SQL
\\o $conteos
select format('%I.%I', schemaname, relname) || '=' ||
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname),
                                            false, true, '')))[1]::text
  from pg_stat_user_tables
 where schemaname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
    or (schemaname = 'auth' and relname in ('users', 'identities'))
    or (schemaname = 'storage' and relname in ('buckets', 'objects'))
 order by 1;
with s(n) as (values ('public'), ('app'), ('audit'), ('private'), ('storefront'), ('system'),
                     ('supabase_migrations'))
select unnest(array[
  'catalogo:TABLE=' || (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                          where c.relkind in ('r', 'p') and n.nspname in (select n from s)),
  'catalogo:FUNCTION=' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname in (select n from s)),
  'catalogo:TRIGGER=' || (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
                            join pg_namespace n on n.oid = c.relnamespace
                           where not t.tgisinternal and t.tgparentid = 0 and n.nspname in (select n from s)),
  'catalogo:POLICY=' || (select count(*) from pg_policies where schemaname in (select n from s)),
  'catalogo:ROW SECURITY=' || (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                 where c.relkind in ('r', 'p') and c.relrowsecurity
                                   and n.nspname in (select n from s)),
  'catalogo:FORCE RLS=' || (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                              where c.relkind in ('r', 'p') and c.relforcerowsecurity
                                and n.nspname in (select n from s)),
  'catalogo:FK CONSTRAINT=' || (select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace
                                  where c.contype = 'f' and c.conparentid = 0 and n.nspname in (select n from s)),
  'catalogo:EXTRA TRIGGER=' || (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
                                  join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid
                                  join pg_namespace pn on pn.oid = p.pronamespace
                                 where not t.tgisinternal and n.nspname in ('auth', 'storage')
                                   and pn.nspname in (select n from s)),
  'catalogo:EXTRA POLICY=' || (select count(*) from pg_policies where schemaname in ('auth', 'storage')),
  'catalogo:PERMISOS ANON=' || (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                  where c.relkind in ('r', 'p', 'v', 'm') and n.nspname in (select n from s)
                                    and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
                                         or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))),
  'catalogo:FUNCIONES ANON=' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                   where n.nspname in (select n from s) and has_function_privilege('anon', p.oid, 'execute')),
  'catalogo:PERMISOS SERVICE_ROLE=' || (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                          where c.relkind in ('r', 'p') and n.nspname in (select n from s)
                                            and has_table_privilege('service_role', c.oid, 'select'))]);
select 'app_schema_version=' || public.app_schema_version();
select 'server_version=' || current_setting('server_version');
select 'tomado_utc=' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
\\o $extras
select '-- Objetos de PRUVA sobre tablas de Supabase. Se aplican DESPUÉS de restaurar el respaldo.';
select pg_get_triggerdef(t.oid) || ';'
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
 where not t.tgisinternal and n.nspname in ('auth', 'storage')
   and pn.nspname in ('public', 'app', 'audit', 'private', 'storefront', 'system')
 order by 1;
select format('create policy %I on %I.%I as %s for %s to %s%s%s;', policyname, schemaname, tablename,
              permissive, cmd, array_to_string(array(select quote_ident(r) from unnest(roles) r), ', '),
              coalesce(' using (' || qual || ')', ''), coalesce(' with check (' || with_check || ')', ''))
  from pg_policies where schemaname in ('auth', 'storage') order by 1;
\\o
SQL
echo "▸ Conteos y objetos sobre tablas de Supabase (una tercera vez)"
psql -X -q -A -t -v ON_ERROR_STOP=1 -f "$consulta"
r3=$?
rm -f "$consulta"

[ "$r1" -eq 0 ] || fail "La exportación principal falló (código $r1). Revisa ${propio%.dump}.log y no conserves $propio."
[ "$r2" -eq 0 ] || fail "La exportación de usuarios y Storage falló (código $r2). Revisa ${auth%.dump}.log."
[ "$r3" -eq 0 ] || echo "  ⚠ No se pudieron tomar los conteos (código $r3); el respaldo sigue siendo válido."

echo "▸ Verificando"
estado=0
for f in "$propio" "$auth"; do
  [ -s "$f" ] || { echo "  ✗ $f está vacío"; estado=1; }
  if pg_restore --file=/dev/null "$f" 2> "$f.lectura.log"; then echo "  ✓ $f se lee completo"
  else echo "  ✗ $f no se puede leer completo (ver $f.lectura.log)"; estado=1; fi
  pg_restore --list "$f" > "${f%.dump}.lista.txt" 2> /dev/null || estado=1
done

# Cada renglón de la lista es «id; oid oid TIPO esquema nombre dueño»: se cuenta
# por el TIPO exacto, para que «ACL … FUNCTION» no cuente como función.
# «TABLE DATA», «TABLE ATTACH» e «INDEX ATTACH» son tipos aparte.
cuenta() {
  grep -E "^[0-9]+; [0-9]+ [0-9]+ $1 " "${propio%.dump}.lista.txt" |
    grep -c -v -E "^[0-9]+; [0-9]+ [0-9]+ $1 (DATA|ATTACH) " || true
}
advertencias=$(grep -h -i -E 'warning|error' "${propio%.dump}.log" "${auth%.dump}.log" 2> /dev/null || true)

{
  echo "PRUVA · evidencia del respaldo de PostgreSQL (sin secretos)"
  echo "generado_utc=$stamp"
  echo "sistema=$(uname -s) $(uname -m)"
  echo "E1 pg_dump=$(pg_dump --version)"
  echo "E2 resultado_propio=$r1 resultado_auth_storage=$r2 resultado_conteos=$r3"
  for f in "$propio" "$auth"; do
    echo "E3 $f bytes=$(bytes "$f") fecha=$(date -u -r "$f" +%FT%TZ 2> /dev/null || date -u +%FT%TZ)"
    echo "E4 $f sha256=$(sha "$f")"
  done
  echo "E5 lectura_completa=$([ "$estado" -eq 0 ] && echo ok || echo FALLA)"
  echo "E6 encabezado:"
  head -n 15 "${propio%.dump}.lista.txt" | grep -v '^;$' | sed 's/^/   /'
  echo "E7 conteos de la lista:"
  for t in 'SCHEMA' 'TABLE' 'TABLE DATA' 'INDEX' 'CONSTRAINT' 'FK CONSTRAINT' \
           'FUNCTION' 'TRIGGER' 'POLICY' 'ROW SECURITY' 'ACL'; do
    printf '   %-16s %s\n' "$t" "$(cuenta "$t")"
  done
  echo "   TABLE DATA (auth y storage): $(grep -c -E '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA ' "${auth%.dump}.lista.txt" || true)"
  echo "E8 advertencias=$([ -z "$advertencias" ] && echo ninguna || echo "$advertencias" | wc -l | tr -d ' ')"
  [ -n "$advertencias" ] && echo "$advertencias" | sed 's/^/   /'
  if grep -q '^catalogo:' "$conteos" 2> /dev/null; then
    echo "E9 lista contra el catálogo al exportar:"
    for t in 'TABLE' 'FUNCTION' 'TRIGGER' 'POLICY' 'ROW SECURITY' 'FK CONSTRAINT'; do
      esperado=$(grep "^catalogo:$t=" "$conteos" | cut -d= -f2)
      obtenido=$(cuenta "$t")
      [ "$esperado" = "$obtenido" ] && marca="✓" || { marca="✗"; estado=1; }
      printf '   %s %-14s catálogo=%s respaldo=%s\n' "$marca" "$t" "$esperado" "$obtenido"
    done
  fi
  if [ -s "$extras" ]; then
    echo "E10 objetos sobre tablas de Supabase: triggers=$(grep -c '^CREATE TRIGGER' "$extras" || true) políticas=$(grep -c '^create policy' "$extras" || true) (catálogo: $(grep -E '^catalogo:EXTRA (TRIGGER|POLICY)=' "$conteos" | cut -d= -f2 | paste -sd/ -))"
    echo "extras_sha256=$(sha "$extras")"
    echo "E11 seguridad al exportar: $(grep -E '^catalogo:(PERMISOS ANON|FUNCIONES ANON|PERMISOS SERVICE_ROLE)=' "$conteos" | sed 's/^catalogo://' | paste -sd' ' -)"
  fi
  if [ -s "$conteos" ]; then
    echo "conteos_sha256=$(sha "$conteos")"
    grep -E '^(app_schema_version|server_version|tomado_utc)=' "$conteos" | sed 's/^/   /'
    echo "   tablas_contadas=$(grep -c -E '^[a-z_]+\.' "$conteos") filas_totales=$(grep -E '^[a-z_]+\.' "$conteos" | awk -F= '{s+=$2} END {print s}')"
  fi
} > "$ev"

echo
cat "$ev"
echo
if [ "$estado" -eq 0 ]; then
  echo "✓ EXPORTACIÓN COMPLETADA e INTEGRIDAD DEL ARCHIVO VERIFICADA."
  echo "  Falta: que revise el contenido con tu evidencia y, después, la restauración de prueba."
  echo "  Comparte solo $ev. No compartas los .dump ni las bitácoras."
else
  echo "✗ El respaldo tiene fallas: no lo conserves como respaldo."
  exit 1
fi
