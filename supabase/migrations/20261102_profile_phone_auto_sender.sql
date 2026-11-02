-- Cadastro completo do login (nome e sobrenome, telefone, área e e-mail) e quem envia
-- as mensagens automáticas internas dos agentes (Central de regras → Áreas e IA).
alter table contract_crm.profiles add column if not exists phone text;
alter table contract_crm.organization_settings add column if not exists auto_sender_id uuid;
comment on column contract_crm.organization_settings.auto_sender_id is 'Quem envia as mensagens automáticas internas dos agentes (Central de regras). Precisa ter nome e sobrenome, telefone, área e e-mail.';
