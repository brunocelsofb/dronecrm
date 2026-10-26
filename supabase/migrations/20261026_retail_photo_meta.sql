-- Varejo: cor de cada foto da peça e se é foto com modelo.
-- { "<caminho da foto>": { "color": "Areia" | null, "model": true | false } }
-- Foto sem entrada vale para todas as cores. A vitrine troca a foto ao escolher a cor.
alter table contract_crm.retail_products add column if not exists photo_meta jsonb not null default '{}'::jsonb;
