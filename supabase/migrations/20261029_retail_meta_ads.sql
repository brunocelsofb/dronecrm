-- Varejo: link da bio e conexão com o Meta Ads (Instagram/Facebook).
-- kind = 'bio': campanha fixa do link da bio (não aparece na lista comum).
-- meta_campaign_ids: anúncios do Meta ligados à mão a esta campanha (além dos que o Drone
-- liga sozinho quando o link do anúncio tem ?c=codigo).
alter table contract_crm.retail_campaigns add column if not exists kind text not null default 'campanha';
alter table contract_crm.retail_campaigns drop constraint if exists retail_campaigns_kind_check;
alter table contract_crm.retail_campaigns add constraint retail_campaigns_kind_check check (kind in ('campanha', 'bio'));
alter table contract_crm.retail_campaigns add column if not exists meta_campaign_ids text[] not null default '{}';
create unique index if not exists retail_campaigns_one_bio on contract_crm.retail_campaigns (tenant_id) where kind = 'bio';

-- Conexão da empresa com o Meta (um por empresa). O token fica criptografado (SETTINGS_ENCRYPTION_KEY).
create table if not exists contract_crm.retail_meta_connections (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null unique references contract_crm.tenants(id) on delete cascade,
  token_enc        text not null,
  token_expires_at timestamptz,
  meta_user_name   text,
  accounts         jsonb not null default '[]'::jsonb,
  ad_account_id    text,
  ad_account_name  text,
  currency         text,
  connected_by     uuid,
  connected_at     timestamptz not null default now(),
  last_sync_at     timestamptz,
  last_error       text
);

-- Números de cada campanha do Meta (desde o início), atualizados todo dia
create table if not exists contract_crm.retail_meta_campaigns (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references contract_crm.tenants(id) on delete cascade,
  ad_account_id    text not null,
  meta_campaign_id text not null,
  name             text not null default '',
  status           text,
  spend            numeric(14,2) not null default 0,
  reach            bigint not null default 0,
  impressions      bigint not null default 0,
  clicks           bigint not null default 0,
  codes            text[] not null default '{}',
  date_start       date,
  date_stop        date,
  synced_at        timestamptz not null default now(),
  unique (tenant_id, meta_campaign_id)
);

do $$
declare t text;
begin
  foreach t in array array['retail_meta_connections', 'retail_meta_campaigns'] loop
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
-- O token não é lido pelo navegador: só o servidor (service_role) acessa a conexão
revoke select on contract_crm.retail_meta_connections from authenticated;
