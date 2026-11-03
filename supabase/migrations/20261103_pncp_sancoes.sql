-- Licitações · sanções: última consulta consolidada (TCU: inidôneos, CEIS, CNEP, CNIA) do concorrente
-- acompanhado e dos CNPJs da própria empresa, para avisar quando aparecer algo novo.
alter table contract_crm.pncp_competitors add column if not exists sanctions jsonb, add column if not exists sanctions_at timestamptz;
alter table contract_crm.pncp_settings add column if not exists own_sanctions jsonb, add column if not exists own_sanctions_at timestamptz;
