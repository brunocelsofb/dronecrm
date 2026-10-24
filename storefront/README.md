# Vitrine do Varejo (Cloudflare)

Landing das lojas do plano **Loja** do Drone Comercial. Fica na Cloudflare Workers; o CRM continua na Vercel.

- `public/` — as páginas (HTML, CSS e JS sem build). Servidas como arquivos estáticos.
- `src/worker.js` — só atende `/api/*` e repassa ao Drone, dizendo de qual domínio a vitrine foi aberta.
- `wrangler.jsonc` — configuração (nome do Worker, pasta das páginas e endereço da API do Drone em `DRONE_API`).

Nada de nenhuma loja fica fixo aqui. Nome, cores, logo, ocasiões, peças, looks e WhatsApp vêm do Drone
(**Varejo → Vitrine**). Um único Worker atende todas as lojas: o Drone descobre a loja pelo domínio
(ex.: `minhaloja.com.br`) ou pelo endereço de teste (`?loja=minhaloja`).

## Como funciona o pedido

1. A cliente monta a sacola (peças avulsas ou looks) e envia nome + WhatsApp.
2. O Worker manda para `DRONE_API/pedido`. O Drone confere preço e saldo no banco, cadastra a cliente pelo
   telefone e cria o pedido em **Novo pedido** no Funil da loja (o estoque só baixa quando o pedido fica Pago).
3. A cliente vê o botão para abrir o WhatsApp da loja com a mensagem pronta.

## Publicar na Cloudflare (uma vez)

> Confira os nomes dos menus no painel da Cloudflare: eles podem mudar.

1. Crie a conta em cloudflare.com (quem cria é o dono da plataforma; chaves e senhas não vão para o código).
2. Em **Workers & Pages → Create → Import a repository**, escolha o repositório do Drone.
3. Em **Root directory** (pasta do projeto), use `storefront`. Não precisa de comando de build;
   o de deploy é `npx wrangler deploy`.
4. Depois do primeiro deploy, a vitrine abre em `https://drone-vitrine.<sua-conta>.workers.dev/?loja=<endereço>`.
5. No Drone (Vercel), crie a variável `NEXT_PUBLIC_STOREFRONT_URL` com esse endereço (sem barra no fim) e
   publique de novo: a tela **Varejo → Vitrine** passa a mostrar o link de teste de cada loja.

A cada envio para o GitHub que mexa em `storefront/`, a Cloudflare publica sozinha.

## Domínio de cada loja

O domínio é da loja e continua dela. Dois caminhos:

- **Domínio na mesma conta da Cloudflare** (a loja aponta os servidores DNS do registro.br para a Cloudflare):
  no Worker, **Settings → Domains & Routes → Add → Custom domain** e informe `minhaloja.com.br`.
- **Domínio continua no DNS da loja**: Cloudflare for SaaS (custom hostnames). 100 domínios grátis,
  depois US$ 0,10 por domínio/mês (preço da página de planos da Cloudflare; confira antes de contratar).

Em qualquer caso, cadastre o mesmo domínio no Drone em **Varejo → Vitrine → Domínio da loja**.

## Testes

```
npm test          # testes do Worker (Node 20+)
npx wrangler dev  # roda local (precisa instalar o wrangler)
```
