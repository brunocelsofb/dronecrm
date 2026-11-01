-- Tarefas dos agentes de IA por empresa (tela IA da empresa, só admin).
-- task_key preenchido = tarefa do sistema (resumo do dia, avisos de vencimento...): a linha só guarda
--   liga/desliga, dias da semana e pausa. Sem linha = padrão do sistema (nada muda para quem não mexer).
-- task_key nulo = tarefa escrita pelo admin (prompt): roda com a IA do Théo da empresa, só consultas,
--   e o resultado vai no WhatsApp do gestor (ou no número informado).
create table if not exists contract_crm.agent_tasks (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references contract_crm.tenants(id) on delete cascade,
  task_key        text,
  title           text,
  prompt          text,
  recipient_phone text,
  enabled         boolean not null default true,
  days            smallint[] not null default '{0,1,2,3,4,5,6}',
  paused_until    date,
  last_run_at     timestamptz,
  last_status     text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint agent_tasks_kind check ((task_key is not null) or (title is not null and prompt is not null)),
  constraint agent_tasks_days check (days <@ '{0,1,2,3,4,5,6}'::smallint[])
);
create unique index if not exists agent_tasks_tenant_key on contract_crm.agent_tasks (tenant_id, task_key) where task_key is not null;
create index if not exists agent_tasks_tenant on contract_crm.agent_tasks (tenant_id);

do $$
declare t text := 'agent_tasks';
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
