'use client'

// Configurações → Copiloto IA: ativação (chave da Anthropic da empresa) e o
// canal do gestor (quem recebe briefing e avisos internos).

import { useState, useTransition } from 'react'
import { saveAnthropicKey, removeAnthropicKey, saveManagerSettings } from '@/lib/actions/copilot-settings'

export function CopilotActivationCard({
  keyStatus,
  manager,
  instances,
}: {
  keyStatus: { source: 'tenant' | 'platform' | null; last4: string | null }
  manager: { whatsapp: string; instance: string; email: string; briefingEnabled: boolean; businessContext: string }
  instances: { name: string; label: string }[]
}) {
  const [key, setKey] = useState('')
  const [keyMsg, setKeyMsg] = useState<string | null>(null)
  const [keyPending, startKey] = useTransition()

  const [whatsapp, setWhatsapp] = useState(manager.whatsapp)
  const [instance, setInstance] = useState(manager.instance)
  const [email, setEmail] = useState(manager.email)
  const [briefing, setBriefing] = useState(manager.briefingEnabled)
  const [context, setContext] = useState(manager.businessContext)
  const [mgrMsg, setMgrMsg] = useState<string | null>(null)
  const [mgrPending, startMgr] = useTransition()

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none'
  const labelCls = 'block text-xs font-semibold text-gray-700 mb-1'

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-[#1B556B]">Ativação do Copiloto IA</h2>
        <p className="mt-1 text-xs text-gray-500">
          O Copiloto usa a inteligência artificial da Anthropic (Claude) com a <strong>chave da sua empresa</strong>: o consumo é
          cobrado direto na sua conta da Anthropic. Crie a chave em console.anthropic.com → API Keys. Sem chave, o Copiloto fica
          desligado e o resto do CRM funciona normalmente.
        </p>
      </div>

      <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
        {keyStatus.source === 'tenant' && <span className="text-green-700">✓ Chave da empresa cadastrada (…{keyStatus.last4})</span>}
        {keyStatus.source === 'platform' && <span className="text-amber-700">⚠ Usando a chave da plataforma (temporário). Cadastre a chave da sua empresa.</span>}
        {!keyStatus.source && <span className="text-gray-600">Copiloto desligado — nenhuma chave cadastrada.</span>}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <label htmlFor="ai-key" className={labelCls}>{keyStatus.source === 'tenant' ? 'Trocar chave' : 'Chave da Anthropic'}</label>
          <input
            id="ai-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={e => { setKey(e.target.value); setKeyMsg(null) }}
            placeholder="sk-ant-..."
            className={inputCls}
          />
        </div>
        <button
          disabled={keyPending || !key.trim()}
          onClick={() => startKey(async () => {
            const r = await saveAnthropicKey(key)
            setKeyMsg(r.error ?? '✓ Chave salva. O Copiloto está ativo.')
            if (!r.error) setKey('')
          })}
          className="rounded-lg bg-[#1B556B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#164659] disabled:opacity-50"
        >
          {keyPending ? 'Verificando…' : 'Salvar chave'}
        </button>
        {keyStatus.source === 'tenant' && (
          <button
            disabled={keyPending}
            onClick={() => {
              if (!confirm('Remover a chave? O Copiloto será desligado.')) return
              startKey(async () => { const r = await removeAnthropicKey(); setKeyMsg(r.error ?? 'Chave removida.') })
            }}
            className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Remover
          </button>
        )}
      </div>
      {keyMsg && <p role="status" className="text-sm text-gray-700">{keyMsg}</p>}

      <div className="border-t border-gray-100 pt-5">
        <h3 className="text-sm font-semibold text-[#1B556B]">Gestor</h3>
        <p className="mt-1 text-xs text-gray-500">
          Quem recebe o briefing diário (seg. a sex., 07h), o resumo dos avisos de renovação e o aviso de cada envio feito ao cliente.
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="mgr-wa" className={labelCls}>WhatsApp do gestor</label>
            <input id="mgr-wa" value={whatsapp} onChange={e => { setWhatsapp(e.target.value); setMgrMsg(null) }} placeholder="5562999990000" className={inputCls} />
          </div>
          <div>
            <label htmlFor="mgr-inst" className={labelCls}>Enviar pelo WhatsApp da empresa</label>
            <select id="mgr-inst" value={instance} onChange={e => { setInstance(e.target.value); setMgrMsg(null) }} className={inputCls}>
              <option value="">Principal</option>
              {instances.map(i => <option key={i.name} value={i.name}>{i.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="mgr-email" className={labelCls}>E-mail do gestor</label>
            <input id="mgr-email" type="email" value={email} onChange={e => { setEmail(e.target.value); setMgrMsg(null) }} className={inputCls} />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
            <input type="checkbox" checked={briefing} onChange={e => { setBriefing(e.target.checked); setMgrMsg(null) }} className="h-4 w-4 accent-[#1B556B]" />
            Enviar o briefing diário
          </label>
        </div>
        <div className="mt-4">
          <label htmlFor="biz-ctx" className={labelCls}>Sobre a empresa (contexto para a IA)</label>
          <input
            id="biz-ctx"
            value={context}
            onChange={e => { setContext(e.target.value); setMgrMsg(null) }}
            placeholder="ex.: empresa de engenharia clínica que atende hospitais e clínicas"
            className={inputCls}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            disabled={mgrPending}
            onClick={() => startMgr(async () => {
              const r = await saveManagerSettings({ managerWhatsapp: whatsapp, managerInstance: instance, managerEmail: email, briefingEnabled: briefing, businessContext: context })
              setMgrMsg(r.error ?? '✓ Salvo.')
            })}
            className="rounded-lg bg-[#1B556B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#164659] disabled:opacity-50"
          >
            {mgrPending ? 'Salvando…' : 'Salvar gestor'}
          </button>
          {mgrMsg && <span role="status" className="text-sm text-gray-700">{mgrMsg}</span>}
        </div>
      </div>
    </div>
  )
}
