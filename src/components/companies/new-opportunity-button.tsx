'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Pipeline = { id: string; name: string }
type Stage = { id: string; name: string }

export function NewOpportunityButton({
  companyId,
  pipelines,
  stagesByPipeline,
}: {
  companyId: string
  pipelines: Pipeline[]
  stagesByPipeline: Record<string, Stage[]>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? '')

  function handleGo() {
    if (!pipelineId) return
    router.push(`/contracts/new?company=${companyId}&pipeline=${pipelineId}`)
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8,
    border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none', cursor: 'pointer',
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        style={{ fontSize: 11, color: '#1b556b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
        + Nova oportunidade
      </button>

      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <p style={{ fontSize: 15, fontWeight: 500, color: '#1a1f36', marginBottom: 16 }}>Nova Oportunidade</p>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>
                Funil de vendas
              </label>
              <select value={pipelineId} onChange={e => setPipelineId(e.target.value)} style={inp}>
                {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setOpen(false)}
                style={{ padding: '8px 16px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={handleGo} disabled={!pipelineId}
                style={{ padding: '8px 20px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: 'pointer', opacity: pipelineId ? 1 : 0.4 }}>
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
