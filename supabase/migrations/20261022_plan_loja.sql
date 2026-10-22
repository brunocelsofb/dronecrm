-- Plano Loja (varejo): as abas vêm de DEFAULT_PLAN_FEATURES.loja até o Super Admin
-- salvar a escolha em Planos e abas (linha 'loja' em plan_features).
alter table contract_crm.plan_features drop constraint plan_features_plan_check;
alter table contract_crm.plan_features add constraint plan_features_plan_check check (plan in ('starter', 'professional', 'enterprise', 'loja'));
