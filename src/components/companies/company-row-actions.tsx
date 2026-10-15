'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { deleteCompany } from '@/lib/actions/companies'

export function CompanyRowActions({ companyId, companyName, isAdmin }: { companyId: string; companyName: string; isAdmin: boolean }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm(`Excluir "${companyName}"? Esta ação não pode ser desfeita.`)) return
    setDeleting(true)
    const result = await deleteCompany(companyId)
    setDeleting(false)
    if ((result as any)?.error) alert((result as any).error)
    else router.refresh()
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Link href={`/companies/${companyId}`} style={{ fontSize: 11, color: '#1b556b', textDecoration: 'none' }}>Ver</Link>
      {isAdmin && (
        <button onClick={handleDelete} disabled={deleting}
          style={{ fontSize: 11, color: '#8e4550', background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: deleting ? 0.5 : 1 }}>
          {deleting ? '...' : 'Excluir'}
        </button>
      )}
    </div>
  )
}

export function InativoDaysSelector({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: '#8892a4' }}>Inativo após</span>
      <select defaultValue={current}
        onChange={e => {
          const url = new URL(window.location.href)
          url.searchParams.set('inativo', e.target.value)
          window.location.href = url.toString()
        }}
        style={{ padding: '4px 8px', fontSize: 11, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>
        {[30, 60, 90, 120, 180, 365].map(d => (
          <option key={d} value={d}>{d} dias</option>
        ))}
      </select>
    </div>
  )
}
