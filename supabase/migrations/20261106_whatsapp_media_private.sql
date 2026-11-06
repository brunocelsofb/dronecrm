-- Mídias de WhatsApp gravadas pelo servidor de WhatsApp (chave de serviço): deixam de ser públicas.
-- O CRM não usa esses endereços (abre as mídias por /api/whatsapp/media, com login e empresa).
update storage.buckets set public = false where id = 'whatsapp-media';
drop policy if exists whatsapp_media_public_read on storage.objects;
