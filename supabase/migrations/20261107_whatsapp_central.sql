-- Central de atendimento (WhatsApp): quem vê qual trecho da conversa e transferências entre áreas.
-- Só vale para números com finalidade "Central" (evo_instance_aliases[nome].purpose = 'central');
-- os demais continuam como antes.

-- Estado do atendimento na conversa
alter table contract_crm.whatsapp_conversation_status
  add column if not exists area text,                       -- área atual (id de Configurações → Áreas e acessos)
  add column if not exists attend_status text,              -- nova | em_atendimento | aguardando | resolvida
  add column if not exists atend_started_at timestamptz,    -- início do atendimento atual (protocolo)
  add column if not exists first_response_due_at timestamptz;

-- Janelas de acesso: a pessoa (user_id) ou a fila da área (area) vê as mensagens entre from_ts e to_ts
create table if not exists contract_crm.whatsapp_access_windows (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references contract_crm.tenants(id) on delete cascade,
  phone         text not null,
  instance_name text not null,
  user_id       uuid references contract_crm.profiles(id) on delete cascade,
  area          text,
  from_ts       timestamptz not null,
  to_ts         timestamptz,
  reason        text,          -- triagem | assumiu | transferencia | consulta
  created_at    timestamptz not null default now()
);
create index if not exists wa_windows_conv on contract_crm.whatsapp_access_windows (tenant_id, instance_name, phone);
create index if not exists wa_windows_user on contract_crm.whatsapp_access_windows (tenant_id, user_id);

-- Transferências: nota de passagem e o que foi compartilhado
create table if not exists contract_crm.whatsapp_transfers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references contract_crm.tenants(id) on delete cascade,
  phone         text not null,
  instance_name text not null,
  from_user     uuid references contract_crm.profiles(id) on delete set null,
  from_area     text,
  to_user       uuid references contract_crm.profiles(id) on delete set null,
  to_area       text,
  note          text,          -- cifrada por empresa (ENCRYPTED_COLUMNS)
  share         text not null default 'nota',   -- nota | atendimento | tudo
  protocol      text,
  created_at    timestamptz not null default now()
);
create index if not exists wa_transfers_conv on contract_crm.whatsapp_transfers (tenant_id, instance_name, phone, created_at);

do $$
declare t text;
begin
  foreach t in array array['whatsapp_access_windows', 'whatsapp_transfers'] loop
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
