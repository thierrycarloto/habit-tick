# Habit Tick � Servidor de lembretes (Web Push)

Gratuito no Cloudflare (Workers + D1 + Cron). Precisa do Node.js instalado.

1. Gerar as chaves VAPID:
   ```
   npx web-push generate-vapid-keys
   ```
   Guarde a **Public Key** e a **Private Key**.
   



2. Entrar e criar o banco (dentro desta pasta `push-worker`):
   ```
   npx wrangler login
   npx wrangler d1 create habit-tick-db
   ```
   Copie o `database_id` exibido para o `wrangler.toml`.

3. Criar a tabela:
   ```
   npx wrangler d1 execute habit-tick-db --remote --file=schema.sql
   ```

4. Configurar as chaves e publicar:
   ```
   npx wrangler secret put VAPID_PUBLIC
   npx wrangler secret put VAPID_PRIVATE
   npx wrangler secret put VAPID_SUBJECT      (ex.: mailto:seuemail@gmail.com)
   npx wrangler deploy
   ```
   O deploy mostra a URL, ex.: `https://habit-tick-push.SEUUSUARIO.workers.dev`.

5. No `app.js`, preencha no topo:
   ```js
   const PUSH_SERVER_URL = 'https://habit-tick-push.SEUUSUARIO.workers.dev';
   const VAPID_PUBLIC_KEY = '<Public Key do passo 1>';
   ```
   Publique o app novamente (GitHub Pages) e **reinstale/atualize o PWA** no Android.

6. No app, ative um lembrete, permita notifica��es e salve. Pronto: o aviso chega
   mesmo com o app fechado.

Dica Android: desative a otimiza��o de bateria para o Chrome/PWA, sen�o o sistema pode atrasar o push.
