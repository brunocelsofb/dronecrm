// ─── SDR de IA: configuração por empresa ──────────────────────────────────────
// Fica em organization_settings.sdr_settings (linha da empresa). O token da API
// oficial da Meta fica à parte, criptografado (sdr_meta_token_enc).
// Nada aqui é de uma empresa específica: textos e perguntas vêm da configuração.

export const SDR_MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Mais capaz (Sonnet)' },
  { id: 'claude-haiku-5-5', label: 'Mais econômico (Haiku)' },
] as const
export type SdrModel = typeof SDR_MODELS[number]['id']

export type SdrChannel = 'evolution' | 'meta'

export type SdrSettings = {
  enabled: boolean
  agent_name: string
  model: SdrModel
  instances: string[]          // números em que a IA atende a primeira mensagem
  departments: string[]        // setores da triagem (menu) que passam para a IA
  about: string                // empresa, serviços, diferenciais (base de conhecimento)
  faq: string                  // perguntas frequentes e respostas
  icp: string                  // perfil de cliente ideal
  questions: string[]          // perguntas de qualificação
  disqualify: string           // quando não é cliente / descartar
  tone: string
  sellers: string[]            // quem recebe os potenciais clientes qualificados (hunter, rodízio)
  client_owner: string         // consultor dos clientes atuais (farmer)
  client_owner_phone: string   // WhatsApp desse consultor (a IA pode informar ao cliente)
  client_auto_reply: string    // resposta automática quando um cliente cadastrado escreve no número da IA
  booking_url: string          // link de agenda padrão
  booking_links: Record<string, string> // link de agenda por vendedor
  max_replies: number
  skip_known_contacts: boolean
  handoff_department: string   // setor da conversa ao passar para o time
  channel: SdrChannel
  meta: { phone_number_id: string; api_version: string; last4: string | null }
}

export const DEFAULT_SDR_QUESTIONS = [
  'Qual o nome da empresa e a cidade?',
  'Qual a necessidade ou o problema que querem resolver?',
  'Para quando precisam (prazo)?',
  'Quem decide a contratação?',
  'Já existe orçamento ou contrato atual?',
]

export const DEFAULT_SDR_SETTINGS: SdrSettings = {
  enabled: false,
  agent_name: 'Assistente',
  model: 'claude-sonnet-5-5',
  instances: [],
  departments: [],
  about: '',
  faq: '',
  icp: '',
  questions: DEFAULT_SDR_QUESTIONS,
  disqualify: '',
  tone: 'Cordial, profissional e direto. Mensagens curtas.',
  sellers: [],
  client_owner: '',
  client_owner_phone: '',
  client_auto_reply: '',
  booking_url: '',
  booking_links: {},
  max_replies: 20,
  skip_known_contacts: true,
  handoff_department: 'vendas',
  channel: 'evolution',
  meta: { phone_number_id: '', api_version: '', last4: null },
}

const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback)
const strList = (v: unknown, maxItems: number, maxLen: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim().slice(0, maxLen)).slice(0, maxItems) : []

export function readSdrSettings(raw: unknown): SdrSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_SDR_SETTINGS
  const model = SDR_MODELS.some(m => m.id === r.model) ? (r.model as SdrModel) : d.model
  const links: Record<string, string> = {}
  if (r.booking_links && typeof r.booking_links === 'object') {
    for (const [k, v] of Object.entries(r.booking_links as Record<string, unknown>)) {
      if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) links[k] = v.trim().slice(0, 500)
    }
  }
  const meta = (r.meta && typeof r.meta === 'object' ? r.meta : {}) as Record<string, unknown>
  const maxReplies = Number(r.max_replies)
  const questions = strList(r.questions, 15, 300)
  return {
    enabled: r.enabled === true,
    agent_name: str(r.agent_name, 40).trim() || d.agent_name,
    model,
    instances: strList(r.instances, 20, 120),
    departments: strList(r.departments, 20, 60),
    about: str(r.about, 6000),
    faq: str(r.faq, 6000),
    icp: str(r.icp, 2000),
    questions: Array.isArray(r.questions) ? questions : d.questions,
    disqualify: str(r.disqualify, 2000),
    tone: str(r.tone, 500) || d.tone,
    sellers: strList(r.sellers, 50, 40),
    client_owner: str(r.client_owner, 40).trim(),
    client_owner_phone: str(r.client_owner_phone, 20).replace(/\D/g, ''),
    client_auto_reply: str(r.client_auto_reply, 600).trim(),
    booking_url: /^https?:\/\//i.test(str(r.booking_url, 500).trim()) ? str(r.booking_url, 500).trim() : '',
    booking_links: links,
    max_replies: Number.isInteger(maxReplies) && maxReplies >= 3 && maxReplies <= 60 ? maxReplies : d.max_replies,
    skip_known_contacts: r.skip_known_contacts !== false,
    handoff_department: str(r.handoff_department, 60).trim() || d.handoff_department,
    channel: r.channel === 'meta' ? 'meta' : 'evolution',
    meta: {
      phone_number_id: str(meta.phone_number_id, 40).replace(/\D/g, ''),
      api_version: /^v\d+(\.\d+)?$/.test(str(meta.api_version, 10)) ? str(meta.api_version, 10) : '',
      last4: typeof meta.last4 === 'string' ? meta.last4.slice(-4) : null,
    },
  }
}

// Link de agenda para um vendedor (o dele, senão o padrão)
export function bookingLinkFor(s: SdrSettings, userId: string | null): string | null {
  if (userId && s.booking_links[userId]) return s.booking_links[userId]
  return s.booking_url || null
}

export const SDR_STATUS_LABEL: Record<string, string> = {
  active: 'Em conversa com a IA',
  handed_off: 'Passado ao comercial',
  routed: 'Encaminhado ao time',
  human: 'Assumido por pessoa',
  disqualified: 'Descartado',
  error: 'Erro (passou ao time)',
}
