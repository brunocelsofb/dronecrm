'use client'

import { useState } from 'react'
import Link from 'next/link'
import { saveInternalSettings } from '@/lib/actions/copilot-settings'
import { renderRenewalTemplate } from '@/lib/agent/renewal-templates'
import {
  INTERNAL_LEVELS,
  INTERNAL_VARIABLES,
  DEFAULT_INTERNAL_TEMPLATES,
  DEFAULT_INTERNAL_SUBJECTS,
  type InternalKey,
  type InternalSettings,
} from '@/lib/agent/internal-settings'

const SAMPLE = {
  cliente: 'Hospital Exemplo',
  contrato: 'CT-2026-0001',
  inicio: '01/12/2026',
  vencimento: '30/11/2027',
  consultor: 'Pedro Arruda - Consultor Comercial',
}

export function CopilotInternalForm({
  initial,
  companyName,
  users,
}: {
  initial: InternalSettings
  companyName: string
  users: { id: string; name: string }[]
}) {
  const [to, setTo] = useState(initial.to.join(', '))
  const [cc, setCc] = useState(initial.cc.join(', '))
  const [templates, setTemplates] = useState(initial.templates)
  const [subjects, setSubjects] = useState(initial.subjects)
  const [tech, setTech] = useState(initial.techTeamEmails.join(', '))
  const [weeks, setWeeks] = useState(String(initial.implWeeks))
  const [day, setDay] = useState(String(initial.implReportDay))
  const [owner, setOwner] = useState(initial.implReportOwnerId ?? '')
  const [active, setActive] = useState<InternalKey>('ganho')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const vars = { ...SAMPLE, empresa: companyName || 'Sua empresa' }
  const dirty = () => setSaved(false)

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await saveInternalSettings({
      to, cc, templates, subjects, techTeamEmails: tech,
      implWeeks: Number(weeks), implReportDay: Number(day), implReportOwnerId: owner || null,
    })
    setSaving(false)
    if (res.error) setError(res.error)
    else setSaved(true)
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none'
  const labelCls = 'block text-xs font-semibold text-gray-700 mb-1'

  return (
    <div className="space-y-6">
      {/* E-mails internos */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-[#1B556B]">E-mails internos — fechamento e renovação</h2>
          <p className="mt-1 text-xs text-gray-500">
            Quando o consultor marca <strong>Ganho</strong> (vendas) ou <strong>Renovado</strong> (gestão de contratos), o Copiloto
            abre uma atividade de e-mail com o texto pronto. O consultor revisa destinatários e cópia e envia do próprio e-mail.
            Esses e-mails <strong>não levam valores</strong> — só cliente, número e período.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="int-to" className={labelCls}>Para (padrão)</label>
            <input id="int-to" value={to} onChange={e => { setTo(e.target.value); dirty() }} className={inputCls} placeholder="contratos@suaempresa.com.br, ..." />
          </div>
          <div>
            <label htmlFor="int-cc" className={labelCls}>Cópia (padrão)</label>
            <input id="int-cc" value={cc} onChange={e => { setCc(e.target.value); dirty() }} className={inputCls} />
          </div>
        </div>
        <p className="-mt-3 text-[11px] text-gray-400">Separe por vírgula. O consultor pode alterar na hora do envio.</p>

        <div className="flex flex-wrap gap-2" role="tablist">
          {INTERNAL_LEVELS.map(l => (
            <button
              key={l.key}
              role="tab"
              aria-selected={active === l.key}
              onClick={() => setActive(l.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                active === l.key ? 'bg-[#1B556B] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">{INTERNAL_LEVELS.find(l => l.key === active)?.hint}</p>

        <div>
          <label htmlFor="int-subject" className={labelCls}>Assunto</label>
          <input
            id="int-subject"
            value={subjects[active]}
            onChange={e => { setSubjects(p => ({ ...p, [active]: e.target.value })); dirty() }}
            className={inputCls}
          />
          <p className="mt-1 text-[11px] text-gray-400">Prévia: {renderRenewalTemplate(subjects[active], vars)}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="int-text" className={labelCls}>Texto</label>
            <textarea
              id="int-text"
              value={templates[active]}
              onChange={e => { setTemplates(p => ({ ...p, [active]: e.target.value })); dirty() }}
              rows={14}
              className={`${inputCls} font-mono leading-relaxed`}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {INTERNAL_VARIABLES.map(v => (
                <button
                  key={v.key}
                  type="button"
                  title={v.description}
                  onClick={() => { setTemplates(p => ({ ...p, [active]: `${p[active]}{{${v.key}}}` })); dirty() }}
                  className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-[11px] text-gray-600 hover:bg-gray-100"
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
            {(templates[active].trim() !== DEFAULT_INTERNAL_TEMPLATES[active].trim() || subjects[active].trim() !== DEFAULT_INTERNAL_SUBJECTS[active].trim()) && (
              <button
                type="button"
                onClick={() => {
                  setTemplates(p => ({ ...p, [active]: DEFAULT_INTERNAL_TEMPLATES[active] }))
                  setSubjects(p => ({ ...p, [active]: DEFAULT_INTERNAL_SUBJECTS[active] }))
                  dirty()
                }}
                className="mt-2 text-xs text-[#1B556B] underline"
              >
                Restaurar texto padrão
              </button>
            )}
          </div>
          <div>
            <p className={labelCls}>Prévia (dados de exemplo)</p>
            <div className="min-h-[16rem] whitespace-pre-wrap rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm leading-relaxed text-gray-800">
              {renderRenewalTemplate(templates[active], vars)}
            </div>
          </div>
        </div>
      </div>

      {/* Implantação */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-[#1B556B]">Implantação</h2>
          <p className="mt-1 text-xs text-gray-500">
            No <strong>Ganho</strong>, o Copiloto abre para o consultor a tarefa de acionar o time técnico (iniciar a implantação no
            CRM, enviar as informações de acompanhamento e montar a tabela de aplicabilidade). Quando o cronograma é iniciado, abre
            o <strong>acompanhamento da evolução</strong> (30 dias) e o <strong>pedido do relatório final</strong> no fim do prazo abaixo.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="impl-weeks" className={labelCls}>Prazo médio da implantação (semanas)</label>
            <input id="impl-weeks" type="number" min={1} max={104} value={weeks} onChange={e => { setWeeks(e.target.value); dirty() }} className={inputCls} />
          </div>
          <div>
            <label htmlFor="impl-day" className={labelCls}>Dia do relatório mensal</label>
            <input id="impl-day" type="number" min={1} max={28} value={day} onChange={e => { setDay(e.target.value); dirty() }} className={inputCls} />
          </div>
          <div>
            <label htmlFor="impl-owner" className={labelCls}>Quem revisa o relatório mensal</label>
            <select id="impl-owner" value={owner} onChange={e => { setOwner(e.target.value); dirty() }} className={inputCls}>
              <option value="">Primeiro administrador</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="tech-emails" className={labelCls}>E-mails do time técnico (destinatários do relatório mensal)</label>
          <input id="tech-emails" value={tech} onChange={e => { setTech(e.target.value); dirty() }} className={inputCls} placeholder="tecnico@suaempresa.com.br, ..." />
          <p className="mt-1 text-[11px] text-gray-400">
            Todo mês, a partir do dia escolhido, o Copiloto monta o consolidado das fases de cada implantação e abre uma atividade
            para revisar e enviar (cópia: a mesma cópia padrão dos e-mails internos). Veja em{' '}
            <Link href="/copiloto/relatorios" className="text-[#1B556B] underline">Relatórios de implantação</Link>.
          </p>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-[#1B556B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#164659] disabled:opacity-50"
        >
          {saving ? 'Salvando...' : 'Salvar configurações internas'}
        </button>
        {saved && <span className="text-sm text-green-700">✓ Salvo.</span>}
      </div>
    </div>
  )
}
