-- Chaves da inscrição push (p256dh/auth) para enviar push com conteúdo criptografado.
-- Aplicar uma vez em bancos criados antes desta coluna:
--   npx wrangler d1 execute habit-tick-db --remote --file=migrations/001_push_keys.sql
ALTER TABLE subs ADD COLUMN push_keys TEXT NOT NULL DEFAULT '';

