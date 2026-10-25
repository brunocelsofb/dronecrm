-- Varejo: mensagens do pedido (rascunho → atendente revisa e envia), linha do tempo
-- e rastreio. Nada vai para a cliente sem alguém da loja enviar.

alter table contract_crm.retail_orders
  add column if not exists public_token text,
  add column if not exists separated_at timestamptz,
  add column if not exists shipped_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists tracking_carrier text,
  add column if not exists tracking_code text,
  add column if not exists tracking_url text;
create unique index if not exists retail_orders_public_token_uq on contract_crm.retail_orders (public_token) where public_token is not null;

-- Uma mensagem por etapa do pedido (refeita enquanto estiver pendente)
create table if not exists contract_crm.retail_order_messages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references contract_crm.tenants(id) on delete cascade,
  order_id      uuid not null references contract_crm.retail_orders(id) on delete cascade,
  stage         text not null check (stage in ('recebido', 'link', 'pago', 'separado', 'enviado', 'entregue')),
  status        text not null default 'pendente' check (status in ('pendente', 'enviada', 'descartada')),
  wa_text       text not null default '',
  email_subject text not null default '',
  email_body    text not null default '',
  sent_channels text[] not null default '{}',   -- 'whatsapp_drone' | 'whatsapp_manual' | 'email'
  email_to      text,
  sent_by       uuid,
  sent_at       timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (order_id, stage)
);
create index if not exists retail_order_messages_pending on contract_crm.retail_order_messages (tenant_id, status) where status = 'pendente';

-- Linha do tempo do pedido (a página da cliente mostra as públicas)
create table if not exists contract_crm.retail_order_events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references contract_crm.tenants(id) on delete cascade,
  order_id   uuid not null references contract_crm.retail_orders(id) on delete cascade,
  kind       text not null,
  note       text,
  public     boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists retail_order_events_order on contract_crm.retail_order_events (order_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['retail_order_messages', 'retail_order_events'] loop
    execute format('alter table contract_crm.%I enable row level security', t);
    execute format('revoke all on contract_crm.%I from anon', t);
    execute format('create policy tenant_guard on contract_crm.%I as restrictive for all to authenticated using (tenant_id = contract_crm.current_tenant_id()) with check (tenant_id = contract_crm.current_tenant_id())', t);
    execute format('create policy tenant_access on contract_crm.%I for all to authenticated using (tenant_id = contract_crm.current_tenant_id()) with check (tenant_id = contract_crm.current_tenant_id())', t);
    execute format('create policy support_readonly_ins on contract_crm.%I as restrictive for insert to authenticated with check (not contract_crm.in_support_session())', t);
    execute format('create policy support_readonly_upd on contract_crm.%I as restrictive for update to authenticated using (not contract_crm.in_support_session()) with check (not contract_crm.in_support_session())', t);
    execute format('create policy support_readonly_del on contract_crm.%I as restrictive for delete to authenticated using (not contract_crm.in_support_session())', t);
    execute format('create trigger trg_set_tenant_id before insert on contract_crm.%I for each row execute function contract_crm.set_tenant_id()', t);
  end loop;
end $$;
