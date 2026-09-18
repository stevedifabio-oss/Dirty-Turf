-- Foreign-key deletes and joins must not fall back to full table scans once
-- the Academy member and content import is live. Existing indexes whose
-- leading columns already cover a foreign key are left untouched.
do $$
declare
  foreign_key record;
  index_name text;
begin
  for foreign_key in
    select
      namespace.nspname as schema_name,
      relation.relname as table_name,
      constraint_row.conname as constraint_name,
      string_agg(format('%I', attribute.attname), ', ' order by key_column.ordinality) as column_list
    from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    cross join lateral unnest(constraint_row.conkey) with ordinality as key_column(attnum, ordinality)
    join pg_attribute attribute
      on attribute.attrelid = constraint_row.conrelid
     and attribute.attnum = key_column.attnum
    where constraint_row.contype = 'f'
      and namespace.nspname = 'public'
      and not exists (
        select 1
        from pg_index existing_index
        where existing_index.indrelid = constraint_row.conrelid
          and existing_index.indisvalid
          and (existing_index.indkey::smallint[])[0:cardinality(constraint_row.conkey)-1] = constraint_row.conkey
      )
    group by namespace.nspname, relation.relname, constraint_row.conname
    order by relation.relname, constraint_row.conname
  loop
    index_name := left(foreign_key.table_name, 35)
      || '_' || substr(md5(foreign_key.constraint_name), 1, 12) || '_fk_idx';
    execute format(
      'create index if not exists %I on %I.%I (%s)',
      index_name,
      foreign_key.schema_name,
      foreign_key.table_name,
      foreign_key.column_list
    );
  end loop;
end
$$;
