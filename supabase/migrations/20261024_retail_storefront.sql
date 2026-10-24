-- Varejo: vitrine (landing) da loja, hospedada fora do Drone (Cloudflare), que lê o catálogo
-- e manda pedidos pela API pública do Drone. Uma vitrine por empresa.
--   slug     → endereço de teste (ex.: loja.workers.dev/?loja=amaras)
--   domains  → domínios da loja (ex.: amaras.com.br); nunca repetidos entre empresas
--   occasions→ ocasiões que a loja usa para segmentar (trabalho, igreja, festa…)
create table if not exists contract_crm.retail_storefronts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null unique references contract_crm.tenants(id) on delete cascade,
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  domains     text[] not null default '{}',
  enabled     boolean not null default false,
  whatsapp    text check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$'),
  title       text,
  tagline     text,
  about       text,
  hero_photo  text,
  occasions   jsonb not null default '[]'::jsonb,
  theme       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists retail_storefronts_domains on contract_crm.retail_storefronts using gin (domains);

-- Domínio não pode estar em duas empresas
create or replace function contract_crm.retail_storefront_domains_check() returns trigger
language plpgsql security definer set search_path = contract_crm, pg_temp as $$
begin
  if exists (select 1 from contract_crm.retail_storefronts s where s.id <> new.id and s.domains && new.domains) then
    raise exception 'Este domínio já está em outra vitrine.' using errcode = '23505';
  end if;
  return new;
end $$;
create trigger trg_retail_storefront_domains before insert or update on contract_crm.retail_storefronts
  for each row execute function contract_crm.retail_storefront_domains_check();

-- Looks: combinações de peças por ocasião
create table if not exists contract_crm.retail_looks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references contract_crm.tenants(id) on delete cascade,
  name        text not null check (length(name) between 1 and 80),
  occasion    text,
  description text,
  product_ids uuid[] not null default '{}',
  cover_photo text,
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists retail_looks_tenant on contract_crm.retail_looks (tenant_id, active, position);

-- Ocasiões de cada peça (ids das ocasiões da vitrine)
alter table contract_crm.retail_products add column if not exists occasions text[] not null default '{}';

do $$
declare t text;
begin
  foreach t in array array['retail_storefronts', 'retail_looks'] loop
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
