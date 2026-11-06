-- Imagens públicas (logos, fundos): qualquer um pode VER (são públicas), mas só a empresa dona
-- da pasta (<tenant_id>/...) grava, troca ou apaga. Antes, qualquer usuário logado de qualquer
-- empresa podia apagar o logo de outra. Suporte (acesso liberado) segue só leitura.
drop policy if exists public_assets_tenant_ins on storage.objects;
create policy public_assets_tenant_ins on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'public-assets' or (split_part(name, '/', 1) = contract_crm.current_tenant_id()::text and not contract_crm.in_support_session()));
drop policy if exists public_assets_tenant_upd on storage.objects;
create policy public_assets_tenant_upd on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'public-assets' or (split_part(name, '/', 1) = contract_crm.current_tenant_id()::text and not contract_crm.in_support_session()))
  with check (bucket_id <> 'public-assets' or (split_part(name, '/', 1) = contract_crm.current_tenant_id()::text and not contract_crm.in_support_session()));
drop policy if exists public_assets_tenant_del on storage.objects;
create policy public_assets_tenant_del on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'public-assets' or (split_part(name, '/', 1) = contract_crm.current_tenant_id()::text and not contract_crm.in_support_session()));
