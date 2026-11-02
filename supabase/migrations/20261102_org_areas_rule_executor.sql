-- Áreas da empresa (Time técnico, Faturamento, Financeiro…) usadas como destino nas regras:
--   lead_id = quem recebe a tarefa da área; member_ids = avisados no sino; emails = e-mails de fora.
-- agent_rules.executor: quem faz — 'manual' (tarefa para pessoa) ou 'agent' (agente de IA prepara/envia).
-- organization_settings.ai_paused: modo sem IA — ações de agente viram tarefas manuais.
create table if not exists contract_crm.org_areas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references contract_crm.tenants(id) on delete cascade,
  name        text not null,
  lead_id     uuid,
  member_ids  uuid[] not null default '{}',
  emails      text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists org_areas_tenant on contract_crm.org_areas (tenant_id);

do $$
declare t text := 'org_areas';
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

alter table contract_crm.agent_rules add column if not exists executor text not null default 'manual';
alter table contract_crm.agent_rules drop constraint if exists agent_rules_executor;
alter table contract_crm.agent_rules add constraint agent_rules_executor check (executor in ('manual','agent'));
alter table contract_crm.organization_settings add column if not exists ai_paused boolean not null default false;
comment on column contract_crm.organization_settings.ai_paused is 'Modo sem IA (Central de regras): ações de agente viram tarefas manuais com as mesmas instruções.';
