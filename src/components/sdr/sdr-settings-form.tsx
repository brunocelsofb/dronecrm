'use client'

import Link from 'next/link'
import { useState, useTransition, type ReactNode } from 'react'
import { Bot, Send, RotateCcw } from 'lucide-react'
import { SDR_MODELS, type SdrSettings } from '@/lib/sdr/settings'
import { saveSdrSettings, simulateSdr, type SimEvent } from '@/lib/actions/sdr'
import type { ChatTurn } from '@/lib/sdr/prompt'

type Props = {
  initial: SdrSettings
  instances: { name: string; label: string }[]
  departments: { department: string; label: string }[]
  triageOn: boolean
  people: { id: string; name: string }[]
  aiReady: boolean
  companyName: string
}

const input = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm'
const area = `${input} min-h-[96px]`

function Box({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {text && <p className="mt-0.5 text-xs text-gray-500">{text}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      {hint && <span className="block text-[11px] text-gray-500">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  )
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])

export function SdrSettingsForm({ initial, instances, departments, triageOn, people, aiReady, companyName }: Props) {
  const [s, setS] = useState<SdrSettings>(initial)
  const [questions, setQuestions] = useState(initial.questions.join('\n'))
  const [metaToken, setMetaToken] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const set = <K extends keyof SdrSettings>(k: K, v: SdrSettings[K]) => setS(prev => ({ ...prev, [k]: v }))
  const current = (): SdrSettings => ({ ...s, questions: questions.split('\n').map(q => q.trim()).filter(Boolean) })

  function save() {
    setMsg(null)
    start(async () => {
      const r = await saveSdrSettings({ ...current(), meta_token: metaToken || undefined })
      if (r.ok) { setMetaToken(''); setMsg({ ok: true, text: 'Configuração salva.' }) }
      else setMsg({ ok: false, text: r.error })
    })
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <Box title="Ligar o SDR de IA" text="A IA só entra em conversas novas, nos números ou setores escolhidos abaixo. Quando uma pessoa do time escreve na conversa, a IA sai na hora.">
          {!aiReady && (
            <p className="rounded-md bg-warn-100 px-3 py-2 text-xs text-warn-700">
              Falta a chave da IA da empresa. Cadastre em <Link href="/settings/copiloto" className="font-medium underline">Configurações → Agentes IA</Link>. Sem ela, a IA não atende.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={s.enabled} onChange={e => set('enabled', e.target.checked)} />
            SDR de IA ligado
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome da assistente" hint="Ela se apresenta como assistente virtual da empresa.">
              <input className={input} value={s.agent_name} maxLength={40} onChange={e => set('agent_name', e.target.value)} />
            </Field>
            <Field label="Modelo de IA" hint="O consumo é cobrado na chave da empresa.">
              <select className={input} value={s.model} onChange={e => set('model', e.target.value as SdrSettings['model'])}>
                {SDR_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>
          </div>
        </Box>

        <Box title="Onde a IA atende" text="Escolha os números do WhatsApp em que a IA responde a primeira mensagem, e/ou os setores do menu de triagem que passam para ela.">
          <div>
            <p className="text-xs font-medium text-gray-700">Números</p>
            {instances.length === 0 && <p className="mt-1 text-xs text-gray-500">Nenhum número conectado. Conecte em Configurações → WhatsApp → Conexões.</p>}
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {instances.map(i => (
                <label key={i.name} className="flex items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" checked={s.instances.includes(i.name)} onChange={() => set('instances', toggle(s.instances, i.name))} />
                  {i.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-700">Setores da triagem</p>
            {!triageOn && <p className="mt-1 text-xs text-gray-500">A triagem (menu de setores) está desligada ou sem opções. Use os números acima, ou ligue a triagem em Configurações → WhatsApp.</p>}
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {departments.map(d => (
                <label key={d.department} className="flex items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" checked={s.departments.includes(d.department)} onChange={() => set('departments', toggle(s.departments, d.department))} />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={s.skip_known_contacts} onChange={e => set('skip_known_contacts', e.target.checked)} />
            Não atender quem já é contato cadastrado (clientes)
          </label>
          <Field label="Máximo de respostas da IA por conversa" hint="Ao chegar no limite, passa para o comercial com o que tiver.">
            <input type="number" min={3} max={60} className={`${input} max-w-[120px]`} value={s.max_replies} onChange={e => set('max_replies', Number(e.target.value))} />
          </Field>
        </Box>

        <Box title="O que a IA sabe" text="É a base para a IA responder. Ela não inventa: o que não estiver aqui, ela diz que um especialista vai confirmar.">
          <Field label="Sobre a empresa, serviços e diferenciais (obrigatório)">
            <textarea className={area} value={s.about} maxLength={6000} onChange={e => set('about', e.target.value)}
              placeholder={`O que a ${companyName || 'empresa'} faz, para quem, regiões atendidas, diferenciais...`} />
          </Field>
          <Field label="Perguntas frequentes" hint="Uma pergunta e a resposta por linha ou parágrafo.">
            <textarea className={area} value={s.faq} maxLength={6000} onChange={e => set('faq', e.target.value)} />
          </Field>
          <Field label="Tom de voz">
            <input className={input} value={s.tone} maxLength={500} onChange={e => set('tone', e.target.value)} />
          </Field>
        </Box>

        <Box title="Qualificação" text="O que a IA precisa descobrir antes de passar para o comercial.">
          <Field label="Perguntas de qualificação" hint="Uma por linha. A IA adapta à conversa, uma de cada vez.">
            <textarea className={area} value={questions} onChange={e => setQuestions(e.target.value)} />
          </Field>
          <Field label="Perfil de cliente ideal" hint="Ex.: porte, segmento, região, volume.">
            <textarea className={area} value={s.icp} maxLength={2000} onChange={e => set('icp', e.target.value)} />
          </Field>
          <Field label="Quando não é cliente" hint="Ex.: pessoa física, fora da região, só quer emprego. A IA descarta ou encaminha ao time.">
            <textarea className={area} value={s.disqualify} maxLength={2000} onChange={e => set('disqualify', e.target.value)} />
          </Field>
        </Box>

        <Box title="Para quem a IA passa" text="Os leads passados entram em Leads (inbound, já passado ao comercial), com o resumo no histórico. Com mais de um vendedor, é rodízio.">
          <div className="space-y-2">
            {people.map(p => (
              <div key={p.id} className="grid items-center gap-2 sm:grid-cols-[200px_1fr]">
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" checked={s.sellers.includes(p.id)} onChange={() => set('sellers', toggle(s.sellers, p.id))} />
                  {p.name}
                </label>
                {s.sellers.includes(p.id) && (
                  <input className={input} placeholder="Link de agenda dele (opcional)" value={s.booking_links[p.id] ?? ''}
                    onChange={e => set('booking_links', { ...s.booking_links, [p.id]: e.target.value })} />
                )}
              </div>
            ))}
          </div>
          <Field label="Link de agenda padrão" hint="Página de agendamento (ex.: Google Agenda ou Calendly). A IA envia depois de passar o lead.">
            <input className={input} placeholder="https://..." value={s.booking_url} onChange={e => set('booking_url', e.target.value)} />
          </Field>
          <Field label="Setor da conversa ao passar" hint="Como a conversa aparece no WhatsApp do CRM.">
            <input className={`${input} max-w-[240px]`} value={s.handoff_department} onChange={e => set('handoff_department', e.target.value)} />
          </Field>
        </Box>

        <Box title="Canal do WhatsApp" text="Hoje a IA usa a conexão atual (Evolution). A API oficial da Meta fica preparada para quando a empresa tiver a conta verificada.">
          <div className="flex flex-wrap gap-4 text-sm text-gray-800">
            <label className="flex items-center gap-2"><input type="radio" checked={s.channel === 'evolution'} onChange={() => set('channel', 'evolution')} /> Conexão atual (QR Code)</label>
            <label className="flex items-center gap-2"><input type="radio" checked={s.channel === 'meta'} onChange={() => set('channel', 'meta')} /> API oficial da Meta (preparação)</label>
          </div>
          {s.channel === 'evolution' && (
            <p className="text-xs text-gray-500">Atenção: conexões por QR Code não são a API oficial do WhatsApp e há risco de bloqueio do número com automações. A IA só responde quem escreveu primeiro.</p>
          )}
          {s.channel === 'meta' && (
            <div className="space-y-3">
              <p className="rounded-md bg-warn-100 px-3 py-2 text-xs text-warn-700">
                Preparação: com a Meta selecionada a IA ainda não atende, porque o recebimento de mensagens pela Meta não está ligado. Os dados ficam salvos para a ativação.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="ID do número (Phone number ID)">
                  <input className={input} value={s.meta.phone_number_id} onChange={e => set('meta', { ...s.meta, phone_number_id: e.target.value })} />
                </Field>
                <Field label="Versão da API" hint="Ex.: v21.0 — confira a vigente na Meta.">
                  <input className={input} value={s.meta.api_version} onChange={e => set('meta', { ...s.meta, api_version: e.target.value })} />
                </Field>
                <Field label="Token de acesso" hint={s.meta.last4 ? `Cadastrado, termina em ${s.meta.last4}` : 'Fica criptografado'}>
                  <input className={input} type="password" autoComplete="off" value={metaToken} onChange={e => setMetaToken(e.target.value)} placeholder={s.meta.last4 ? 'Só se for trocar' : ''} />
                </Field>
              </div>
            </div>
          )}
        </Box>

        <div className="sticky bottom-0 flex items-center gap-3 border-t border-gray-200 bg-background py-3">
          <button type="button" onClick={save} disabled={pending}
            className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
            {pending ? 'Salvando...' : 'Salvar'}
          </button>
          {msg && <span className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text}</span>}
        </div>
      </div>

      <SdrSimulator settings={current} aiReady={aiReady} />
    </div>
  )
}

function SdrSimulator({ settings, aiReady }: { settings: () => SdrSettings; aiReady: boolean }) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [events, setEvents] = useState<SimEvent[]>([])
  const [text, setText] = useState('')
  const [ended, setEnded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tokens, setTokens] = useState(0)
  const [pending, start] = useTransition()

  function send() {
    const t = text.trim()
    if (!t || pending) return
    const next: ChatTurn[] = [...turns, { role: 'user', content: t }]
    setTurns(next); setText(''); setError(null)
    start(async () => {
      const r = await simulateSdr(settings(), next)
      if (!r.ok) { setError(r.error); return }
      setTokens(x => x + r.tokens)
      if (r.reply) setTurns([...next, { role: 'assistant', content: r.reply }])
      if (r.events.length) setEvents(e => [...e, ...r.events])
      if (r.ended) setEnded(true)
    })
  }
  function reset() { setTurns([]); setEvents([]); setEnded(false); setError(null); setTokens(0) }

  return (
    <aside className="h-fit rounded-xl border border-gray-200 bg-white p-4 lg:sticky lg:top-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Bot size={16} /> Testar conversa</h2>
        <button type="button" onClick={reset} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"><RotateCcw size={12} /> Recomeçar</button>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">Converse como se fosse um cliente. Usa a configuração desta tela (mesmo sem salvar). Nada é enviado nem gravado; consome a chave de IA.</p>
      <div className="mt-3 h-80 space-y-2 overflow-y-auto rounded-lg bg-gray-50 p-2">
        {turns.length === 0 && <p className="p-2 text-xs text-gray-400">Ex.: &quot;Oi, queria um orçamento&quot;</p>}
        {turns.map((t, i) => (
          <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-sm ${t.role === 'user' ? 'ml-auto bg-brand-700 text-white' : 'bg-white text-gray-800 shadow-sm'}`}>
            {t.content}
          </div>
        ))}
        {pending && <p className="text-xs text-gray-400">digitando...</p>}
      </div>
      {events.length > 0 && (
        <ul className="mt-2 space-y-1">
          {events.map((e, i) => (
            <li key={i} className="rounded-md bg-brand-100 px-2 py-1 text-[11px] text-brand-800"><strong>{e.tool}:</strong> {e.detail}</li>
          ))}
        </ul>
      )}
      {ended && <p className="mt-2 text-xs text-gray-500">A IA encerrou a parte dela. No WhatsApp, a conversa iria para o time.</p>}
      {error && <p className="mt-2 text-xs text-negative-700">{error}</p>}
      <div className="mt-2 flex gap-2">
        <input className={input} value={text} disabled={!aiReady || pending} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }} placeholder={aiReady ? 'Escreva como cliente...' : 'Cadastre a chave da IA primeiro'} />
        <button type="button" onClick={send} disabled={!aiReady || pending || !text.trim()} aria-label="Enviar"
          className="rounded-md bg-brand-700 px-3 text-white hover:bg-brand-800 disabled:opacity-50"><Send size={14} /></button>
      </div>
      {tokens > 0 && <p className="mt-1 text-[11px] text-gray-400">Consumo deste teste: {tokens.toLocaleString('pt-BR')} tokens</p>}
    </aside>
  )
}
