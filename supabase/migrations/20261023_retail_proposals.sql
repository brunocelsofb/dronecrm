-- Varejo: proposta do pedido para a cliente (link público com aceite da condição de pagamento).
-- proposal = retrato do que foi enviado (itens, condições, totais e links de pagamento).
alter table contract_crm.retail_orders
  add column if not exists proposal_token text,
  add column if not exists proposal jsonb,
  add column if not exists proposal_sent_at timestamptz,
  add column if not exists proposal_choice text check (proposal_choice is null or proposal_choice in ('pix', 'card')),
  add column if not exists proposal_accepted_at timestamptz;
create unique index if not exists retail_orders_proposal_token on contract_crm.retail_orders (proposal_token) where proposal_token is not null;
