import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Lista de migrações consolidadas — cada uma é idempotente (add column if not exists, create table if not exists).
// Roda via POST /api/admin/run-migrations com header x-migration-key.
// Cole no console do Supabase como alternativa.
const MIGRATIONS = [
  {
    id: 'portfolio-fields-v1',
    description: 'Campos da carteira: contacts (cnpj, cargo), pipelines (revenue_type), contracts (contract_number, sankhya_code, monthly_value, valid_until, engineer_id, coordinator_id, abc_curve...)',
    sqls: [
      `alter table contract_crm.contacts add column if not exists cnpj text`,
      `alter table contract_crm.contacts add column if not exists cargo text`,
      `alter table contract_crm.pipelines add column if not exists revenue_type text default 'mrr'`,
      `alter table contract_crm.pipeline_runs add column if not exists tag_id uuid references contract_crm.tags(id) on delete set null`,
      `alter table contract_crm.pipeline_runs add column if not exists revenue_type text`,
      `alter table contract_crm.contracts add column if not exists contract_number text`,
      `alter table contract_crm.contracts add column if not exists sankhya_code text`,
      `alter table contract_crm.contracts add column if not exists cnpj_billing text`,
      `alter table contract_crm.contracts add column if not exists contract_type text`,
      `alter table contract_crm.contracts add column if not exists monthly_value numeric(14,2)`,
      `alter table contract_crm.contracts add column if not exists validity_months integer`,
      `alter table contract_crm.contracts add column if not exists valid_until date`,
      `alter table contract_crm.contracts add column if not exists engineer_id uuid references contract_crm.profiles(id) on delete set null`,
      `alter table contract_crm.contracts add column if not exists coordinator_id uuid references contract_crm.profiles(id) on delete set null`,
      `alter table contract_crm.contracts add column if not exists abc_curve text`,
      `alter table contract_crm.contracts add column if not exists sphere text`,
      `alter table contract_crm.contracts add column if not exists nature text`,
      `alter table contract_crm.contracts add column if not exists region text`,
      `alter table contract_crm.contracts add column if not exists score_billing numeric(4,1)`,
      `alter table contract_crm.contracts add column if not exists score_visit numeric(4,1)`,
      `alter table contract_crm.contracts add column if not exists score_loyalty numeric(4,1)`,
      `alter table contract_crm.contracts add column if not exists has_measurement boolean default false`,
      `alter table contract_crm.contracts add column if not exists has_audit boolean default false`,
      `alter table contract_crm.contracts add column if not exists has_management_plan boolean default false`,
      `alter table contract_crm.contracts add column if not exists has_parts_included boolean default false`,
      `alter table contract_crm.contracts add column if not exists municipality text`,
      `alter table contract_crm.contracts add column if not exists state text`,
      `alter table contract_crm.contracts add column if not exists internal_notes text`,
    ],
  },
  {
    id: 'pipeline-field-configs-v1',
    description: 'Tabela de configuração de campos por funil',
    sqls: [
      `create table if not exists contract_crm.pipeline_field_configs (id uuid primary key default gen_random_uuid(), pipeline_id uuid not null references contract_crm.pipelines(id) on delete cascade, field_key text not null, field_label text not null, visibility text not null default 'optional', display_order integer not null default 0, created_at timestamptz not null default now(), unique (pipeline_id, field_key))`,
      `do $do$ begin if not exists (select 1 from pg_policies where schemaname='contract_crm' and tablename='pipeline_field_configs' and policyname='pipeline_field_configs_all') then alter table contract_crm.pipeline_field_configs enable row level security; create policy "pipeline_field_configs_all" on contract_crm.pipeline_field_configs for all using (auth.role() = 'authenticated'); end if; end $do$`,
    ],
  },
  {
    id: 'contract-measurements-v1',
    description: 'Tabela de medições mensais',
    sqls: [
      `create table if not exists contract_crm.contract_measurements (id uuid primary key default gen_random_uuid(), contract_id uuid not null references contract_crm.contracts(id) on delete cascade, reference_month date not null, value numeric(14,2) not null, description text, status text not null default 'rascunho', submitted_by uuid references contract_crm.profiles(id), submitted_at timestamptz, approved_by uuid references contract_crm.profiles(id), approved_at timestamptz, sankhya_sent_at timestamptz, created_at timestamptz not null default now())`,
      `do $do$ begin if not exists (select 1 from pg_policies where schemaname='contract_crm' and tablename='contract_measurements' and policyname='measurements_all') then alter table contract_crm.contract_measurements enable row level security; create policy "measurements_all" on contract_crm.contract_measurements for all using (auth.role() = 'authenticated'); end if; end $do$`,
    ],
  },
  {
    id: 'org-settings-whatsapp-zapsign-v1',
    description: 'Colunas de WhatsApp e ZapSign em organization_settings',
    sqls: [
      `alter table contract_crm.organization_settings add column if not exists whatsapp_daily_auto_limit integer not null default 3`,
      `alter table contract_crm.organization_settings add column if not exists whatsapp_is_online boolean not null default false`,
      `alter table contract_crm.organization_settings add column if not exists whatsapp_welcome_message text`,
      `alter table contract_crm.organization_settings add column if not exists whatsapp_welcome_message_online text`,
      `alter table contract_crm.organization_settings add column if not exists whatsapp_reminder_message text`,
      `alter table contract_crm.organization_settings add column if not exists zapsign_api_token text`,
    ],
  },
  {
    id: 'whatsapp-opt-outs-v1',
    description: 'Tabela de opt-outs do WhatsApp',
    sqls: [
      `create table if not exists contract_crm.whatsapp_opt_outs (phone text primary key, created_at timestamptz not null default now())`,
      `do $do$ begin if not exists (select 1 from pg_policies where schemaname='contract_crm' and tablename='whatsapp_opt_outs' and policyname='whatsapp_opt_outs_all') then alter table contract_crm.whatsapp_opt_outs enable row level security; create policy "whatsapp_opt_outs_all" on contract_crm.whatsapp_opt_outs for all using (true); end if; end $do$`,
    ],
  },
  {
    id: 'zapsign-tables-v1',
    description: 'Tabelas do ZapSign',
    sqls: [
      `create table if not exists contract_crm.zapsign_templates (id uuid primary key default gen_random_uuid(), name text not null, description text, zapsign_template_token text not null, type text not null default 'contrato', created_at timestamptz not null default now())`,
      `do $do$ begin if not exists (select 1 from pg_policies where schemaname='contract_crm' and tablename='zapsign_templates' and policyname='zapsign_templates_all') then alter table contract_crm.zapsign_templates enable row level security; create policy "zapsign_templates_all" on contract_crm.zapsign_templates for all using (auth.role() = 'authenticated'); end if; end $do$`,
      `create table if not exists contract_crm.zapsign_documents (id uuid primary key default gen_random_uuid(), contract_id uuid not null references contract_crm.contracts(id) on delete cascade, template_id uuid references contract_crm.zapsign_templates(id) on delete set null, name text not null, zapsign_doc_token text, pdf_url text, signed_pdf_url text, status text not null default 'pendente', sent_at timestamptz, signed_at timestamptz, error_message text, created_by uuid references contract_crm.profiles(id), created_at timestamptz not null default now())`,
      `do $do$ begin if not exists (select 1 from pg_policies where schemaname='contract_crm' and tablename='zapsign_documents' and policyname='zapsign_documents_all') then alter table contract_crm.zapsign_documents enable row level security; create policy "zapsign_documents_all" on contract_crm.zapsign_documents for all using (auth.role() = 'authenticated'); end if; end $do$`,
    ],
  },,
  {
    id: 'impersonation-tenant-isolation-v1',
    description: 'Adiciona tenant_id em pipelines, companies, contracts e lost_reasons para isolamento correto no modo impersonation (admin client sem RLS)',
    sqls: [
      // --- pipelines ---
      `alter table contract_crm.pipelines add column if not exists tenant_id uuid references contract_crm.tenants(id) on delete cascade`,
      `update contract_crm.pipelines p set tenant_id = (select pr.tenant_id from contract_crm.profiles pr join contract_crm.pipeline_runs r on r.created_by = pr.id where r.pipeline_id = p.id limit 1) where tenant_id is null`,

      // --- companies ---
      `alter table contract_crm.companies add column if not exists tenant_id uuid references contract_crm.tenants(id) on delete cascade`,
      `update contract_crm.companies c set tenant_id = (select pr.tenant_id from contract_crm.profiles pr where pr.id = c.owner_id limit 1) where tenant_id is null and owner_id is not null`,

      // --- contracts ---
      `alter table contract_crm.contracts add column if not exists tenant_id uuid references contract_crm.tenants(id) on delete cascade`,
      `update contract_crm.contracts c set tenant_id = (select pr.tenant_id from contract_crm.profiles pr where pr.id = c.owner_id limit 1) where tenant_id is null`,

      // --- lost_reasons ---
      `alter table contract_crm.lost_reasons add column if not exists tenant_id uuid references contract_crm.tenants(id) on delete cascade`,
      `update contract_crm.lost_reasons lr set tenant_id = (select p.tenant_id from contract_crm.profiles p where p.role = 'admin' limit 1) where tenant_id is null`,

      // --- activities ---
      `alter table contract_crm.activities add column if not exists tenant_id uuid references contract_crm.tenants(id) on delete cascade`,
      `update contract_crm.activities a set tenant_id = (select pr.tenant_id from contract_crm.profiles pr where pr.id = a.user_id limit 1) where tenant_id is null and user_id is not null`,
    ],
  }
]

export async function GET() {
  return NextResponse.json({
    message: 'API de migrações ORBIS CRM',
    usage: 'POST com header: x-migration-key: orbis-migrate-2026',
    migrations: MIGRATIONS.map(m => ({ id: m.id, description: m.description, statements: m.sqls.length }))
  })
}

export async function POST(request: Request) {
  const key = request.headers.get('x-migration-key')
  if (key !== (process.env.MIGRATION_SECRET_KEY ?? 'orbis-migrate-2026')) {
    return NextResponse.json({ error: 'Chave inválida' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const results: any[] = []

  for (const migration of MIGRATIONS) {
    const migrationResults: string[] = []
    let hasError = false

    for (const sql of migration.sqls) {
      // Cada SQL roda como query direta via Supabase
      const { error } = await (supabase as any).rpc('exec_migration_sql', { p_sql: sql }).catch(async (e: any) => {
        // Se o RPC não existir, tenta via from().select() que o admin client permite
        return { error: { message: `RPC não disponível: ${e.message}. Rode o SQL manualmente.` } }
      })
      if (error) {
        migrationResults.push(`ERRO: ${error.message}`)
        hasError = true
      } else {
        migrationResults.push('ok')
      }
    }

    results.push({
      id: migration.id,
      description: migration.description,
      status: hasError ? 'partial' : 'ok',
      details: migrationResults,
    })
  }

  return NextResponse.json({ results, tip: 'Se aparecer "RPC não disponível", copie os SQLs da lista abaixo e rode no SQL Editor do Supabase.', migrations: MIGRATIONS.map(m => ({ id: m.id, sqls: m.sqls })) })
}
