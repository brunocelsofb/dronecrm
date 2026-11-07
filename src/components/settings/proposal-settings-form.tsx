'use client'
// Configurações → Propostas: regras do fluxo da proposta desta empresa.
import { useState, useTransition } from 'react'
import { saveProposalSettings } from '@/lib/actions/proposal-price-sections'

export function ProposalSettingsForm({ initial, canEdit }: { initial: { techApproval: boolean }; canEdit: boolean }) {
  const [tech, setTech] = useState(initial.techApproval)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  function toggle(v: boolean) {
    setTech(v); setMsg(null)
    start(async () => {
      const r = await saveProposalSettings({ techApproval: v })
      if (r.ok) setMsg('Salvo.'); else { setTech(!v); setMsg(r.error) }
    })
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium text-gray-900">Fluxo de aprovação</h3>
        <p className="mt-0.5 text-xs text-gray-500">Toda proposta passa pela aprovação comercial e pelo cliente. A análise técnica é opcional.</p>
      </div>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={tech} disabled={!canEdit || pending} onChange={e => toggle(e.target.checked)} />
        <span>
          <span className="block text-sm font-medium text-gray-800">Tem aprovação técnica</span>
          <span className="block text-xs text-gray-500">
            {tech
              ? 'Rascunho → Análise técnica → Aprovação comercial → Cliente. O aprovador técnico vê só o dimensionamento, sem valores.'
              : 'Rascunho → Aprovação comercial → Cliente. A proposta vai direto para a aprovação comercial.'}
          </span>
        </span>
      </label>
      {!canEdit && <p className="text-xs text-gray-400">Só o Admin altera.</p>}
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </div>
  )
}
