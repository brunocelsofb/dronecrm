'use client'

import Link from 'next/link'
import { ValidityBadge } from '@/components/contracts/validity-badge'

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  open:   { bg: '#e8e7f4', color: '#524e9c' },
  won:    { bg: '#e3f5f1', color: '#1f8c7d' },
  lost:   { bg: '#f6e9ea', color: '#8e4550' },
  paused: { bg: '#fbeee5', color: '#c2683d' },
}
const STATUS_LABEL: Record<string, string> = {
  open: 'Em andamento', won: 'Ganho', lost: 'Perdido', paused: 'Pausado',
}

type Contract = {
  id: string
  process_number: string
  title: string
  client_name: string
  value: number
  run_status: string | null
  stage_id: string | null
  stage?: { name: string; color: string | null } | null
  valid_until?: string | null
}

export function ContractsTable({ contracts, q }: { contracts: Contract[]; q?: string }) {
  return (
    <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {['Nº processo', 'Empresa / oportunidade', 'Etapa', 'Validade', 'Status', 'Valor'].map((h, i) => (
            <th key={h} style={{ padding: '10px 16px', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', fontWeight: 500, textAlign: i === 5 ? 'right' : 'left', borderBottom: '0.5px solid #f1f3f8', width: i === 0 ? '12%' : i === 1 ? '26%' : i === 2 ? '18%' : i === 3 ? '14%' : i === 4 ? '14%' : '16%' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {contracts.map((c) => {
          const st = STATUS_STYLE[c.run_status ?? 'open'] ?? STATUS_STYLE.open
          const stLabel = STATUS_LABEL[c.run_status ?? 'open'] ?? c.run_status
          return (
            <tr key={c.id}
              style={{ borderBottom: '0.5px solid #f8f9fb' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#fafbfd')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <td style={{ padding: '12px 16px', fontSize: 11, fontFamily: 'monospace', color: '#8892a4' }}>
                <Link href={`/contracts/${c.id}`} style={{ color: '#1b556b', textDecoration: 'none' }}>{c.process_number}</Link>
              </td>
              <td style={{ padding: '12px 16px' }}>
                <Link href={`/contracts/${c.id}`} style={{ textDecoration: 'none' }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>{c.client_name}</p>
                  <p style={{ fontSize: 11, color: '#8892a4', marginTop: 2 }}>{c.title}</p>
                </Link>
              </td>
              <td style={{ padding: '12px 16px' }}>
                {c.stage ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: (c.stage.color ?? '#8892a4') + '20', color: c.stage.color ?? '#8892a4' }}>
                    {c.stage.name}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: '#c8cdd8' }}>Sem funil</span>
                )}
              </td>
              <td style={{ padding: '12px 16px' }}>
                <ValidityBadge validUntil={c.valid_until ?? null} runStatus={c.run_status} />
              </td>
              <td style={{ padding: '12px 16px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: st.bg, color: st.color }}>
                  {stLabel}
                </span>
              </td>
              <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, fontWeight: 500, color: '#1a1f36' }}>
                {fmt(Number(c.value || 0))}
              </td>
            </tr>
          )
        })}
        {contracts.length === 0 && (
          <tr>
            <td colSpan={6} style={{ padding: '48px 16px', textAlign: 'center', fontSize: 13, color: '#8892a4' }}>
              {q ? `Nenhuma oportunidade encontrada para "${q}".` : 'Nenhuma oportunidade cadastrada ainda.'}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
