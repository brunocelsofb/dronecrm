-- Regras da proposta por empresa (Configurações → Propostas). Nulo = padrão (aprovação técnica ligada).
alter table contract_crm.organization_settings add column if not exists proposal_settings jsonb;
-- Price: recurso opcional do plano (tenants.features_add); liberado para a Orbis pelo Super Admin.
