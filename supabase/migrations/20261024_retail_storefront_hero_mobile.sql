-- Vitrine: capa própria para celular (vertical); a do computador continua em hero_photo
alter table contract_crm.retail_storefronts add column if not exists hero_photo_mobile text;
