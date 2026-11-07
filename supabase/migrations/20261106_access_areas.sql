-- Áreas de acesso editáveis por empresa (padrão no código + ajustes/criadas aqui)
alter table contract_crm.organization_settings add column if not exists access_areas jsonb;
-- Perfil do usuário passa a aceitar áreas criadas pela empresa (id simples)
alter table contract_crm.profiles drop constraint if exists profiles_access_profile_check;
alter table contract_crm.profiles add constraint profiles_access_profile_check
  check (access_profile is null or access_profile ~ '^[a-z0-9_]{2,40}$');
-- Liberação avulsa de valores (null = regra da área; true/false = decidido para a pessoa)
alter table contract_crm.profiles add column if not exists sees_values boolean;
