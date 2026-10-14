// ─── Copiloto IA — parte INTERNA (time Orbis) ─────────────────────────────────
// Configurações em organization_settings.copilot_settings:
//   internal_to / internal_cc        → destinatários padrão dos e-mails internos
//   internal_templates / _subjects   → textos (ganho, renovado)
//   tech_team_emails                 → time técnico (relatório mensal de implantação)
//   impl_weeks                       → prazo médio da implantação (relatório final)
//   impl_report_day / _owner_id      → dia do mês e responsável do relatório mensal
//   extra_cc_emails                  → (externo) cópia extra padrão nos avisos ao cliente
//
// Regra: e-mails internos NUNCA levam valores — só cliente, número e período.

export type InternalKey = 'ganho' | 'renovado'

export const INTERNAL_LEVELS: { key: InternalKey; label: string; hint: string }[] = [
  { key: 'ganho',    label: 'Contrato fechado (ganho)', hint: 'Quando o consultor marca Ganho no funil de vendas (Mercado Privado/Público).' },
  { key: 'renovado', label: 'Contrato renovado',        hint: 'Quando o consultor marca Renovado no funil de Gestão de Contratos.' },
]

export const INTERNAL_VARIABLES: { key: string; description: string }[] = [
  { key: 'cliente',    description: 'Nome do cliente' },
  { key: 'contrato',   description: 'Número do contrato' },
  { key: 'inicio',     description: 'Início da vigência (dd/mm/aaaa)' },
  { key: 'vencimento', description: 'Fim da vigência (dd/mm/aaaa)' },
  { key: 'consultor',  description: 'Consultor responsável pela conta' },
  { key: 'empresa',    description: 'Razão social da conta (tenant)' },
]

export const DEFAULT_INTERNAL_TEMPLATES: Record<InternalKey, string> = {
  ganho:
    'Olá, equipe!\n\n' +
    'Informamos o fechamento de um novo contrato:\n\n' +
    '• Cliente: *{{cliente}}*\n' +
    '• Contrato: *{{contrato}}*\n' +
    '• Período: *{{inicio}}* a *{{vencimento}}*\n' +
    '• Consultor responsável: {{consultor}}\n\n' +
    'Na sequência o contrato entra em implantação. O time técnico deve iniciar o cronograma no CRM ' +
    '(aba Implantação), montar a tabela de aplicabilidade e nos enviar as informações para o acompanhamento do contrato.\n\n' +
    'Atenciosamente,\nEquipe Comercial Orbis.',
  renovado:
    'Olá, equipe!\n\n' +
    'Informamos a renovação do contrato:\n\n' +
    '• Cliente: *{{cliente}}*\n' +
    '• Contrato: *{{contrato}}*\n' +
    '• Novo período: *{{inicio}}* a *{{vencimento}}*\n' +
    '• Consultor responsável: {{consultor}}\n\n' +
    'Seguimos com o acompanhamento normal do contrato.\n\n' +
    'Atenciosamente,\nEquipe Comercial Orbis.',
}

export const DEFAULT_INTERNAL_SUBJECTS: Record<InternalKey, string> = {
  ganho:    '[Novo contrato] {{cliente}} — {{contrato}}',
  renovado: '[Renovação] {{cliente}} — {{contrato}}',
}

export const DEFAULT_IMPL_WEEKS = 16
export const DEFAULT_IMPL_REPORT_DAY = 1

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseEmailList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.join(',') : typeof v === 'string' ? v : ''
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,;\s]+/)) {
    const e = part.trim()
    if (!e || !EMAIL_RE.test(e) || seen.has(e.toLowerCase())) continue
    seen.add(e.toLowerCase())
    out.push(e)
  }
  return out
}

export function invalidEmails(text: string): string[] {
  return text.split(/[,;\s]+/).map(s => s.trim()).filter(s => s && !EMAIL_RE.test(s))
}

export type InternalSettings = {
  to: string[]
  cc: string[]
  templates: Record<InternalKey, string>
  subjects: Record<InternalKey, string>
  techTeamEmails: string[]
  implWeeks: number
  implReportDay: number
  implReportOwnerId: string | null
  extraCcEmails: string[]
}

export function resolveInternalSettings(copilot: unknown): InternalSettings {
  const c = (copilot ?? {}) as Record<string, unknown>
  const tpl = (c.internal_templates ?? {}) as Record<string, unknown>
  const sub = (c.internal_subjects ?? {}) as Record<string, unknown>
  const pick = (o: Record<string, unknown>, k: InternalKey, d: string) =>
    typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string) : d
  const weeks = Number(c.impl_weeks)
  const day = Number(c.impl_report_day)
  return {
    to: parseEmailList(c.internal_to),
    cc: parseEmailList(c.internal_cc),
    templates: {
      ganho:    pick(tpl, 'ganho', DEFAULT_INTERNAL_TEMPLATES.ganho),
      renovado: pick(tpl, 'renovado', DEFAULT_INTERNAL_TEMPLATES.renovado),
    },
    subjects: {
      ganho:    pick(sub, 'ganho', DEFAULT_INTERNAL_SUBJECTS.ganho),
      renovado: pick(sub, 'renovado', DEFAULT_INTERNAL_SUBJECTS.renovado),
    },
    techTeamEmails: parseEmailList(c.tech_team_emails),
    implWeeks: Number.isInteger(weeks) && weeks >= 1 && weeks <= 104 ? weeks : DEFAULT_IMPL_WEEKS,
    implReportDay: Number.isInteger(day) && day >= 1 && day <= 28 ? day : DEFAULT_IMPL_REPORT_DAY,
    implReportOwnerId: typeof c.impl_report_owner_id === 'string' && c.impl_report_owner_id ? c.impl_report_owner_id : null,
    extraCcEmails: parseEmailList(c.extra_cc_emails),
  }
}

// ─── E-mail interno (sem valores) ─────────────────────────────────────────────

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function textToHtml(text: string): string {
  return esc(text)
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/\r\n|\r|\n/g, '<br>')
}

export function buildInternalEmailHtml(d: { badge: string; header: string; messageText: string; companyName: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;"><tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
      <tr><td style="background:#1B556B;padding:20px 32px;">
        <span style="display:inline-block;background:#83D0F5;color:#1B556B;font-size:11px;font-weight:bold;letter-spacing:1px;padding:3px 10px;border-radius:20px;">${esc(d.badge)}</span>
        <p style="margin:10px 0 0;color:#fff;font-size:18px;font-weight:bold;">${esc(d.header)}</p>
      </td></tr>
      <tr><td style="padding:28px 32px;color:#1a1a1a;font-size:14px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
        ${textToHtml(d.messageText)}
      </td></tr>
      <tr><td style="background:#f9fafb;padding:14px 32px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;color:#888;font-size:12px;">Comunicação interna — ${esc(d.companyName)}. Gerado pelo Copiloto IA do CRM.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}
