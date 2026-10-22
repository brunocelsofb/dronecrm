-- Varejo: custo da peça, margem por pedido e fidelidade (cashback em roupas,
-- "a cada R$ X ganha Y%" e desconto progressivo). Só acréscimos.
-- Configurações (custos da loja, margem desejada, custos fixos e a fidelidade
-- escolhida) ficam em organization_settings.retail_settings (pricing, loyalty).

alter table contract_crm.retail_products
  add column if not exists cost_price numeric(12,2) check (cost_price is null or cost_price >= 0);

-- Custo gravado no item no momento da venda (a margem do pedido não muda se o custo mudar depois)
alter table contract_crm.retail_order_items
  add column if not exists unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0);

alter table contract_crm.retail_orders
  add column if not exists loyalty_discount numeric(12,2) not null default 0 check (loyalty_discount >= 0),
  add column if not exists loyalty_kind text check (loyalty_kind is null or loyalty_kind in ('cashback', 'cada_x', 'progressivo')),
  add column if not exists loyalty_base numeric(12,2) not null default 0 check (loyalty_base >= 0),
  add column if not exists loyalty_earned numeric(12,2) not null default 0 check (loyalty_earned >= 0);

-- Extrato do cashback (crédito em roupas, com validade; nunca vira dinheiro)
create table if not exists contract_crm.retail_loyalty_entries (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references contract_crm.tenants(id) on delete cascade,
  customer_id uuid not null references contract_crm.retail_customers(id) on delete cascade,
  order_id    uuid references contract_crm.retail_orders(id) on delete cascade,
  kind        text not null check (kind in ('credito', 'uso')),
  amount      numeric(12,2) not null check (amount > 0),
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (kind <> 'credito' or expires_at is not null)
);
create index if not exists retail_loyalty_entries_customer on contract_crm.retail_loyalty_entries (tenant_id, customer_id);
create index if not exists retail_loyalty_entries_order on contract_crm.retail_loyalty_entries (order_id);

alter table contract_crm.retail_loyalty_entries enable row level security;
revoke all on contract_crm.retail_loyalty_entries from anon;
create policy tenant_guard on contract_crm.retail_loyalty_entries as restrictive for all to authenticated
  using (tenant_id = contract_crm.current_tenant_id()) with check (tenant_id = contract_crm.current_tenant_id());
create policy tenant_access on contract_crm.retail_loyalty_entries for all to authenticated
  using (tenant_id = contract_crm.current_tenant_id()) with check (tenant_id = contract_crm.current_tenant_id());
create policy support_readonly_ins on contract_crm.retail_loyalty_entries as restrictive for insert to authenticated
  with check (not contract_crm.in_support_session());
create policy support_readonly_upd on contract_crm.retail_loyalty_entries as restrictive for update to authenticated
  using (not contract_crm.in_support_session()) with check (not contract_crm.in_support_session());
create policy support_readonly_del on contract_crm.retail_loyalty_entries as restrictive for delete to authenticated
  using (not contract_crm.in_support_session());
create trigger trg_set_tenant_id before insert on contract_crm.retail_loyalty_entries
  for each row execute function contract_crm.set_tenant_id();

-- Cliente e pedido do extrato sempre da mesma empresa
create or replace function contract_crm.retail_loyalty_links_check() returns trigger
language plpgsql security definer set search_path = contract_crm, pg_temp as $$
begin
  -- roda antes de trg_set_tenant_id (ordem alfabética): sem empresa, herda da cliente
  if new.tenant_id is null then
    select tenant_id into new.tenant_id from contract_crm.retail_customers where id = new.customer_id;
  end if;
  if not exists (select 1 from contract_crm.retail_customers c where c.id = new.customer_id and c.tenant_id = new.tenant_id) then
    raise exception 'Cliente de outra empresa.' using errcode = '42501';
  end if;
  if new.order_id is not null and not exists (select 1 from contract_crm.retail_orders o where o.id = new.order_id and o.tenant_id = new.tenant_id) then
    raise exception 'Pedido de outra empresa.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_retail_loyalty_links before insert or update on contract_crm.retail_loyalty_entries
  for each row execute function contract_crm.retail_loyalty_links_check();
