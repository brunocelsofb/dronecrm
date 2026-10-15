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
- Tabela nova com dados de empresa: coluna `tenant_id` + política `tenant_guard` + incluir em `TENANT_TABLES`
  (scoped-admin) e em `RESET_TABLES` (`src/lib/tenant/reset.ts`).

## Integrações por empresa
- WhatsApp: servidor Evolution da plataforma (env), instâncias pertencem à empresa (`evo_instance_aliases`), limite por plano.
- Copiloto IA: chave da Anthropic da empresa, criptografada (`SETTINGS_ENCRYPTION_KEY` — nunca trocar).
- Abas liberadas: `plan_features` + ajustes do tenant (Super Admin → Planos e abas).

## Super Admin
Login da plataforma (conta 2B). Vê a própria conta; outra empresa só por "Acessar" (`profiles.impersonating_tenant_id`).
Nunca aparece nem pode ser alterado pelas telas de uma empresa.
