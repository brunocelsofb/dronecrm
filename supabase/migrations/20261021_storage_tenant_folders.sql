-- Achado alto da auditoria (run-1): nos buckets contract-files e proposal-files
-- qualquer usuário logado de qualquer empresa listava, baixava, enviava e apagava
-- arquivos de outra empresa.
--
-- Regra nova: todo arquivo novo fica em "<tenant_id>/..." (src/lib/utils/storage.ts).
-- Os arquivos anteriores (sem a pasta da empresa) ficam registrados em
-- storage_legacy_objects com a empresa dona. O banco só deixa ver/apagar arquivo da
-- própria empresa e só deixa enviar para a pasta da própria empresa.
--
-- Ordem de aplicação:
--   PARTE A (este bloco) — tabela, preenchimento e função. Não muda o comportamento.
--   publicar o código que já grava na pasta da empresa
--   PARTE B — preencher de novo (arquivos enviados no meio-tempo) e ligar as políticas.

-- ── PARTE A ───────────────────────────────────────────────────────────────────
create table if not exists contract_crm.storage_legacy_objects (
  bucket_id  text not null,
  name       text not null,
  tenant_id  uuid not null references contract_crm.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (bucket_id, name)
);
alter table contract_crm.storage_legacy_objects enable row level security;
revoke all on contract_crm.storage_legacy_objects from anon, authenticated;
create policy tenant_guard on contract_crm.storage_legacy_objects as restrictive for all to authenticated
  using (tenant_id = contract_crm.current_tenant_id()) with check (tenant_id = contract_crm.current_tenant_id());
create policy support_readonly_ins on contract_crm.storage_legacy_objects as restrictive for insert to authenticated
  with check (not contract_crm.in_support_session());
create policy support_readonly_upd on contract_crm.storage_legacy_objects as restrictive for update to authenticated
  using (not contract_crm.in_support_session()) with check (not contract_crm.in_support_session());
create policy support_readonly_del on contract_crm.storage_legacy_objects as restrictive for delete to authenticated
  using (not contract_crm.in_support_session());
create trigger trg_set_tenant_id before insert on contract_crm.storage_legacy_objects
  for each row execute function contract_crm.set_tenant_id();

-- Empresa de um arquivo antigo, pelo caminho (contrato/proposta/empresa) ou por quem
-- enviou; Super Admin sem vínculo cai na empresa padrão (organization_settings 'default').
create or replace function contract_crm.backfill_storage_legacy_objects() returns integer
language plpgsql security definer set search_path = contract_crm, storage, pg_temp as $$
declare n integer;
begin
  insert into contract_crm.storage_legacy_objects (bucket_id, name, tenant_id)
  select o.bucket_id, o.name, t.tenant_id
  from storage.objects o
  cross join lateral (
    select split_part(o.name, '/', 1) s1, split_part(o.name, '/', 2) s2,
           substring(split_part(o.name, '/', 2) from '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}') s2uuid
  ) p
  cross join lateral (
    select coalesce(
      (select c.tenant_id from contract_crm.contracts c where c.id::text = p.s1),
      (select c.tenant_id from contract_crm.contracts c where c.id::text = p.s2uuid),
      (select pr.tenant_id from contract_crm.proposals pr where pr.id::text = p.s2uuid),
      (select co.tenant_id from contract_crm.companies co where co.id::text = p.s2uuid),
      (select pf.tenant_id from contract_crm.profiles pf where pf.id = o.owner and not coalesce(pf.is_super_admin, false)),
      (select os.tenant_id from contract_crm.organization_settings os where os.id = 'default')
    ) tenant_id
  ) t
  where o.bucket_id in ('contract-files', 'proposal-files')
    and not exists (select 1 from contract_crm.tenants tt where tt.id::text = p.s1)
    and t.tenant_id is not null
  on conflict (bucket_id, name) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function contract_crm.backfill_storage_legacy_objects() from public, anon, authenticated;

select contract_crm.backfill_storage_legacy_objects();

-- O arquivo é da empresa atual? (pasta da empresa ou registro de arquivo antigo)
create or replace function contract_crm.storage_object_in_my_tenant(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = contract_crm, pg_temp as $$
  select coalesce(
    split_part(p_name, '/', 1) = contract_crm.current_tenant_id()::text
    or exists (select 1 from contract_crm.storage_legacy_objects l
               where l.bucket_id = p_bucket and l.name = p_name and l.tenant_id = contract_crm.current_tenant_id()),
    false)
$$;
grant execute on function contract_crm.storage_object_in_my_tenant(text, text) to authenticated;

-- ── PARTE B (depois de publicar o código) ─────────────────────────────────────
-- select contract_crm.backfill_storage_legacy_objects();
-- Políticas RESTRICTIVE: valem junto com as antigas (que liberavam o bucket inteiro).
-- create policy tenant_files_select on storage.objects as restrictive for select to authenticated
--   using (bucket_id not in ('contract-files','proposal-files') or contract_crm.storage_object_in_my_tenant(bucket_id, name));
-- create policy tenant_files_insert on storage.objects as restrictive for insert to authenticated
--   with check (bucket_id not in ('contract-files','proposal-files')
--     or (split_part(name, '/', 1) = contract_crm.current_tenant_id()::text and not contract_crm.in_support_session()));
-- create policy tenant_files_update on storage.objects as restrictive for update to authenticated
--   using (bucket_id not in ('contract-files','proposal-files') or (contract_crm.storage_object_in_my_tenant(bucket_id, name) and not contract_crm.in_support_session()))
--   with check (bucket_id not in ('contract-files','proposal-files') or (split_part(name, '/', 1) = contract_crm.current_tenant_id()::text and not contract_crm.in_support_session()));
-- create policy tenant_files_delete on storage.objects as restrictive for delete to authenticated
--   using (bucket_id not in ('contract-files','proposal-files') or (contract_crm.storage_object_in_my_tenant(bucket_id, name) and not contract_crm.in_support_session()));
