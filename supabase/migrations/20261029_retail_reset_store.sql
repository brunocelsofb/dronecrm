-- Varejo: zerar a loja para recomeçar (peças, estoque, looks e pedidos), tudo ou nada.
-- NÃO mexe em: Estúdio IA (retail_ai_images, retail_ai_connections), aparência da vitrine
-- (retail_storefronts, exceto capa que fosse foto de peça), Custos e preço, Mensagens e Clientes.
-- Pedidos levam junto itens, eventos, mensagens e pontos de fidelidade deles (cascade).
create or replace function contract_crm.retail_reset_store(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path to 'contract_crm', 'pg_temp' as $function$
declare n_orders int; n_looks int; n_moves int; n_products int; n_variants int;
begin
  if p_tenant is null then raise exception 'Empresa inválida.'; end if;
  select count(*) into n_variants from contract_crm.retail_product_variants where tenant_id = p_tenant;
  delete from contract_crm.retail_orders where tenant_id = p_tenant; get diagnostics n_orders = row_count;
  delete from contract_crm.retail_looks where tenant_id = p_tenant; get diagnostics n_looks = row_count;
  delete from contract_crm.retail_stock_movements where tenant_id = p_tenant; get diagnostics n_moves = row_count;
  delete from contract_crm.retail_products where tenant_id = p_tenant; get diagnostics n_products = row_count;
  -- capa da vitrine que fosse foto de peça (apagada) volta a vazio; capa do Estúdio IA/da vitrine fica
  update contract_crm.retail_storefronts set
    hero_photo = case when hero_photo like '%/produtos/%' then null else hero_photo end,
    hero_photo_mobile = case when hero_photo_mobile like '%/produtos/%' then null else hero_photo_mobile end
  where tenant_id = p_tenant;
  return jsonb_build_object('pedidos', n_orders, 'looks', n_looks, 'historico', n_moves, 'pecas', n_products, 'variacoes', n_variants);
end $function$;
revoke all on function contract_crm.retail_reset_store(uuid) from public, anon, authenticated;
grant execute on function contract_crm.retail_reset_store(uuid) to service_role;
