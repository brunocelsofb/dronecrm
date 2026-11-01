-- Regras dos agentes (tela Regras automáticas): critério → ação, montadas por cada empresa.
--   agent_rules: QUANDO criterion (com threshold e conditions) → FAÇA actions (tarefa, aviso,
--     resumo no WhatsApp), nos dias marcados. Só critérios e ações do catálogo do sistema
--     (src/lib/agent/rules-catalog.ts): nada de texto livre interpretado por IA.
--   agent_rule_hits: o que cada regra já tratou (não repete o mesmo caso).
create table if not exists contract_crm.agent_rules (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references contract_crm.tenants(id) on delete cascade,
  agent         text not null check (agent in ('farmer','hunter')),
  name          text not null,
  criterion     text not null,
  threshold     integer not null check (threshold between 0 and 3650),
  conditions    jsonb not null default '{}'::jsonb,
  actions       jsonb not null default '{}'::jsonb,
  days          smallint[] not null default '{0,1,2,3,4,5,6}',
  enabled       boolean not null default true,
  last_run_at   timestamptz,
  last_status   text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint agent_rules_days check (days <@ '{0,1,2,3,4,5,6}'::smallint[])
);
create index if not exists agent_rules_tenant on contract_crm.agent_rules (tenant_id);

create table if not exists contract_crm.agent_rule_hits (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references contract_crm.tenants(id) on delete cascade,
  rule_id     uuid not null references contract_crm.agent_rules(id) on delete cascade,
  entity_id   text not null,
  episode     text not null,
  created_at  timestamptz not null default now(),
  unique (rule_id, entity_id, episode)
);
create index if not exists agent_rule_hits_tenant on contract_crm.agent_rule_hits (tenant_id);

do $$
declare t text;
begin
  foreach t in array array['agent_rules','agent_rule_hits'] loop
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
