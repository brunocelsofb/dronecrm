-- Áreas da empresa: coordenador (lead_id: recebe as tarefas encaminhadas e os avisos) e gerente (avisos).
alter table contract_crm.org_areas add column if not exists manager_id uuid;
comment on column contract_crm.org_areas.lead_id is 'Coordenador da área: recebe as tarefas encaminhadas e os avisos.';
comment on column contract_crm.org_areas.manager_id is 'Gerente da área: recebe os avisos e acompanha.';
