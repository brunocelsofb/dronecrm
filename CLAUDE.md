# Regras do projeto (CRM multiempresa)

O CRM é um produto vendido por licença. A Orbis é **uma** empresa cliente, não o dono do sistema.

## Regra principal
**Tudo o que existe no CRM precisa funcionar para qualquer empresa (tenant), inclusive as futuras.**
Nada pode ficar fixo para a Orbis: textos, e-mails, CNPJs, logos, números de WhatsApp, chaves.
O que é de uma empresa vai em `organization_settings` (linha da empresa, por `tenant_id`) ou em tabelas com `tenant_id`.

## Como acessar dados
- Telas e ações de usuário: `await createScopedAdmin()` (`src/lib/tenant/scoped-admin.ts`) — filtra e grava `tenant_id` sozinho.
  O cliente do usuário (`createClient`) também é seguro: o banco tem RLS por empresa (`tenant_guard`).
- `createAdminClient()` puro só em rotinas da plataforma: Super Admin, webhooks, crons, páginas públicas por token.
  Nesses casos, filtre `tenant_id` explicitamente.
- Empresa do contexto: `resolveTenantId({ contractId?, instanceName? })` (`src/lib/tenant/context.ts`).
- Crons: `forEachActiveTenant()` (`src/lib/tenant/cron.ts`) — uma rodada por empresa, com `CRON_SECRET`.
- Tabela nova com dados de empresa: coluna `tenant_id` + política `tenant_guard` + as três políticas
  `support_readonly_ins/upd/del` (acesso de suporte só leitura) + incluir em `TENANT_TABLES`
  (scoped-admin) e em `RESET_TABLES` (`src/lib/tenant/reset.ts`).

## Privacidade
- Super Admin não vê conteúdo de empresa: só métricas/status. "Acessar" exige liberação do admin da
  empresa (`support_access_grants`), por tempo limitado, só leitura, com registro (`support_access_log`).
- Conteúdo cifrado por empresa: colunas em `ENCRYPTED_COLUMNS` (`src/lib/crypto/content.ts`); os clientes
  do servidor cifram/decifram sozinhos. Não filtre essas colunas no banco (ilike/eq) — filtre depois de ler.
- Contrato de tratamento de dados: `src/lib/legal/dpa.ts`. Mudou o texto → suba `DPA_VERSION`.

## Integrações por empresa
- WhatsApp: servidor Evolution da plataforma (env), instâncias pertencem à empresa (`evo_instance_aliases`), limite por plano.
- Copiloto IA: chave da Anthropic da empresa, criptografada (`SETTINGS_ENCRYPTION_KEY` — nunca trocar).
- Abas liberadas: `plan_features` + ajustes do tenant (Super Admin → Planos e abas).

## Super Admin
Login da plataforma (conta 2B). Vê a própria conta; outra empresa só por "Acessar" (`profiles.impersonating_tenant_id`).
Nunca aparece nem pode ser alterado pelas telas de uma empresa.

## Ajuda nas telas
Toda tela nova precisa de explicação em `src/lib/help/page-help.ts` (`RULES` para a página e `NAV_HELP` se for aba do menu).
Aparece no "ⓘ Como funciona esta tela" (topo) e ao passar o mouse no menu. Texto curto e neutro (vale para qualquer empresa).

## Números e cores
- Porcentagem sempre com 1 casa decimal e dinheiro sempre com centavos, padrão brasileiro: use `fmtPct`, `fmtBRL` e `fmtNum1` (`src/lib/format.ts`).
- Cores só da paleta oficial (tokens em `src/app/globals.css`): primárias #1B556B, #E98C5F, #32AF9D; secundárias #83D0F5, #00AFD1, #FFE596, #524E9C, #AF5B65, #FBEE66.
