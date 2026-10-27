-- Varejo: separar uma variação que veio com várias cores/tamanhos numa linha
-- (ex.: cor "Dark Blue / Mocha Mousse", tamanho "G / G") em variações certas.
-- Tudo ou nada; o estoque muda pelo histórico ("ajuste", nota da separação).
-- p_rows: [{ "color": "...", "size": "...", "qty": 1, "sku": "..." }]
create or replace function contract_crm.retail_split_variant(p_tenant uuid, p_user uuid, p_variant uuid, p_rows jsonb)
returns text language plpgsql security definer set search_path to 'contract_crm', 'pg_temp' as $function$
declare v record; r jsonb; c text; s text; q int; k text; base_sku text; n int; hit record; nid uuid;
begin
  select * into v from contract_crm.retail_product_variants where id = p_variant and tenant_id = p_tenant for update;
  if not found then return 'Variação não encontrada.'; end if;
  if exists (select 1 from contract_crm.retail_order_items where variant_id = v.id) then return 'Esta linha já tem pedido; não dá para separar.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 'Informe as linhas.'; end if;

  perform set_config('retail.stock_kind', 'ajuste', true);
  perform set_config('retail.stock_user', coalesce(p_user::text, ''), true);
  perform set_config('retail.stock_note', 'separação de cores e tamanhos', true);

  -- tira a linha antiga (estoque vai a zero no histórico)
  update contract_crm.retail_product_variants set stock = 0, updated_at = now() where id = v.id;
  delete from contract_crm.retail_product_variants where id = v.id;

  for r in select * from jsonb_array_elements(p_rows) loop
    c := nullif(left(trim(coalesce(r->>'color', '')), 60), '');
    s := nullif(left(trim(coalesce(r->>'size', '')), 20), '');
    q := (r->>'qty')::int;
    if q is null or q < 0 or q > 100000 then raise exception 'Quantidade inválida.'; end if;
    select * into hit from contract_crm.retail_product_variants where product_id = v.product_id and color is not distinct from c and size is not distinct from s;
    if found then
      update contract_crm.retail_product_variants set stock = stock + q, active = true, updated_at = now() where id = hit.id;
    else
      base_sku := left(upper(coalesce(nullif(trim(r->>'sku'), ''), v.sku || '-X')), 60);
      k := base_sku; n := 1;
      while exists (select 1 from contract_crm.retail_product_variants where tenant_id = p_tenant and sku = k) loop
        n := n + 1; k := left(base_sku, 56) || '-' || n;
      end loop;
      insert into contract_crm.retail_product_variants (tenant_id, product_id, sku, color, size, stock, active, price, promo_price)
        values (p_tenant, v.product_id, k, c, s, 0, v.active, v.price, v.promo_price) returning id into nid;
      if q > 0 then update contract_crm.retail_product_variants set stock = q, updated_at = now() where id = nid; end if;
    end if;
  end loop;

  -- foto marcada com a cor antiga (que deixou de existir) passa a valer para todas as cores
  if v.color is not null then
    update contract_crm.retail_products set photo_meta = coalesce((
      select jsonb_object_agg(key, case when value->>'color' = v.color then jsonb_set(value, '{color}', 'null'::jsonb) else value end)
      from jsonb_each(photo_meta)), '{}'::jsonb), updated_at = now()
    where id = v.product_id;
  end if;

  perform set_config('retail.stock_kind', '', true);
  perform set_config('retail.stock_user', '', true);
  perform set_config('retail.stock_note', '', true);
  return null;
end $function$;
revoke all on function contract_crm.retail_split_variant(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function contract_crm.retail_split_variant(uuid, uuid, uuid, jsonb) to service_role;
