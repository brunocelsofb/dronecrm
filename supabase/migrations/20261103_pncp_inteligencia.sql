-- Licitações · inteligência:
--   pncp_settings: CNPJs da própria empresa (para saber quando ganhamos) e quem recebe o
--     acompanhamento das licitações que a empresa disputa (por qual canal).
--   pncp_competitors: concorrentes que a empresa acompanha (CNPJ + anotação).
--   pncp_matches ganha o resultado acompanhado: situação dos itens, vencedores, valores.
create table if not exists contract_crm.pncp_settings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null unique references contract_crm.tenants(id) on delete cascade,
  own_cnpjs       text[] not null default '{}',
  recipient_ids   uuid[] not null default '{}',
  channels        jsonb not null default '{"sino": true, "whatsapp": false, "email": true}',
  updated_by      uuid,
  updated_at      timestamptz not null default now()
);

create table if not exists contract_crm.pncp_competitors (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references contract_crm.tenants(id) on delete cascade,
  cnpj        text not null,
  name        text,
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (tenant_id, cnpj)
);
create index if not exists pncp_competitors_tenant on contract_crm.pncp_competitors (tenant_id);

alter table contract_crm.pncp_matches
  add column if not exists result_status    text check (result_status in ('aguardando','ganhou','perdeu','sem_vencedor','cancelada')),
  add column if not exists result           jsonb,
  add column if not exists won_value        numeric,
  add column if not exists homologado_value numeric,
  add column if not exists winners          text[] not null default '{}',
  add column if not exists tracked_at       timestamptz,
  add column if not exists result_at        timestamptz;

do $$
declare t text;
begin
  foreach t in array array['pncp_settings','pncp_competitors'] loop
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
