-- Peça importada sem preço entra como rascunho e com aviso; não vende nem vai para a vitrine até ter preço
alter table contract_crm.retail_products alter column price drop not null;
