-- Módulo Varejo (aba 'varejo', desligada em todos os planos; liberada por empresa
-- em Super Admin → Planos e abas). Etapa 1: produtos e variações.
--
-- Regras:
--   - saldo por variação (cor + tamanho), nunca um saldo único por peça;
--   - código da peça (ex.: PC682) e SKU da variação únicos dentro da empresa;
--   - fotos no bucket público retail-media, sempre em "<tenant_id>/produtos/...",
--     gravadas só pelo servidor (link de envio assinado); leitura pública (vitrine).

create table if not exists contract_crm.retail_products (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references contract_crm.tenants(id) on delete cascade,
  code        text not null,
  name        text not null,
  category    text,
  description text,
  composition text,
  care        text,
  measures    text,
  price       numeric(12,2) not null check (price >= 0),
  promo_price numeric(12,2) check (promo_price is null or promo_price >= 0),
  status      text not null default 'rascunho' check (status in ('rascunho', 'publicado', 'arquivado')),
  photos      jsonb not null default '[]'::jsonb,
  weight_g    integer check (weight_g is null or weight_g >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, code)
);
create index if not exists retail_products_tenant_status on contract_crm.retail_products (tenant_id, status);

create table if not exists contract_crm.retail_product_variants (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references contract_crm.tenants(id) on delete cascade,
  product_id  uuid not null references contract_crm.retail_products(id) on delete cascade,
  sku         text not null,
  color       text,
  size        text,
  stock       integer not null default 0 check (stock >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, sku),
  unique nulls not distinct (product_id, color, size)
);
create index if not exists retail_variants_product on contract_crm.retail_product_variants (product_id);

-- Mesmas regras de toda tabela de empresa
do $$
declare t text;
begin
  foreach t in array array['retail_products', 'retail_product_variants'] loop
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

-- Variação herda a empresa do produto e não pode apontar para produto de outra empresa
create or replace function contract_crm.retail_variant_tenant_check() returns trigger
language plpgsql security definer set search_path = contract_crm, pg_temp as $$
declare p_tenant uuid;
begin
  select tenant_id into p_tenant from contract_crm.retail_products where id = new.product_id;
  if p_tenant is null then raise exception 'Produto não encontrado.'; end if;
  if new.tenant_id is null then new.tenant_id := p_tenant; end if;
  if new.tenant_id <> p_tenant then raise exception 'Variação e produto de empresas diferentes.' using errcode = '42501'; end if;
  return new;
end $$;
create trigger trg_retail_variant_tenant before insert or update on contract_crm.retail_product_variants
  for each row execute function contract_crm.retail_variant_tenant_check();

-- Fotos da vitrine: bucket público, só o servidor grava (sem política para authenticated)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('retail-media', 'retail-media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;
