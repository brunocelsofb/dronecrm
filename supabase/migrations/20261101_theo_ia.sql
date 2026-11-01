-- Théo (assistente de IA): cada empresa liga a própria IA (Anthropic, OpenAI ou Gemini) e paga o uso.
-- - organization_settings.theo_settings: IA ativa, modelo, chaves cifradas por IA, orçamento, usuários liberados
-- - plan_features.theo_tools: ações do Théo em cada plano (Super Admin); null = todas as do plano
-- - assistant_usage_log: passa a ser por empresa (antes somava todas e qualquer usuário via tudo), com IA, modelo e custo
alter table contract_crm.organization_settings add column if not exists theo_settings jsonb not null default '{}'::jsonb;
alter table contract_crm.plan_features add column if not exists theo_tools text[];

alter table contract_crm.assistant_usage_log add column if not exists tenant_id uuid references contract_crm.tenants(id) on delete cascade;
alter table contract_crm.assistant_usage_log add column if not exists provider text;
alter table contract_crm.assistant_usage_log add column if not exists model text;
alter table contract_crm.assistant_usage_log add column if not exists cost_usd numeric;
-- Registros antigos: empresa de quem usou (todos foram da Anthropic)
update contract_crm.assistant_usage_log l set tenant_id = p.tenant_id, provider = coalesce(l.provider, 'anthropic')
  from contract_crm.profiles p where p.id = l.user_id and l.tenant_id is null;
create index if not exists assistant_usage_log_tenant on contract_crm.assistant_usage_log (tenant_id, created_at);

drop policy if exists assistant_usage_log_select on contract_crm.assistant_usage_log;
drop policy if exists assistant_usage_log_insert on contract_crm.assistant_usage_log;
do $$
declare t text := 'assistant_usage_log';
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
