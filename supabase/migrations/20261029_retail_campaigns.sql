-- Varejo: campanhas da loja (base de clientes e link para divulgar).
-- A campanha tem um link próprio da vitrine (?c=codigo); o pedido feito por ele, ou por cliente que
-- recebeu a mensagem da campanha nos últimos 7 dias, fica marcado com a campanha.
create table if not exists contract_crm.retail_campaigns (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references contract_crm.tenants(id) on delete cascade,
  name            text not null,
  code            text not null,
  audience        text not null default 'nenhum',
  audience_params jsonb not null default '{}'::jsonb,
  message         text,
  investment      numeric(12,2) not null default 0,
  status          text not null default 'ativa' check (status in ('ativa', 'encerrada')),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, code)
);
create table if not exists contract_crm.retail_campaign_sends (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references contract_crm.tenants(id) on delete cascade,
  campaign_id  uuid not null references contract_crm.retail_campaigns(id) on delete cascade,
  customer_id  uuid not null references contract_crm.retail_customers(id) on delete cascade,
  status       text not null default 'enviada' check (status in ('enviada', 'descartada')),
  channel      text,
  message      text,
  sent_by      uuid,
  sent_at      timestamptz not null default now(),
  unique (campaign_id, customer_id)
);
create index if not exists retail_campaign_sends_customer on contract_crm.retail_campaign_sends (customer_id, sent_at desc);
alter table contract_crm.retail_orders add column if not exists campaign_id uuid references contract_crm.retail_campaigns(id) on delete set null;
create index if not exists retail_orders_campaign on contract_crm.retail_orders (campaign_id) where campaign_id is not null;

do $$
declare t text;
begin
  foreach t in array array['retail_campaigns', 'retail_campaign_sends'] loop
    execute format('alter table contract_crm.%I enable row level security', t);
    execute format('revoke all on contract_crm.%I from anon', t);
    execute format('drop policy if exists tenant_guard on contract_crm.%I', t);
    execute format('create policy tenant_guard on contract_crm.%I as restrictive for all to authenticated using (tenant_id = contract_crm.current_tenant_id()) with check (tenant_id = contract_crm.current_tenant_id())', t);
    execute format('drop policy if exists tenant_access on contract_crm.%I', t);
    execute format('create policy tenant_access on contract_crm.%I for all to authenticated using (tenant_id = contract_crm.current_tenant_id()) with check (tenant_id = contract_crm.current_tenant_id())', t);
    execute format('drop policy if exists support_readonly_ins on contract_crm.%I', t);
    execute format('create policy support_readonly_ins on contract_crm.%I as restrictive for insert to authenticated with check (not contract_crm.in_support_session())', t);
    execute format('drop policy if exists support_readonly_upd on contract_crm.%I', t);
    execute format('create policy support_readonly_upd on contract_crm.%I as restrictive for update to authenticated using (not contract_crm.in_support_session()) with check (not contract_crm.in_support_session())', t);
    execute format('drop policy if exists support_readonly_del on contract_crm.%I', t);
    execute format('create policy support_readonly_del on contract_crm.%I as restrictive for delete to authenticated using (not contract_crm.in_support_session())', t);
    execute format('drop trigger if exists trg_set_tenant_id on contract_crm.%I', t);
    execute format('create trigger trg_set_tenant_id before insert on contract_crm.%I for each row execute function contract_crm.set_tenant_id()', t);
  end loop;
end $$;
