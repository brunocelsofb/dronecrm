-- Varejo: etapas próprias da loja no funil (sem automação, dentro de uma etapa fixa).
-- Quando a situação do pedido muda (automação ou equipe), ele sai da etapa própria.
alter table contract_crm.retail_orders
  add column if not exists custom_stage text check (custom_stage is null or custom_stage ~ '^c_[a-z0-9]{4,12}$'),
  add column if not exists custom_stage_at timestamptz;

create or replace function contract_crm.retail_orders_stage_at() returns trigger
language plpgsql set search_path = contract_crm, pg_temp as $$
begin
  if new.status is distinct from old.status then
    new.stage_at := now();
    new.custom_stage := null;
    new.custom_stage_at := null;
  end if;
  return new;
end $$;
