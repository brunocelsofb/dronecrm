-- WhatsApp mais próximo do app oficial (etapa 1). Só acrescenta; nada existente muda.
-- - quoted_id: id (do WhatsApp) da mensagem respondida citando
-- - reactions: reações na mensagem, {"me": "👍", "them": "❤️"}
-- - last_read_at: até quando a equipe leu a conversa (contagem de não lidas)
-- - whatsapp_quick_replies: respostas rápidas da empresa ("/atalho")
-- - evo_webhook_version: versão dos eventos do webhook já registrada no servidor Evolution
alter table contract_crm.contract_whatsapp_messages add column if not exists quoted_id text;
alter table contract_crm.contract_whatsapp_messages add column if not exists reactions jsonb not null default '{}'::jsonb;
create index if not exists cwm_zapi_message_id on contract_crm.contract_whatsapp_messages (zapi_message_id) where zapi_message_id is not null;

alter table contract_crm.whatsapp_conversation_status add column if not exists last_read_at timestamptz;
-- Conversas que já existem começam como lidas (sem enxurrada de "não lidas" no primeiro dia)
update contract_crm.whatsapp_conversation_status set last_read_at = now() where last_read_at is null;

alter table contract_crm.organization_settings add column if not exists evo_webhook_version int not null default 0;

create table if not exists contract_crm.whatsapp_quick_replies (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references contract_crm.tenants(id) on delete cascade,
  shortcut   text not null check (shortcut ~ '^[a-z0-9_-]{1,30}$'),
  body       text not null check (length(body) between 1 and 4000),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, shortcut)
);

do $$
declare t text := 'whatsapp_quick_replies';
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
