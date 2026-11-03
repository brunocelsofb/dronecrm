-- Licitações (PNCP): radar de contratações públicas por empresa.
--   pncp_contratacoes: cópia das contratações públicas baixadas do PNCP (dado público, uma vez para
--     todas as empresas; só o servidor lê/grava — sem acesso direto pelo navegador).
--   pncp_watchers: monitoramentos da empresa (palavras do objeto, estados, modalidades, faixa de valor,
--     quem recebe o alerta e por qual canal, análise do agente de IA).
--   pncp_matches: o que bateu com os monitoramentos da empresa, com a decisão (nova, analisando,
--     participar, descartada, virou oportunidade) e a análise do agente.
create table if not exists contract_crm.pncp_contratacoes (
  numero_controle     text primary key,
  orgao_cnpj          text,
  orgao_nome          text,
  esfera              text,
  unidade_nome        text,
  uf                  text,
  municipio           text,
  codigo_ibge         text,
  modalidade_id       int,
  modalidade_nome     text,
  objeto              text,
  objeto_norm         text,
  info_complementar   text,
  valor_estimado      numeric,
  srp                 boolean,
  situacao_id         int,
  situacao_nome       text,
  data_publicacao     timestamptz,
  data_abertura       timestamptz,
  data_encerramento   timestamptz,
  link_origem         text,
  ano_compra          int,
  sequencial_compra   int,
  atualizado_em       timestamptz,
  baixado_em          timestamptz not null default now()
);
create index if not exists pncp_contratacoes_enc on contract_crm.pncp_contratacoes (data_encerramento);
create index if not exists pncp_contratacoes_uf on contract_crm.pncp_contratacoes (uf);
create index if not exists pncp_contratacoes_pub on contract_crm.pncp_contratacoes (data_publicacao);
alter table contract_crm.pncp_contratacoes enable row level security;
revoke all on contract_crm.pncp_contratacoes from anon, authenticated;

create table if not exists contract_crm.pncp_watchers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references contract_crm.tenants(id) on delete cascade,
  name          text not null,
  keywords      text[] not null default '{}',
  exclude       text[] not null default '{}',
  ufs           text[] not null default '{}',
  modalidades   int[] not null default '{}',
  min_value     numeric,
  max_value     numeric,
  recipient_ids uuid[] not null default '{}',
  area_ids      uuid[] not null default '{}',
  channels      jsonb not null default '{"sino": true, "whatsapp": false, "email": false}',
  ai_analysis   boolean not null default false,
  remind_days   int not null default 3,
  enabled       boolean not null default true,
  last_run_at   timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists pncp_watchers_tenant on contract_crm.pncp_watchers (tenant_id);

create table if not exists contract_crm.pncp_matches (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references contract_crm.tenants(id) on delete cascade,
  numero_controle text not null references contract_crm.pncp_contratacoes(numero_controle) on delete cascade,
  watcher_ids     uuid[] not null default '{}',
  status          text not null default 'nova' check (status in ('nova','analisando','participar','descartada','oportunidade')),
  assigned_to     uuid,
  contract_id     uuid references contract_crm.contracts(id) on delete set null,
  ai_score        int,
  ai_summary      text,
  ai_at           timestamptz,
  note            text,
  decided_by      uuid,
  notified_at     timestamptz,
  reminded_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, numero_controle)
);
create index if not exists pncp_matches_tenant_status on contract_crm.pncp_matches (tenant_id, status);

do $$
declare t text;
begin
  foreach t in array array['pncp_watchers','pncp_matches'] loop
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
