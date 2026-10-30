-- Tipos de mensagem aceitos: além de foto, áudio, documento e vídeo, agora também
-- apagada para todos (revoked), chamada perdida (call), contato (contact), localização e figurinha.
-- Antes, chamadas e contatos eram recusados pelo banco e não apareciam na Central.
alter table contract_crm.contract_whatsapp_messages drop constraint if exists contract_whatsapp_messages_media_type_check;
alter table contract_crm.contract_whatsapp_messages add constraint contract_whatsapp_messages_media_type_check
  check (media_type = any (array['image', 'audio', 'document', 'video', 'revoked', 'call', 'contact', 'location', 'sticker']));
