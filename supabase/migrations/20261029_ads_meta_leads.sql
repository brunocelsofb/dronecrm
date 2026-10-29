-- Leads do Meta (Lead Ads) direto no CRM, pelo app da plataforma.
-- Páginas do Facebook da empresa (com o acesso da página, criptografado), formulários e o
-- registro de cada lead recebido (evita duplicar quando o Meta reenvia o aviso).
alter table contract_crm.ads_meta_connections add column if not exists meta_user_id text;

create table if not exists contract_crm.ads_meta_pages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references contract_crm.tenants(id) on delete cascade,
  page_id       text not null,
  name          text not null default '',
  token_enc     text not null,
  subscribed    boolean not null default false,
  subscribed_at timestamptz,
  last_error    text,
  updated_at    timestamptz not null default now(),
  unique (tenant_id, page_id)
);
create index if not exists ads_meta_pages_page on contract_crm.ads_meta_pages (page_id);

create table if not exists contract_crm.ads_meta_lead_forms (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references contract_crm.tenants(id) on delete cascade,
  page_id      text not null,
  form_id      text not null,
  name         text not null default '',
  status       text,
  active       boolean not null default false,
  campaign_id  uuid references contract_crm.marketing_campaigns(id) on delete set null,
  leads_count  int not null default 0,
  last_lead_at timestamptz,
  updated_at   timestamptz not null default now(),
  unique (tenant_id, form_id)
);

create table if not exists contract_crm.ads_meta_lead_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references contract_crm.tenants(id) on delete cascade,
  leadgen_id  text not null,
  page_id     text,
  form_id     text,
  status      text not null default 'recebido' check (status in ('recebido', 'criado', 'duplicado', 'ignorado', 'erro')),
  lead_id     uuid references contract_crm.leads(id) on delete set null,
  error       text,
  created_at  timestamptz not null default now(),
  unique (tenant_id, leadgen_id)
);

do $$
declare t text;
begin
  foreach t in array array['ads_meta_pages', 'ads_meta_lead_forms', 'ads_meta_lead_events'] loop
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
-- O acesso da página não é lido pelo navegador
revoke select on contract_crm.ads_meta_pages from authenticated;

-- Pedidos de exclusão de dados vindos do Meta (rotina da plataforma; sem dado de empresa)
create table if not exists contract_crm.meta_data_deletion_requests (
  id                uuid primary key default gen_random_uuid(),
  confirmation_code text not null unique,
  meta_user_id      text not null,
  connections_removed int not null default 0,
  status            text not null default 'concluido',
  created_at        timestamptz not null default now()
);
alter table contract_crm.meta_data_deletion_requests enable row level security;
revoke all on contract_crm.meta_data_deletion_requests from anon, authenticated;
