type Professional = {
  role: string
  quantity: number
  contractType: string
  hoursPerMonth: number
}

type Dimensionamento = {
  totalEquipamentos: number
  horasMensaisDemandadas: number
  fteDemandado: number
  fteArredondado: number
  hhLiquidoMes: number
  porComplexidade: { label: string; qty: number; mp: number; mc: number; calib: number; ee: number; qd: number; total: number }[]
  familias: { familia: string; qty: number; complexidade: string; horasMes: number }[]
  escopo: string[]
}

type Snapshot = {
  clientName: string
  projectName: string
  tipoEngenharia: string
  hospitalBeds: number
  escopoServicos: string[]
  professionals: Professional[]
  totalFTE: number
  cltCount: number
  pjCount: number
  dimensionamento?: Dimensionamento
  sentAt: string
}

export function TechnicalDocument({ snapshot, showFinancials, isHospitalar = false }: {
  snapshot: Snapshot
  showFinancials: boolean
  isHospitalar?: boolean
}) {
  const card: React.CSSProperties = { background: '#fff', borderRadius: 10, border: '0.5px solid #e8edf5', padding: 20, marginBottom: 12 }
  const muted: React.CSSProperties = { fontSize: 11, color: '#8892a4', margin: 0 }
  const lbl: React.CSSProperties = { fontSize: 10, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' as const, letterSpacing: '0.6px', margin: '0 0 2px' }
  const val: React.CSSProperties = { fontSize: 22, fontWeight: 600, color: '#fff', margin: 0 }
  const dim = snapshot.dimensionamento
  const escopo = dim?.escopo?.length ? dim.escopo : (snapshot.escopoServicos ?? [])

  // Carga horária formatada
  const fmtCarga = (h: number) => {
    if (!h) return '—'
    if (h === 220) return '220h/mês (44h/sem)'
    if (h === 180) return '180h/mês (12×36)'
    if (h === 150) return '150h/mês (30h/sem)'
    return `${h}h/mês`
  }

  return (
    <div>
      {/* Capa */}
      <div style={{ borderRadius: 12, background: 'linear-gradient(135deg,#1b556b,#32af9d)', padding: '24px 24px 20px', marginBottom: 12 }}>
        <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.8px', margin: '0 0 6px' }}>
          Proposta Técnica — Engenharia {snapshot.tipoEngenharia}
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 500, margin: '0 0 2px', color: '#fff' }}>{snapshot.clientName}</h2>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', margin: '0 0 20px' }}>{snapshot.projectName}</p>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          {snapshot.hospitalBeds > 0 && (
            <div><p style={lbl}>Leitos</p><p style={val}>{snapshot.hospitalBeds}</p></div>
          )}
          {!isHospitalar && dim && (
            <div><p style={lbl}>Equipamentos</p><p style={val}>{dim.totalEquipamentos}</p></div>
          )}
          {!isHospitalar && dim && (
            <div><p style={lbl}>FTE demandado</p><p style={val}>{dim.fteDemandado > 0 ? dim.fteDemandado : dim.fteArredondado}</p></div>
          )}
          <div><p style={lbl}>Profissionais alocados</p><p style={val}>{snapshot.totalFTE}</p></div>
        </div>
        <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', margin: '16px 0 0' }}>
          Gerado em {new Date(snapshot.sentAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Dimensionamento — só Clínica */}
      {!isHospitalar && dim && dim.totalEquipamentos > 0 && (
        <div style={card}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: '0 0 14px' }}>📊 Dimensionamento</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
            <div style={{ background: '#f8f9fb', borderRadius: 8, padding: '10px 12px' }}>
              <p style={muted}>Total de equipamentos</p>
              <p style={{ fontSize: 20, fontWeight: 600, color: '#1a1f36', margin: '2px 0 0' }}>{dim.totalEquipamentos}</p>
            </div>
            <div style={{ background: '#e8e7f4', borderRadius: 8, padding: '10px 12px' }}>
              <p style={{ ...muted, color: '#524e9c' }}>FTE demandado</p>
              <p style={{ fontSize: 20, fontWeight: 600, color: '#524e9c', margin: '2px 0 0' }}>
                {dim.fteDemandado > 0 ? dim.fteDemandado : '—'}
              </p>
            </div>
            <div style={{ background: '#e3f5f1', borderRadius: 8, padding: '10px 12px' }}>
              <p style={{ ...muted, color: '#1f8c7d' }}>FTE alocado</p>
              <p style={{ fontSize: 20, fontWeight: 600, color: '#1f8c7d', margin: '2px 0 0' }}>{snapshot.totalFTE}</p>
            </div>
          </div>
          {dim.horasMensaisDemandadas > 0 && (
            <p style={muted}>
              Demanda: {dim.horasMensaisDemandadas}h/mês · Base: {dim.hhLiquidoMes}h líquidas/técnico (produtividade 70%, absenteísmo 10%)
            </p>
          )}
        </div>
      )}

      {/* Inventário por família — só Clínica, sem complexidade e h/mês */}
      {!isHospitalar && dim && dim.familias.length > 0 && (
        <div style={card}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: '0 0 12px' }}>🏥 Inventário por Família de Equipamentos</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid #e8edf5' }}>
                <th style={{ textAlign: 'left', padding: '5px 8px', color: '#8892a4', fontWeight: 500 }}>Família</th>
                <th style={{ textAlign: 'right', padding: '5px 8px', color: '#8892a4', fontWeight: 500 }}>Quantidade</th>
              </tr>
            </thead>
            <tbody>
              {dim.familias.filter(f => f.familia?.trim()).map((f, i) => (
                <tr key={i} style={{ borderBottom: '0.5px solid #f1f3f8' }}>
                  <td style={{ padding: '6px 8px', color: '#1a1f36' }}>{f.familia}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500, color: '#1a1f36' }}>{f.qty}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid #e8edf5' }}>
                <td style={{ padding: '7px 8px', fontWeight: 600, color: '#1a1f36' }}>Total inventariado</td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600, color: '#1a1f36' }}>
                  {dim.totalEquipamentos}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Equipe — com carga horária */}
      <div style={card}>
        <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: '0 0 12px' }}>👥 Equipe do Projeto</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, background: '#f8f9fb', borderRadius: 8, padding: '8px 12px' }}>
            <p style={muted}>Total de profissionais</p>
            <p style={{ fontSize: 20, fontWeight: 600, color: '#1a1f36', margin: '2px 0 0' }}>{snapshot.totalFTE}</p>
          </div>
          {snapshot.cltCount > 0 && (
            <div style={{ flex: 1, background: '#e8e7f4', borderRadius: 8, padding: '8px 12px' }}>
              <p style={{ ...muted, color: '#524e9c' }}>CLT</p>
              <p style={{ fontSize: 20, fontWeight: 600, color: '#524e9c', margin: '2px 0 0' }}>{snapshot.cltCount}</p>
            </div>
          )}
          {snapshot.pjCount > 0 && (
            <div style={{ flex: 1, background: '#f8f9fb', borderRadius: 8, padding: '8px 12px' }}>
              <p style={muted}>PJ</p>
              <p style={{ fontSize: 20, fontWeight: 600, color: '#1a1f36', margin: '2px 0 0' }}>{snapshot.pjCount}</p>
            </div>
          )}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '0.5px solid #e8edf5' }}>
              <th style={{ textAlign: 'left', padding: '5px 8px', color: '#8892a4', fontWeight: 500 }}>Função</th>
              <th style={{ textAlign: 'center', padding: '5px 8px', color: '#8892a4', fontWeight: 500 }}>Qtd</th>
              <th style={{ textAlign: 'center', padding: '5px 8px', color: '#8892a4', fontWeight: 500 }}>Regime</th>
              <th style={{ textAlign: 'right', padding: '5px 8px', color: '#8892a4', fontWeight: 500 }}>Carga horária</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.professionals.filter(p => p.role?.trim()).map((p, i) => (
              <tr key={i} style={{ borderBottom: '0.5px solid #f1f3f8' }}>
                <td style={{ padding: '6px 8px', color: '#1a1f36' }}>{p.role}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 500, color: '#1a1f36' }}>{p.quantity}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10,
                    background: p.contractType === 'CLT' ? '#e8e7f4' : '#f1f3f8',
                    color: p.contractType === 'CLT' ? '#524e9c' : '#52514e' }}>
                    {p.contractType}
                  </span>
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#52514e' }}>
                  {p.hoursPerMonth ? fmtCarga(p.hoursPerMonth) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Escopo completo */}
      {escopo.length > 0 && (
        <div style={card}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: '0 0 12px' }}>🔧 Escopo de Serviços</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {escopo.map((s: string, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8, background: '#e3f5f1', border: '0.5px solid #bbddc8' }}>
                <span style={{ color: '#1f8c7d', fontSize: 13 }}>✓</span>
                <span style={{ fontSize: 12, color: '#1f8c7d', fontWeight: 500 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!showFinancials && (
        <p style={{ fontSize: 11, color: '#b0b8c8', textAlign: 'center', marginTop: 4 }}>
          💡 Aprovação sobre viabilidade técnica e operacional. Valores comerciais são de responsabilidade da equipe comercial.
        </p>
      )}
    </div>
  )
}
