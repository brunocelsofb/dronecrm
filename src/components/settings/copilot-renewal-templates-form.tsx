'use client'

import { useState } from 'react'
import { saveRenewalTemplates } from '@/lib/actions/copilot-settings'
import {
  RENEWAL_LEVELS,
  RENEWAL_VARIABLES,
  DEFAULT_RENEWAL_TEMPLATES,
  DEFAULT_RENEWAL_EMAIL_SUBJECT,
  DEFAULT_RENEWAL_CONFIRMATION_SUBJECT,
  RENEWAL_SEVERITY,
  renderRenewalTemplate,
  type RenewalLevelKey,
} from '@/lib/agent/renewal-templates'

const SAMPLE_VARS = {
  contato: 'Maria',
  cliente: 'Hospital Exemplo',
  contrato: 'CT-2026-0001',
  vencimento: '30/11/2026',
  inicio: '01/12/2026',
  dias: '30',
  consultor: 'Pedro Arruda - Consultor Comercial',
}

export function CopilotRenewalTemplatesForm({
  initial,
  initialSubject,
  initialConfirmationSubject,
  initialCommercialEmail,
  initialExtraCc,
  companyName,
}: {
  initial: Record<RenewalLevelKey, string>
  initialSubject: string
  initialConfirmationSubject: string
  initialCommercialEmail: string
  initialExtraCc: string
  companyName: string
}) {
  const [templates, setTemplates] = useState(initial)
  const [subject, setSubject] = useState(initialSubject)
  const [confirmationSubject, setConfirmationSubject] = useState(initialConfirmationSubject)
  const [commercialEmail, setCommercialEmail] = useState(initialCommercialEmail)
  const [extraCc, setExtraCc] = useState(initialExtraCc)
  const [active, setActive] = useState<RenewalLevelKey>('60')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = templates[active]
  // Na renovação concluída, {{vencimento}} é o fim do novo período
  const sampleVars = active === 'renovado' ? { ...SAMPLE_VARS, vencimento: '30/11/2027' } : SAMPLE_VARS
  const preview = renderRenewalTemplate(current, { ...sampleVars, empresa: companyName || 'Sua empresa' })
  const isDefault = current.trim() === DEFAULT_RENEWAL_TEMPLATES[active].trim()

  function update(value: string) {
    setTemplates(prev => ({ ...prev, [active]: value }))
    setSaved(false)
  }

  function insertVariable(key: string) {
    update(`${current}{{${key}}}`)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await saveRenewalTemplates(templates, subject, commercialEmail, confirmationSubject, extraCc)
    setSaving(false)
    if (res.error) setError(res.error)
    else setSaved(true)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-[#1B556B]">Avisos de renovação ao cliente</h2>
        <p className="mt-1 text-xs text-gray-500">
          O Copiloto prepara estas mensagens nos marcos de vencimento e abre uma atividade para o responsável
          do contrato. O aviso vai por WhatsApp e e-mail juntos (mesmo texto), saindo do WhatsApp e do e-mail
          do consultor dono do WhatsApp, com o e-mail comercial em cópia. A assinatura do e-mail usa a razão social da conta. Nada é enviado sem o consultor revisar e clicar em enviar.
        </p>
      </div>

      <div>
        <label htmlFor="renewal-subject" className="block text-xs font-semibold text-gray-700 mb-1">Assunto do e-mail dos avisos (60, 30, 15 dias e vencido)</label>
        <input
          id="renewal-subject"
          value={subject}
          onChange={e => { setSubject(e.target.value); setSaved(false) }}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-gray-400">
          Prévia: {renderRenewalTemplate(subject || DEFAULT_RENEWAL_EMAIL_SUBJECT, { ...SAMPLE_VARS, empresa: companyName || 'Sua empresa' })}
        </p>
      </div>

      <div>
        <label htmlFor="confirmation-subject" className="block text-xs font-semibold text-gray-700 mb-1">Assunto do e-mail da renovação concluída</label>
        <input
          id="confirmation-subject"
          value={confirmationSubject}
          onChange={e => { setConfirmationSubject(e.target.value); setSaved(false) }}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-gray-400">
          Prévia: {renderRenewalTemplate(confirmationSubject || DEFAULT_RENEWAL_CONFIRMATION_SUBJECT, { ...SAMPLE_VARS, empresa: companyName || 'Sua empresa' })}
        </p>
      </div>

      <div>
        <label htmlFor="commercial-email" className="block text-xs font-semibold text-gray-700 mb-1">E-mail comercial (vai em cópia em todo envio e aparece no contato do e-mail)</label>
        <input
          id="commercial-email"
          type="email"
          value={commercialEmail}
          onChange={e => { setCommercialEmail(e.target.value); setSaved(false) }}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="extra-cc" className="block text-xs font-semibold text-gray-700 mb-1">Cópia extra (opcional — outros e-mails internos)</label>
        <input
          id="extra-cc"
          value={extraCc}
          onChange={e => { setExtraCc(e.target.value); setSaved(false) }}
          placeholder="contratos@suaempresa.com.br, ..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-gray-400">
          Separe por vírgula. Vai em cópia junto com o comercial; o consultor pode tirar ou incluir outros na hora do envio.
        </p>
      </div>

      {/* Abas dos marcos */}
      <div className="flex flex-wrap gap-2" role="tablist">
        {RENEWAL_LEVELS.map(l => (
          <button
            key={l.key}
            role="tab"
            aria-selected={active === l.key}
            onClick={() => setActive(l.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              active === l.key ? 'bg-[#1B556B] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span
              aria-hidden="true"
              className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle ring-1 ring-black/10"
              style={{ background: RENEWAL_SEVERITY[l.key].bg }}
            />
            {l.label}
            <span className="ml-1.5 text-[10px] opacity-70">{RENEWAL_SEVERITY[l.key].label}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500">{RENEWAL_LEVELS.find(l => l.key === active)?.hint}</p>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="renewal-template" className="block text-xs font-semibold text-gray-700 mb-1">Texto</label>
          <textarea
            id="renewal-template"
            value={current}
            onChange={e => update(e.target.value)}
            rows={12}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono leading-relaxed focus:border-[#1B556B] focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {RENEWAL_VARIABLES.map(v => (
              <button
                key={v.key}
                type="button"
                title={v.description}
                onClick={() => insertVariable(v.key)}
                className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-[11px] text-gray-600 hover:bg-gray-100"
              >
                {`{{${v.key}}}`}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            Use *texto* para negrito no WhatsApp. {'{{consultor}}'} vira o nome do WhatsApp que enviar.
          </p>
        </div>

        <div>
          <p className="block text-xs font-semibold text-gray-700 mb-1">Prévia (dados de exemplo)</p>
          <div className="whitespace-pre-wrap rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm leading-relaxed text-gray-800 min-h-[16rem]">
            {preview}
          </div>
        </div>
      </div>

      <div className="space-y-1 rounded-lg border border-gray-100 bg-gray-50 p-3">
        <p className="text-[11px] font-semibold text-gray-600">Variáveis</p>
        {RENEWAL_VARIABLES.map(v => (
          <p key={v.key} className="text-[11px] text-gray-500">
            <code className="text-gray-700">{`{{${v.key}}}`}</code> — {v.description}
          </p>
        ))}
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-[#1B556B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#164659] disabled:opacity-50"
        >
          {saving ? 'Salvando...' : 'Salvar mensagens'}
        </button>
        {!isDefault && (
          <button
            type="button"
            onClick={() => update(DEFAULT_RENEWAL_TEMPLATES[active])}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Restaurar texto padrão deste marco
          </button>
        )}
        {saved && <span className="text-sm text-green-700">✓ Salvo. Vale para os próximos avisos.</span>}
      </div>
    </div>
  )
}
