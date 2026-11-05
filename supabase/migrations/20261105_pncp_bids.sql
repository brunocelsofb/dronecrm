-- Licitações · quem disputou cada licitação (registrado pela equipe a partir da sessão pública):
-- empresa, posição, lance, se é a própria empresa. Monta o histórico de cada concorrente contra nós.
create table if not exists contract_crm.pncp_bids (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references contract_crm.tenants(id) on delete cascade,
  match_id        uuid not null references contract_crm.pncp_matches(id) on delete cascade,
  numero_controle text not null,
  cnpj            text,
  name            text not null,
  is_us           boolean not null default false,
  position        int,
  value           numeric,
  won             boolean not null default false,
  note            text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists pncp_bids_tenant_match on contract_crm.pncp_bids (tenant_id, match_id);
create index if not exists pncp_bids_tenant_cnpj on contract_crm.pncp_bids (tenant_id, cnpj);
do $$
declare t text := 'pncp_bids';
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
