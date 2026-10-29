-- Conexão com o Meta Ads passa a ser da empresa (serve ao Varejo e ao Marketing).
-- As tabelas do Varejo ainda estavam vazias: só renomeia.
alter table if exists contract_crm.retail_meta_connections rename to ads_meta_connections;
alter table if exists contract_crm.retail_meta_campaigns rename to ads_meta_campaigns;
-- utm_codes: utm_campaign= que aparece no link do anúncio (campanhas do Marketing)
alter table contract_crm.ads_meta_campaigns add column if not exists utm_codes text[] not null default '{}';

-- Gasto por mês de cada campanha do Meta (o Marketing lança investimento por mês)
create table if not exists contract_crm.ads_meta_campaign_months (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references contract_crm.tenants(id) on delete cascade,
  ad_account_id    text not null,
  meta_campaign_id text not null,
  year             int not null,
  month            int not null check (month between 1 and 12),
  spend            numeric(14,2) not null default 0,
  reach            bigint not null default 0,
  impressions      bigint not null default 0,
  clicks           bigint not null default 0,
  synced_at        timestamptz not null default now(),
  unique (tenant_id, meta_campaign_id, year, month)
);

-- Ligação à mão: campanha do Meta → campanha do Marketing
alter table contract_crm.marketing_campaigns add column if not exists meta_campaign_ids text[] not null default '{}';

do $$
declare t text := 'ads_meta_campaign_months';
begin
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
end $$;
