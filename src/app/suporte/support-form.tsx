'use client'

import { useState } from 'react'
import { createTicket } from '@/lib/actions/tickets'
import { PRIORITY_LABELS, GRAVITY_CATEGORIES } from '@/lib/utils/gut-matrix'

const inp = 'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-[#1B556B] focus:ring-2 focus:ring-[#1B556B]/20 focus:outline-none transition-colors'
const lbl = 'block text-sm font-semibold text-[#1B556B]'

export function SupportForm({ empresa }: { empresa?: string } = {}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ticketId: string; publicToken: string } | null>(null)

  async function handleSubmit(formData: FormData) {
    setBusy(true)
    setError(null)
    formData.set('source', 'formulario')
    const res = await createTicket(formData)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    if (res.ticketId && res.publicToken) setResult({ ticketId: res.ticketId, publicToken: res.publicToken })
  }

  if (result) {
    return (
      <div className="text-center space-y-3">
        <div className="text-4xl">✅</div>
        <p className="text-lg font-semibold text-gray-900">Chamado aberto!</p>
        <p className="text-sm text-gray-500">Nossa equipe já foi avisada. Guarde o link para acompanhar:</p>
        <a
          href={`/acompanhar-ticket/${result.publicToken}`}
          className="block rounded-lg bg-[#1B556B]/10 px-3 py-2.5 text-xs text-[#1B556B] hover:bg-[#1B556B]/20 transition-colors break-all font-mono"
        >
          /acompanhar-ticket/{result.publicToken}
        </a>
      </div>
    )
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {empresa && <input type="hidden" name="empresa" value={empresa} />}
      <div>
        <label className={lbl}>Nome e sobrenome *</label>
        <input name="requester_name" required pattern=".*\S+\s+\S+.*" title="Informe nome e sobrenome" className={inp} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>E-mail *</label>
          <input name="requester_email" type="email" required className={inp} />
        </div>
        <div>
          <label className={lbl}>Telefone *</label>
          <input name="requester_phone" required className={inp} />
        </div>
      </div>
      <div>
        <label className={lbl}>CNPJ do contrato *</label>
        <input name="requester_cnpj" required placeholder="00.000.000/0000-00" className={inp} />
        <p className="mt-1 text-xs text-gray-400">Usamos para direcionar seu chamado automaticamente.</p>
      </div>
      <div>
        <label className={lbl}>Sobre o que é? *</label>
        <select name="category" required defaultValue="" className={inp}>
          <option value="" disabled>Selecione...</option>
          {GRAVITY_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={lbl}>Assunto *</label>
        <input name="subject" required className={inp} />
      </div>
      <div>
        <label className={lbl}>Descrição do problema *</label>
        <textarea name="description" required rows={4} className={inp + ' resize-none'} />
      </div>
      <div>
        <label className={lbl}>Urgência *</label>
        <select name="priority" required defaultValue="pouco_critica" className={inp}>
          <option value="nao_critica">{PRIORITY_LABELS.nao_critica}</option>
          <option value="pouco_critica">{PRIORITY_LABELS.pouco_critica} — pode esperar</option>
          <option value="critica">{PRIORITY_LABELS.critica} — está atrapalhando</option>
          <option value="muito_critica">{PRIORITY_LABELS.muito_critica} — parou tudo</option>
        </select>
      </div>
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <button type="submit" disabled={busy}
        className="w-full rounded-lg bg-[#1B556B] py-2.5 text-sm font-semibold text-white hover:bg-[#164659] disabled:opacity-50 transition-colors">
        {busy ? 'Enviando...' : 'Abrir chamado →'}
      </button>
    </form>
  )
}
