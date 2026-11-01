-- Prazo do chamado por prioridade, por empresa (antes fixo no código: 1/2/3/7 dias).
-- Editável na Central de regras → Atendimento. Nulo = padrão.
alter table contract_crm.organization_settings add column if not exists ticket_sla_days jsonb;
comment on column contract_crm.organization_settings.ticket_sla_days is 'Prazo do chamado (dias) por prioridade: {muito_critica, critica, pouco_critica, nao_critica}. Nulo = padrão 1/2/3/7. Editável na Central de regras → Atendimento.';
