-- Arquivos de exportação (dados e fotos): privado, só o servidor grava e lê
-- (download por link assinado de 10 minutos). Pastas por empresa: <tenant_id>/exportacoes/...
-- Limpeza: a cada nova exportação (mais de 15 min) e no cron diário de privacidade (mais de 2 h).
insert into storage.buckets (id, name, public)
values ('tenant-exports', 'tenant-exports', false)
on conflict (id) do nothing;
