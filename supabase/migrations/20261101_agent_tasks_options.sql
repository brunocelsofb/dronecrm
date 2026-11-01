-- Tarefas dos agentes: destinatários e escolhas de cada tarefa (options) e tarefa escrita mensal (month_day).
--   options (tarefa do sistema): assignee (quem faz; vazio = responsável do contrato),
--     notify_whatsapp / notify_email (quem recebe o resumo; vazio = gestor),
--     briefing_sections / briefing_extra (o que aparece no resumo do dia)
--   month_day (tarefa escrita): roda uma vez por mês nesse dia; nulo = dias da semana
alter table contract_crm.agent_tasks
  add column if not exists options jsonb not null default '{}'::jsonb,
  add column if not exists month_day smallint;
alter table contract_crm.agent_tasks drop constraint if exists agent_tasks_month_day;
alter table contract_crm.agent_tasks add constraint agent_tasks_month_day check (month_day is null or (month_day between 1 and 28));
