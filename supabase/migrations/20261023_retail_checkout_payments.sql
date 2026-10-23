-- Varejo: "Finalizar compra" com link de pagamento gerado pelo Drone (InfinitePay ou Mercado Pago).
-- Chaves de cada loja ficam criptografadas (SETTINGS_ENCRYPTION_KEY); escolha do serviço por condição
-- fica em retail_settings.payments. O pagamento aprovado é conferido no serviço antes de virar Pago.
alter table contract_crm.organization_settings
  add column if not exists retail_mp_token_enc text,
  add column if not exists retail_ip_token_enc text;

alter table contract_crm.retail_orders
  add column if not exists payment_links jsonb not null default '{}'::jsonb, -- { ref: { choice, provider, url, amount, discount, version, created_at } }
  add column if not exists payment_provider text check (payment_provider is null or payment_provider in ('infinitepay', 'mercadopago', 'manual')),
  add column if not exists payment_tx text,
  add column if not exists payment_paid_amount numeric,
  add column if not exists payment_paid_method text,
  add column if not exists payment_receipt_url text,
  add column if not exists payment_alert text,
  add column if not exists checkout_notified_at timestamptz;
