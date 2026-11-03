-- Licitações (PNCP): até onde a rotina já baixou a base (carga dos últimos dias, país inteiro).
create table if not exists contract_crm.pncp_sync_state (
  key        text primary key,
  value      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table contract_crm.pncp_sync_state enable row level security;
revoke all on contract_crm.pncp_sync_state from anon, authenticated;
create index if not exists pncp_contratacoes_objeto_trgm_fallback on contract_crm.pncp_contratacoes (data_publicacao desc);
