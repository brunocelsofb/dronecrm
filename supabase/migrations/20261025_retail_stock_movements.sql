-- Varejo: histórico do estoque. Toda mudança de saldo de uma variação vira uma linha
-- (venda, cancelamento, entrada de mercadoria, contagem, importação, ajuste à mão).
-- O gatilho registra sempre; o motivo e quem fez vêm da transação (set_config local).

create table if not exists contract_crm.retail_stock_movements (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references contract_crm.tenants(id) on delete cascade,
  variant_id  uuid references contract_crm.retail_product_variants(id) on delete set null,
  product_id  uuid references contract_crm.retail_products(id) on delete set null,
  sku         text,
  kind        text not null,
  delta       integer not null,
  before_qty  integer not null,
  after_qty   integer not null,
  order_id    uuid,
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists retail_stock_movements_tenant on contract_crm.retail_stock_movements (tenant_id, created_at desc);
create index if not exists retail_stock_movements_product on contract_crm.retail_stock_movements (product_id, created_at desc);

do $$
declare t text := 'retail_stock_movements';
begin
  execute format('alter table contract_crm.%I enable row level security', t);
  execute format('revoke all on contract_crm.%I from anon', t);
  execute format('create policy tenant_guard on contract_crm.%I as restrictive for all to authenticated using (tenant_id = contract_crm.current_tenant_id()) with check (tenant_id = contract_crm.current_tenant_id())', t);
  execute format('create policy tenant_access on contract_crm.%I for all to authenticated using (tenant_id = contract_crm.current_tenant_id()) with check (tenant_id = contract_crm.current_tenant_id())', t);
  execute format('create policy support_readonly_ins on contract_crm.%I as restrictive for insert to authenticated with check (not contract_crm.in_support_session())', t);
  execute format('create policy support_readonly_upd on contract_crm.%I as restrictive for update to authenticated using (not contract_crm.in_support_session()) with check (not contract_crm.in_support_session())', t);
  execute format('create policy support_readonly_del on contract_crm.%I as restrictive for delete to authenticated using (not contract_crm.in_support_session())', t);
  execute format('create trigger trg_set_tenant_id before insert on contract_crm.%I for each row execute function contract_crm.set_tenant_id()', t);
end $$;

create or replace function contract_crm.retail_variant_stock_log() returns trigger
language plpgsql security definer set search_path = contract_crm, pg_temp as $$
declare k text; o text; u text; n text; b integer;
begin
  b := case when tg_op = 'INSERT' then 0 else old.stock end;
  if new.stock = b then return new; end if;
  k := nullif(current_setting('retail.stock_kind', true), '');
  o := nullif(current_setting('retail.stock_order', true), '');
  u := nullif(current_setting('retail.stock_user', true), '');
  n := nullif(current_setting('retail.stock_note', true), '');
  insert into contract_crm.retail_stock_movements (tenant_id, variant_id, product_id, sku, kind, delta, before_qty, after_qty, order_id, note, created_by)
  values (new.tenant_id, new.id, new.product_id, new.sku, coalesce(k, case when tg_op = 'INSERT' then 'cadastro' else 'ajuste' end),
          new.stock - b, b, new.stock, o::uuid, n, u::uuid);
  return new;
end $$;

drop trigger if exists trg_retail_variant_stock_log on contract_crm.retail_product_variants;
create trigger trg_retail_variant_stock_log after insert or update of stock on contract_crm.retail_product_variants
  for each row execute function contract_crm.retail_variant_stock_log();

-- Venda e cancelamento: o histórico mostra o pedido
create or replace function contract_crm.retail_apply_order_stock(p_order uuid, p_tenant uuid, p_apply boolean)
 returns text language plpgsql security definer set search_path to 'contract_crm', 'pg_temp' as $function$
declare o record; it record; left_ integer;
begin
  select id, tenant_id, stock_applied into o from contract_crm.retail_orders where id = p_order and tenant_id = p_tenant for update;
  if not found then return 'Pedido não encontrado.'; end if;
  if p_apply = o.stock_applied then return null; end if;
  perform set_config('retail.stock_kind', case when p_apply then 'venda' else 'cancelamento' end, true);
  perform set_config('retail.stock_order', p_order::text, true);
  for it in select variant_id, sum(qty)::int qty, max(sku) sku from contract_crm.retail_order_items where order_id = p_order and variant_id is not null group by variant_id loop
    if p_apply then
      update contract_crm.retail_product_variants set stock = stock - it.qty, updated_at = now()
        where id = it.variant_id and tenant_id = p_tenant and stock >= it.qty returning stock into left_;
      if not found then raise exception 'Estoque insuficiente para %.', coalesce(it.sku, 'uma variação'); end if;
    else
      update contract_crm.retail_product_variants set stock = stock + it.qty, updated_at = now()
        where id = it.variant_id and tenant_id = p_tenant;
    end if;
  end loop;
  update contract_crm.retail_orders set stock_applied = p_apply, updated_at = now() where id = p_order;
  perform set_config('retail.stock_kind', '', true);
  perform set_config('retail.stock_order', '', true);
  return null;
end $function$;

-- Mudança de saldo em lote (entrada soma; contagem/ajuste/importação define), num só passo
-- p_rows: [{ "variant_id": uuid, "mode": "add" | "set", "qty": int }]
create or replace function contract_crm.retail_stock_batch(p_tenant uuid, p_user uuid, p_kind text, p_note text, p_rows jsonb)
 returns text language plpgsql security definer set search_path to 'contract_crm', 'pg_temp' as $function$
declare r jsonb; v uuid; q integer; m text;
begin
  if p_kind not in ('entrada', 'contagem', 'ajuste', 'importacao', 'cadastro') then return 'Tipo de movimento inválido.'; end if;
  perform set_config('retail.stock_kind', p_kind, true);
  perform set_config('retail.stock_user', coalesce(p_user::text, ''), true);
  perform set_config('retail.stock_note', coalesce(left(p_note, 300), ''), true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v := (r->>'variant_id')::uuid; q := (r->>'qty')::integer; m := r->>'mode';
    if q is null or q < 0 or q > 1000000 then raise exception 'Quantidade inválida.'; end if;
    if m = 'add' then
      update contract_crm.retail_product_variants set stock = stock + q, updated_at = now() where id = v and tenant_id = p_tenant;
    elsif m = 'set' then
      update contract_crm.retail_product_variants set stock = q, updated_at = now() where id = v and tenant_id = p_tenant;
    else
      raise exception 'Modo inválido.';
    end if;
    if not found then raise exception 'Variação não encontrada.'; end if;
  end loop;
  perform set_config('retail.stock_kind', '', true);
  perform set_config('retail.stock_user', '', true);
  perform set_config('retail.stock_note', '', true);
  return null;
end $function$;
revoke all on function contract_crm.retail_stock_batch(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function contract_crm.retail_stock_batch(uuid, uuid, text, text, jsonb) to service_role;
