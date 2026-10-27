-- Varejo: preço e promoção por cor (gravados em cada variação da cor). Vazio = segue a peça.
alter table contract_crm.retail_product_variants add column if not exists price numeric(12,2);
alter table contract_crm.retail_product_variants add column if not exists promo_price numeric(12,2);
alter table contract_crm.retail_product_variants drop constraint if exists retail_variant_price_pos;
alter table contract_crm.retail_product_variants add constraint retail_variant_price_pos check ((price is null or price > 0) and (promo_price is null or promo_price > 0));
