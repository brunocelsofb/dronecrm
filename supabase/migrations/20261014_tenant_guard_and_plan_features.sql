-- Aplicado em 14/10/2026 (via SQL, em lotes por causa de locks).
-- 1. current_tenant_id(): perfil do usuário primeiro, depois claim do JWT.
-- 2. is_super_admin().
-- 3. Política RESTRITIVA "tenant_guard" em todas as tabelas com tenant_id:
--      USING/WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin())
--    (profiles também permite a própria linha: id = auth.uid()).
-- 4. tenants.super_admin_tenants: de "true" para is_super_admin().
-- 5. set_tenant_id(): sem JWT, herda o tenant do contract_id da linha.
-- 6. plan_features (plano → abas) e tenants.features_add / features_remove.

create table if not exists contract_crm.plan_features (
  plan text primary key check (plan in ('starter','professional','enterprise')),
  features text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table contract_crm.plan_features enable row level security;
-- create policy plan_features_read  ... for select to authenticated using (true);
-- create policy plan_features_write ... for all to authenticated using (contract_crm.is_super_admin());
alter table contract_crm.tenants add column if not exists features_add text[] not null default '{}';
alter table contract_crm.tenants add column if not exists features_remove text[] not null default '{}';
