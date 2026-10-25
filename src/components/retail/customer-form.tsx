'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveRetailCustomer, deleteRetailCustomer } from '@/lib/actions/retail-customers'

export type CustomerData = {
  id: string; name: string; phone: string | null; email: string | null; cpf: string | null; birth_date: string | null
  city: string | null; state: string | null; cep: string | null; address: string | null; notes: string | null; whatsapp_optin: boolean
}

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const lbl = 'mb-1 block text-sm font-medium text-gray-800'
const hint = 'mt-1 text-xs text-gray-500'

export function CustomerForm({ customer }: { customer: CustomerData | null }) {
  const router = useRouter()
  const [f, setF] = useState({
    name: customer?.name ?? '', phone: customer?.phone ?? '', email: customer?.email ?? '', cpf: customer?.cpf ?? '',
    birth_date: customer?.birth_date ?? '', city: customer?.city ?? '', state: customer?.state ?? '', cep: customer?.cep ?? '',
    address: customer?.address ?? '', notes: customer?.notes ?? '',
  })
  const [optin, setOptin] = useState(customer?.whatsapp_optin ?? false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.value }))

  async function save() {
    setBusy(true); setMsg(null)
    const r = await saveRetailCustomer({ id: customer?.id ?? null, ...f, whatsapp_optin: optin })
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    if (!customer) { router.replace(`/varejo/clientes/${r.id}`); return }
    setMsg({ ok: true, text: 'Alterações salvas.' }); router.refresh()
  }

  async function remove() {
    if (!customer || !confirm(`Excluir ${customer.name}? Os pedidos dela continuam, sem a cliente ligada.`)) return
    setBusy(true)
    const r = await deleteRetailCustomer(customer.id)
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    router.replace('/varejo/clientes')
  }

  return (
    <section id="cadastro" className="scroll-mt-20 space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-900">{customer ? 'Editar cadastro' : 'Cadastro'}</h2>
      {customer && <p className="-mt-2 text-xs text-gray-500">Altere o que precisar e toque em Salvar. WhatsApp e e-mail são usados nos avisos dos pedidos.</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><label className={lbl}>Nome *</label><input className={inp} value={f.name} onChange={set('name')} placeholder="ex.: Maria Souza" /></div>
        <div>
          <label className={lbl}>WhatsApp</label>
          <input className={inp} inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="(62) 99999-9999" />
          <p className={hint}>Com DDD. É por ele que o sistema reconhece a cliente nos próximos pedidos.</p>
        </div>
        <div>
          <label className={lbl}>Data de nascimento</label>
          <input className={inp} type="date" value={f.birth_date} onChange={set('birth_date')} />
          <p className={hint}>Para avisar do aniversário e você mandar parabéns.</p>
        </div>
        <div><label className={lbl}>E-mail</label><input className={inp} inputMode="email" value={f.email} onChange={set('email')} placeholder="opcional" /></div>
      </div>
      <div>
        <label className={lbl}>Observações</label>
        <textarea className={inp} rows={3} value={f.notes} onChange={set('notes')} placeholder="ex.: Veste M, prefere cores neutras, gosta de peças para o trabalho." />
        <p className={hint}>Ajuda a atender melhor e a separar novidades para ela.</p>
      </div>
      <details className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2" open={!!(customer?.address || customer?.cep || customer?.cpf)}>
        <summary className="cursor-pointer text-sm font-medium text-brand-700">Endereço de entrega e CPF (opcional)</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={lbl}>CEP</label><input className={inp} inputMode="numeric" value={f.cep} onChange={set('cep')} placeholder="74000-000" /></div>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <div><label className={lbl}>Cidade</label><input className={inp} value={f.city} onChange={set('city')} /></div>
            <div><label className={lbl}>UF</label><input className={inp} maxLength={2} value={f.state} onChange={set('state')} placeholder="GO" /></div>
          </div>
          <div className="sm:col-span-2"><label className={lbl}>Endereço</label><input className={inp} value={f.address} onChange={set('address')} placeholder="Rua, número, complemento, bairro" /></div>
          <div><label className={lbl}>CPF</label><input className={inp} inputMode="numeric" value={f.cpf} onChange={set('cpf')} placeholder="só se precisar para nota ou envio" /></div>
        </div>
      </details>
      <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={optin} onChange={e => setOptin(e.target.checked)} />
        <span>
          <strong className="block text-gray-900">Ela autorizou receber novidades e ofertas pelo WhatsApp</strong>
          Marque só se ela disse que sim (LGPD). Sem isso, ela não entra nas campanhas. Mensagens sobre um pedido dela podem ser enviadas de qualquer jeito.
        </span>
      </label>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>}
      <div className="flex items-center justify-between">
        {customer ? <button type="button" onClick={remove} disabled={busy} className="text-sm text-negative-700 hover:underline disabled:opacity-50">Excluir cliente</button> : <span />}
        <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Salvando…' : customer ? 'Salvar alterações' : 'Cadastrar cliente'}</button>
      </div>
    </section>
  )
}
