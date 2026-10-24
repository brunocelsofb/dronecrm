-- Vitrine: textos da landing (abertura, sobre, destaque, perguntas, Instagram, cidade, entrega local)
alter table contract_crm.retail_storefronts add column if not exists content jsonb not null default '{}'::jsonb;
