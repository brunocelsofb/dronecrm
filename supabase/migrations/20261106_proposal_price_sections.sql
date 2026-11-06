-- Proposta espelha a "Apresentação ao Cliente" do Price: cada seção vira um bloco da montagem
-- (editável e removível). source='price' marca os blocos que vieram do Price.
alter table contract_crm.proposal_content_blocks
  add column if not exists source text,
  add column if not exists section_key text,
  add column if not exists title text;

create index if not exists proposal_content_blocks_source_idx
  on contract_crm.proposal_content_blocks (proposal_id, source);

-- Seções do Price que entram por padrão na proposta (por empresa). Nulo = todas.
alter table contract_crm.organization_settings
  add column if not exists price_sections jsonb;

-- Seções do Price que o usuário excluiu nesta proposta (não voltam ao reenviar do Price)
alter table contract_crm.proposals
  add column if not exists price_sections_hidden text[] not null default '{}';
