-- Varejo: código de barras de cada variação (EAN/GTIN da etiqueta do fornecedor ou outro).
-- Único por empresa: o mesmo código não pode apontar para duas variações.
alter table contract_crm.retail_product_variants add column if not exists barcode text;
create unique index if not exists retail_product_variants_tenant_barcode on contract_crm.retail_product_variants (tenant_id, barcode) where barcode is not null;
