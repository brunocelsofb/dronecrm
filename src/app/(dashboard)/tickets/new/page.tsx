'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createTicket, getMyTicketSlaDays } from '@/lib/actions/tickets'
import { ContractSearchSelect } from '@/components/tickets/contract-search-select'
import { PRIORITY_LABELS, PRIORITY_SLA_DAYS, GRAVITY_CATEGORIES } from '@/lib/utils/gut-matrix'

export default function NewTicketPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefilledContractId = searchParams.get('contract_id')
  const prefilledClientName = searchParams.get('client_name')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Prazos da empresa por prioridade (Central de regras → Atendimento)
  const [sla, setSla] = useState<Record<string, number>>(PRIORITY_SLA_DAYS)
  useEffect(() => { getMyTicketSlaDays().then(setSla).catch(() => {}) }, [])

  async function handleSubmit(formData: FormData) {
    setBusy(true)
    setError(null)
    formData.set('source', 'manual')
    const result = await createTicket(formData)
    setBusy(false)
    if (result.error) {
      setError(result.error)
    } else if (result.ticketId) {
      router.push(`/tickets/${result.ticketId}`)
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <Link href="/tickets" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-700">
        ← Voltar
      </Link>
      <h1 className="text-[17px] font-medium text-foreground">Novo Ticket</h1>
      <form action={handleSubmit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <ContractSearchSelect
          name="contract_id"
          required
          initialValue={prefilledContractId && prefilledClientName ? { id: prefilledContractId, client_name: prefilledClientName, process_number: '' } : undefined}
        />
        <div>
          <label className="block text-xs font-medium text-gray-600">Nome e sobrenome do solicitante *</label>
          <input name="requester_name" required pattern=".*\S+\s+\S+.*" title="Informe nome e sobrenome" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">E-mail *</label>
          <input name="requester_email" type="email" required className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Telefone *</label>
          <input name="requester_phone" required className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">CNPJ vinculado ao contrato *</label>
          <input name="requester_cnpj" required placeholder="00.000.000/0000-00" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Sobre o que é o chamado? *</label>
          <select name="category" required defaultValue="" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
            <option value="" disabled>Selecione...</option>
            {GRAVITY_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Assunto *</label>
          <input name="subject" required className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Descreva o problema *</label>
          <textarea name="description" required rows={3} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Prioridade *</label>
          <select name="priority" required defaultValue="pouco_critica" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
            <option value="nao_critica">{PRIORITY_LABELS.nao_critica} ({sla.nao_critica} {sla.nao_critica === 1 ? 'dia' : 'dias'})</option>
            <option value="pouco_critica">{PRIORITY_LABELS.pouco_critica} ({sla.pouco_critica} {sla.pouco_critica === 1 ? 'dia' : 'dias'})</option>
            <option value="critica">{PRIORITY_LABELS.critica} ({sla.critica} {sla.critica === 1 ? 'dia' : 'dias'})</option>
            <option value="muito_critica">{PRIORITY_LABELS.muito_critica} ({sla.muito_critica} {sla.muito_critica === 1 ? 'dia' : 'dias'})</option>
          </select>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {busy ? 'Criando...' : 'Criar ticket'}
        </button>
      </form>
    </div>
  )
}
