-- Visitas de páginas (site da empresa e vitrine da loja), sem cookies e sem dado pessoal:
-- o visitante é um código que muda todo dia (não dá para ligar dias diferentes nem saber quem é).
create table if not exists contract_crm.page_visits (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references contract_crm.tenants(id) on delete cascade,
  channel       text not null default 'site' check (channel in ('site', 'vitrine')),
  host          text not null default '',
  path          text not null default '/',
  title         text,
  visitor_day   text not null,
  visited_on    date not null,
  started_at    timestamptz not null default now(),
  duration_ms   int not null default 0,
  engaged       boolean not null default false,
  device        text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  campaign_code text,
  referrer_host text
);
create index if not exists page_visits_tenant_time on contract_crm.page_visits (tenant_id, started_at desc);
create index if not exists page_visits_tenant_page on contract_crm.page_visits (tenant_id, channel, host, path);
-- RLS: tenant_guard, tenant_access, support_readonly_ins/upd/del e trg_set_tenant_id (mesmo bloco das outras tabelas)
