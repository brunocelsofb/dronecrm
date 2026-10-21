-- Módulo Varejo — etapa 2: clientes (pessoa física) e pedidos.
--   - cliente: única por telefone dentro da empresa;
--   - situação calculada pelas compras pagas (e pelo histórico importado):
--     sem compra · ativa · sumiu (sem comprar há mais de N dias; padrão 90, ajustável);
--   - pedido: itens com preço gravado no momento da venda; estoque baixa só no "pago".

alter table contract_crm.organization_settings
  add column if not exists retail_settings jsonb not null default '{}'::jsonb;

create table if not exists contract_crm.retail_customers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references contract_crm.tenants(id) on delete cascade,
  name         text not null,
  phone        text,
  email        text,
  cpf          text,
  birth_date   date,
  city         text,
  state        text,
  cep          text,
  address      text,
  notes        text,
  source       text not null default 'manual' check (source in ('manual', 'planilha', 'vitrine')),
  whatsapp_optin boolean not null default false,
  optin_at     timestamptz,
  -- histórico de antes do CRM (planilha): conta para ativa/sumiu
  legacy_last_purchase_at date,
  legacy_total numeric(12,2) check (legacy_total is null or legacy_total >= 0),
  legacy_orders integer check (legacy_orders is null or legacy_orders >= 0),
  lead_id      uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists retail_customers_phone on contract_crm.retail_customers (tenant_id, phone) where phone is not null;
create index if not exists retail_customers_tenant on contract_crm.retail_customers (tenant_id, name);

create table if not exists contract_crm.retail_orders (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references contract_crm.tenants(id) on delete cascade,
  number         integer not null,
  customer_id    uuid references contract_crm.retail_customers(id) on delete set null,
  status         text not null default 'enviado_atendimento'
                 check (status in ('enviado_atendimento', 'aguardando_pagamento', 'pago', 'enviado', 'entregue', 'cancelado')),
  payment_method text check (payment_method in ('pix', 'cartao', 'dinheiro', 'outro')),
  payment_condition text,
  payment_link   text,
  subtotal       numeric(12,2) not null default 0 check (subtotal >= 0),
  discount       numeric(12,2) not null default 0 check (discount >= 0),
  shipping       numeric(12,2) not null default 0 check (shipping >= 0),
  total          numeric(12,2) not null default 0 check (total >= 0),
  delivery       jsonb not null default '{}'::jsonb,
  source         text not null default 'manual' check (source in ('manual', 'vitrine')),
  notes          text,
  stock_applied  boolean not null default false,
  paid_at        timestamptz,
  cancelled_at   timestamptz,
  contract_id    uuid,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, number)
);
create index if not exists retail_orders_tenant_status on contract_crm.retail_orders (tenant_id, status, created_at desc);
create index if not exists retail_orders_customer on contract_crm.retail_orders (customer_id);

create table if not exists contract_crm.retail_order_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references contract_crm.tenants(id) on delete cascade,
  order_id    uuid not null references contract_crm.retail_orders(id) on delete cascade,
  product_id  uuid references contract_crm.retail_products(id) on delete set null,
  variant_id  uuid references contract_crm.retail_product_variants(id) on delete set null,
  code        text not null,
  name        text not null,
  sku         text,
  color       text,
  size        text,
  qty         integer not null check (qty > 0),
  unit_price  numeric(12,2) not null check (unit_price >= 0),
  total       numeric(12,2) not null check (total >= 0)
);
create index if not exists retail_order_items_order on contract_crm.retail_order_items (order_id);

-- Regras de toda tabela de empresa
do $$
declare t text;
begin
  foreach t in array array['retail_customers', 'retail_orders', 'retail_order_items'] loop
    execute format('alter table contract_crm.%I enable row level security', t);
    execute format('revoke all on contract_crm.%I from anon', t);
    execute format('create policy tenant_guard on contract_crm.%I as restrictive for all to authenticated using (tenant_id = contract_crm.current_tenant_id()) with check (tenant_id = contract_crm.current_tenant_id())', t);
    execute format('create policy tenant_access on contract_crm.%I for all to authenticated using (tenant_id = contract_crm.current_tenant_id()) with check (tenant_id = contract_crm.current_tenant_id())', t);
    execute format('create policy support_readonly_ins on contract_crm.%I as restrictive for insert to authenticated with check (not contract_crm.in_support_session())', t);
    execute format('create policy support_readonly_upd on contract_crm.%I as restrictive for update to authenticated using (not contract_crm.in_support_session()) with check (not contract_crm.in_support_session())', t);
    execute format('create policy support_readonly_del on contract_crm.%I as restrictive for delete to authenticated using (not contract_crm.in_support_session())', t);
    execute format('create trigger trg_set_tenant_id before insert on contract_crm.%I for each row execute function contract_crm.set_tenant_id()', t);
  end loop;
end $$;

-- Pedido, cliente e itens sempre da mesma empresa
create or replace function contract_crm.retail_order_links_check() returns trigger
language plpgsql security definer set search_path = contract_crm, pg_temp as $$
declare t uuid;
begin
  if tg_table_name = 'retail_orders' then
    if new.customer_id is not null then
      select tenant_id into t from contract_crm.retail_customers where id = new.customer_id;
      if t is distinct from new.tenant_id then raise exception 'Cliente de outra empresa.' using errcode = '42501'; end if;
    end if;
  else
    select tenant_id into t from contract_crm.retail_orders where id = new.order_id;
    if t is null then raise exception 'Pedido não encontrado.'; end if;
    if new.tenant_id is null then new.tenant_id := t; end if;
    if new.tenant_id <> t then raise exception 'Item de outra empresa.' using errcode = '42501'; end if;
    if new.variant_id is not null and not exists (select 1 from contract_crm.retail_product_variants v where v.id = new.variant_id and v.tenant_id = t) then
      raise exception 'Variação de outra empresa.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger trg_retail_order_links before insert or update on contract_crm.retail_orders
  for each row execute function contract_crm.retail_order_links_check();
create trigger trg_retail_item_links before insert or update on contract_crm.retail_order_items
  for each row execute function contract_crm.retail_order_links_check();

-- Número do pedido sequencial por empresa
create or replace function contract_crm.retail_next_order_number(p_tenant uuid) returns integer
language plpgsql security definer set search_path = contract_crm, pg_temp as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtext('retail_order_number'), hashtext(p_tenant::text));
  select coalesce(max(number), 0) + 1 into n from contract_crm.retail_orders where tenant_id = p_tenant;
  return n;
end $$;
revoke all on function contract_crm.retail_next_order_number(uuid) from public, anon, authenticated;

-- Baixa/devolução de estoque de um pedido (uma vez), em transação.
-- p_apply = true baixa (falha se faltar estoque); false devolve o que foi baixado.
create or replace function contract_crm.retail_apply_order_stock(p_order uuid, p_tenant uuid, p_apply boolean) returns text
language plpgsql security definer set search_path = contract_crm, pg_temp as $$
declare o record; it record; left_ integer;
begin
  select id, tenant_id, stock_applied into o from contract_crm.retail_orders where id = p_order and tenant_id = p_tenant for update;
  if not found then return 'Pedido não encontrado.'; end if;
  if p_apply = o.stock_applied then return null; end if;
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
  return null;
end $$;
revoke all on function contract_crm.retail_apply_order_stock(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function contract_crm.retail_next_order_number(uuid) to service_role;
grant execute on function contract_crm.retail_apply_order_stock(uuid, uuid, boolean) to service_role;
