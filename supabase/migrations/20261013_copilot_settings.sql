-- Configurações do Copiloto IA (aplicada em produção em 13/10/2026)
-- copilot_settings.renewal_templates: textos dos avisos de renovação por marco
--   { "60": "...", "30": "...", "15": "...", "0": "..." }
alter table contract_crm.organization_settings
  add column if not exists copilot_settings jsonb not null default '{}'::jsonb;

comment on column contract_crm.organization_settings.copilot_settings is
  'Configurações do Copiloto IA (ex.: renewal_templates por marco 60/30/15/0). Editado em Configurações → Copiloto IA.';
