-- Varejo: juntar cadastros da mesma peça (uma cor por código) numa peça só, com várias cores.
-- Tudo num passo só (ou junta tudo ou nada). As variações mudam de peça mantendo id, SKU e
-- estoque; pedidos, histórico do estoque e looks passam a apontar para a peça principal.
-- p_colors: { "<id do cadastro>": "Nova cor" } — renomeia a cor (todas as variações) daquele
--           cadastro antes de juntar; só para cadastro com uma cor (ou sem cor).
-- Cor e tamanho que já existem na principal: o estoque é somado na variação da principal.
create or replace function contract_crm.retail_merge_products(
  p_tenant uuid, p_user uuid, p_main uuid, p_others uuid[], p_price_from uuid, p_colors jsonb)
returns text language plpgsql security definer set search_path to 'contract_crm', 'pg_temp' as $function$
declare
  m record; o record; v record; hit record; src record;
  n int; publish boolean := false; m_price numeric; m_promo numeric;
  v_photos jsonb; v_meta jsonb; ph text; ocolor text; ncolors int; newc text;
begin
  if p_main is null or p_others is null or array_length(p_others, 1) is null then return 'Escolha as peças.'; end if;
  if p_main = any(p_others) then return 'A peça principal não pode estar na lista para juntar.'; end if;
  select count(*) into n from contract_crm.retail_products where tenant_id = p_tenant and id = any(p_others || p_main);
  if n <> array_length(p_others, 1) + 1 then return 'Alguma peça não foi encontrada.'; end if;
  if p_price_from is not null and not (p_price_from = p_main or p_price_from = any(p_others)) then return 'Preço inválido.'; end if;

  select * into m from contract_crm.retail_products where id = p_main and tenant_id = p_tenant for update;
  v_photos := coalesce(m.photos, '[]'::jsonb);
  v_meta := coalesce(m.photo_meta, '{}'::jsonb);
  publish := m.status = 'publicado';
  -- Fotos da principal sem cor recebem a cor dela (se ela tinha uma cor só)
  ocolor := null;
  select max(color) into ocolor from contract_crm.retail_product_variants where product_id = p_main having count(distinct coalesce(color, '')) = 1;
  if ocolor is not null then
    for ph in select jsonb_array_elements_text(v_photos) loop
      if coalesce(v_meta -> ph ->> 'color', '') = '' then
        v_meta := v_meta || jsonb_build_object(ph, jsonb_build_object('color', ocolor, 'model', coalesce((v_meta -> ph ->> 'model')::boolean, ph like '%/ia/%')));
      end if;
    end loop;
  end if;
  -- Preço escolhido (de qualquer um dos cadastros)
  if p_price_from is not null and p_price_from <> p_main then
    select price, promo_price, cost_price into src from contract_crm.retail_products where id = p_price_from and tenant_id = p_tenant;
    update contract_crm.retail_products set price = src.price, promo_price = src.promo_price, cost_price = coalesce(src.cost_price, cost_price) where id = p_main;
  end if;

  select price, promo_price into m_price, m_promo from contract_crm.retail_products where id = p_main;
  -- Principal sem preço: usa o primeiro cadastro que tem preço
  if m_price is null then
    select price, promo_price into m_price, m_promo from contract_crm.retail_products where id = any(p_others) and tenant_id = p_tenant and price is not null order by code limit 1;
    if m_price is not null then update contract_crm.retail_products set price = m_price, promo_price = m_promo where id = p_main; end if;
  end if;

  perform set_config('retail.stock_kind', 'ajuste', true);
  perform set_config('retail.stock_user', coalesce(p_user::text, ''), true);
  perform set_config('retail.stock_note', 'junção de cadastros da mesma peça', true);

  for o in select * from contract_crm.retail_products where id = any(p_others) and tenant_id = p_tenant order by code for update loop
    -- Renomear a cor do cadastro (quando pedido)
    newc := nullif(trim(coalesce(p_colors ->> o.id::text, '')), '');
    select count(distinct coalesce(color, '')) into ncolors from contract_crm.retail_product_variants where product_id = o.id;
    if newc is not null then
      if ncolors > 1 then raise exception 'O cadastro % tem mais de uma cor; não dá para renomear.', o.code; end if;
      update contract_crm.retail_product_variants set color = left(newc, 60), updated_at = now() where product_id = o.id;
    end if;
    ocolor := null;
    select max(color) into ocolor from contract_crm.retail_product_variants where product_id = o.id
      having count(distinct coalesce(color, '')) = 1;
    -- Preço diferente da principal: a cor mantém o preço dela (preço por cor)
    if o.price is not null and (o.price is distinct from m_price or o.promo_price is distinct from m_promo) then
      update contract_crm.retail_product_variants
        set promo_price = case when price is null then o.promo_price else promo_price end,
            price = coalesce(price, o.price), updated_at = now()
        where product_id = o.id;
    end if;

    -- Variações: move para a principal; cor e tamanho repetidos somam o estoque
    for v in select * from contract_crm.retail_product_variants where product_id = o.id loop
      select * into hit from contract_crm.retail_product_variants
        where product_id = p_main and color is not distinct from v.color and size is not distinct from v.size;
      if found then
        if exists (select 1 from contract_crm.retail_order_items where variant_id = v.id) then
          raise exception 'A variação % (%, %) já tem pedido e a principal tem a mesma cor e tamanho. Renomeie a cor.', v.sku, coalesce(v.color, 'sem cor'), coalesce(v.size, 'sem tamanho');
        end if;
        update contract_crm.retail_product_variants set stock = stock + v.stock, active = (active or v.active), updated_at = now() where id = hit.id;
        update contract_crm.retail_product_variants set stock = 0, updated_at = now() where id = v.id;
        delete from contract_crm.retail_product_variants where id = v.id;
      else
        update contract_crm.retail_product_variants set product_id = p_main, updated_at = now() where id = v.id;
      end if;
    end loop;

    -- Fotos: entram na principal já marcadas com a cor do cadastro (se ele tinha uma cor só)
    for ph in select jsonb_array_elements_text(coalesce(o.photos, '[]'::jsonb)) loop
      if not v_photos ? ph then v_photos := v_photos || to_jsonb(ph); end if;
      v_meta := v_meta || jsonb_build_object(ph, jsonb_build_object(
        'color', coalesce(o.photo_meta -> ph ->> 'color', ocolor),
        'model', coalesce((o.photo_meta -> ph ->> 'model')::boolean, ph like '%/ia/%')));
    end loop;

    -- Campos vazios da principal herdam do cadastro; ocasiões somam
    update contract_crm.retail_products set
      category = coalesce(category, o.category), description = coalesce(description, o.description),
      composition = coalesce(composition, o.composition), care = coalesce(care, o.care),
      measures = coalesce(measures, o.measures), weight_g = coalesce(weight_g, o.weight_g),
      cost_price = coalesce(cost_price, o.cost_price),
      occasions = (select array(select distinct x from unnest(coalesce(occasions, '{}') || coalesce(o.occasions, '{}')) x))
    where id = p_main;
    if o.status = 'publicado' then publish := true; end if;

    -- Pedidos, histórico e looks apontam para a principal
    update contract_crm.retail_order_items set product_id = p_main where product_id = o.id;
    update contract_crm.retail_stock_movements set product_id = p_main where product_id = o.id;
    update contract_crm.retail_looks set product_ids = (select array(select distinct x from unnest(array_replace(product_ids, o.id, p_main)) x)), updated_at = now()
      where tenant_id = p_tenant and o.id = any(product_ids);
    delete from contract_crm.retail_products where id = o.id;
  end loop;

  if jsonb_array_length(v_photos) > 8 then raise exception 'Juntas, as peças ficam com % fotos (máximo 8). Remova fotos antes de juntar.', jsonb_array_length(v_photos); end if;

  update contract_crm.retail_products set photos = v_photos, photo_meta = v_meta,
    status = case when publish and price is not null then 'publicado' else status end, updated_at = now()
  where id = p_main;

  perform set_config('retail.stock_kind', '', true);
  perform set_config('retail.stock_user', '', true);
  perform set_config('retail.stock_note', '', true);
  return null;
end $function$;
revoke all on function contract_crm.retail_merge_products(uuid, uuid, uuid, uuid[], uuid, jsonb) from public, anon, authenticated;
grant execute on function contract_crm.retail_merge_products(uuid, uuid, uuid, uuid[], uuid, jsonb) to service_role;
