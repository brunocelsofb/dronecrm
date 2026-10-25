-- Varejo: Estúdio de imagens com IA (Gemini / ChatGPT) com a conta da própria responsável.
-- A chave é do usuário (criptografada), não da empresa: só quem conectou usa.

create table if not exists contract_crm.retail_ai_connections (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references contract_crm.tenants(id) on delete cascade,
  user_id    uuid not null,
  provider   text not null check (provider in ('gemini', 'openai')),
  key_enc    text not null,
  key_last4  text,
  model      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, provider)
);

-- Banco de imagens geradas (modelos virtuais, cenários e fotos de look)
create table if not exists contract_crm.retail_ai_images (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references contract_crm.tenants(id) on delete cascade,
  kind       text not null check (kind in ('modelo', 'cenario', 'look')),
  title      text,
  path       text not null,
  provider   text not null,
  model      text,
  prompt     text,
  inputs     jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists retail_ai_images_tenant on contract_crm.retail_ai_images (tenant_id, kind, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['retail_ai_connections', 'retail_ai_images'] loop
    execute format('alter table contract_crm.%I enable row level security', t);
    execute format('revoke all on contract_crm.%I from anon', t);
    execute format('create policy tenant_guard on contract_crm.%I as restrictive for all to authenticated using (tenant_id = contract_crm.current_tenant_id()) with check (tenant_id = contract_crm.current_tenant_id())', t);
    execute format('create policy tenant_access on contract_crm.%I for all to authenticated using (tenant_id = contract_crm.current_tenant_id()) with check (tenant_id = contract_crm.current_tenant_id())', t);
    execute format('create policy support_readonly_ins on contract_crm.%I as restrictive for insert to authenticated with check (not contract_crm.in_support_session())', t);
    execute format('create policy support_readonly_upd on contract_crm.%I as restrictive for update to authenticated using (not contract_crm.in_support_session()) with check (not contract_crm.in_support_session())', t);
    execute format('create policy support_readonly_del on contract_crm.%I as restrictive for delete to authenticated using (not contract_crm.in_support_session())', t);
    execute format('create trigger trg_set_tenant_id before insert on contract_crm.%I for each row execute function contract_crm.set_tenant_id()', t);
  end loop;
end $$;
-- A conexão só é visível para o dono (nem colegas da empresa)
create policy owner_only on contract_crm.retail_ai_connections as restrictive for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
