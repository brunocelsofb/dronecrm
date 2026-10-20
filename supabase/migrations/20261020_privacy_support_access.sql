-- Privacidade (aplicado em 20/10/2026 em partes pelo MCP do Supabase):
--  support_access_tables, support_access_functions, support_readonly_activities,
--  support_readonly_batch0..3, dpa_acceptances, privacy_settings,
--  marketing_lists_inativos_audience, inactive_hunter_last_run.
-- Resumo do que existe no banco:
--
-- 1. support_access_grants: liberação de acesso de suporte (empresa, motivo, início, fim,
--    revogação). support_access_log: quem, quando, o quê (start/view/action/write_blocked/stop/reset).
-- 2. support_grant_active(tenant) → id da liberação ativa.
--    current_tenant_id(): o "Acessar" do Super Admin só vale com liberação ativa.
--    in_support_session(): Super Admin dentro de outra empresa.
--    log_support_view(path, method): chamado pelo proxy a cada tela (sem repetir em 1 min).
-- 3. Em TODA tabela com tenant_guard, três políticas RESTRICTIVE para "authenticated":
--      support_readonly_ins  (insert  with check (not in_support_session()))
--      support_readonly_upd  (update  using/with check (not in_support_session()))
--      support_readonly_del  (delete  using (not in_support_session()))
--    Tabela nova com tenant_guard precisa das três também.
-- 4. dpa_acceptances: aceite do Contrato de Tratamento de Dados (versão, quem, IP, hash do texto).
-- 5. organization_settings.privacy_settings jsonb: { whatsapp_retention_days }.

create table if not exists contract_crm.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references contract_crm.tenants(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  reason text,
  scope text not null default 'read' check (scope in ('read')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > starts_at)
);
-- (demais definições: ver as migrations aplicadas no projeto; o laço abaixo é a forma
--  equivalente das políticas de só leitura)
-- do $$ declare t record; begin
--   for t in select distinct tablename from pg_policies where schemaname='contract_crm' and policyname='tenant_guard' loop
--     execute format('create policy support_readonly_ins on contract_crm.%I as restrictive for insert to authenticated with check (not contract_crm.in_support_session())', t.tablename);
--     execute format('create policy support_readonly_upd on contract_crm.%I as restrictive for update to authenticated using (not contract_crm.in_support_session()) with check (not contract_crm.in_support_session())', t.tablename);
--     execute format('create policy support_readonly_del on contract_crm.%I as restrictive for delete to authenticated using (not contract_crm.in_support_session())', t.tablename);
--   end loop; end $$;
