-- Varejo: funil da loja (Carrinho → Em atendimento → Proposta → Aguardando pagamento → Pago → Enviado/Entregue; Perdido).
-- carrinho  = pedido criado pela vitrine que ainda não virou conversa.
-- stage_at  = quando o pedido entrou na situação atual (para o alerta de "parado").
-- last_nudge_at / nudge_count = lembretes de recuperação enviados pela equipe.
-- lost_reason = motivo quando o pedido é perdido (cancelado).
alter table contract_crm.retail_orders drop constraint if exists retail_orders_status_check;
alter table contract_crm.retail_orders add constraint retail_orders_status_check
  check (status in ('carrinho', 'enviado_atendimento', 'aguardando_pagamento', 'pago', 'enviado', 'entregue', 'cancelado'));

alter table contract_crm.retail_orders
  add column if not exists stage_at timestamptz not null default now(),
  add column if not exists last_nudge_at timestamptz,
  add column if not exists nudge_count integer not null default 0 check (nudge_count >= 0),
  add column if not exists lost_reason text check (lost_reason is null or lost_reason in ('preco', 'frete', 'tamanho', 'so_olhando', 'sem_resposta', 'outro'));

-- Pedidos que já existiam: melhor estimativa de quando entraram na situação atual
update contract_crm.retail_orders set stage_at = case
  when status = 'aguardando_pagamento' then coalesce(proposal_accepted_at, updated_at, created_at)
  when status in ('pago', 'enviado', 'entregue') then coalesce(paid_at, updated_at, created_at)
  when status = 'cancelado' then coalesce(cancelled_at, updated_at, created_at)
  else created_at end;

create or replace function contract_crm.retail_orders_stage_at() returns trigger
language plpgsql set search_path = contract_crm, pg_temp as $$
begin
  if new.status is distinct from old.status then new.stage_at := now(); end if;
  return new;
end $$;
drop trigger if exists retail_orders_stage_at on contract_crm.retail_orders;
create trigger retail_orders_stage_at before update on contract_crm.retail_orders
  for each row execute function contract_crm.retail_orders_stage_at();

create index if not exists retail_orders_tenant_status_stage on contract_crm.retail_orders (tenant_id, status, stage_at);
