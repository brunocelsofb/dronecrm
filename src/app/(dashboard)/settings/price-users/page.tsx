'use client'

import { useEffect, useState } from 'react'

type PriceUser = {
  id: string
  email: string
  full_name: string
  role: 'admin' | 'editor' | 'reviewer'
  created_at: string
  is_banned?: boolean
}

export default function PriceUsersPage() {
  const [users, setUsers] = useState<PriceUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', full_name: '', role: 'reviewer', password: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function loadUsers() {
    setLoading(true)
    const res = await fetch('/api/price-users')
    const data = await res.json()
    setUsers(data.users ?? [])
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [])

  async function handleCreate() {
    if (!form.email || !form.full_name || !form.password) { setError('Preencha todos os campos'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/price-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setSaving(false); return }
    setShowForm(false)
    setForm({ email: '', full_name: '', role: 'reviewer', password: '' })
    loadUsers()
    setSaving(false)
  }

  const [savedId, setSavedId] = useState<string | null>(null)

  async function handleRoleChange(id: string, role: string) {
    await fetch('/api/price-users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, role }),
    })
    setSavedId(id)
    setTimeout(() => setSavedId(null), 2000)
    loadUsers()
  }

  async function handleToggleActive(id: string, currentlyBanned: boolean) {
    if (!confirm(currentlyBanned ? 'Reativar este usuário?' : 'Desativar este usuário? Ele não conseguirá mais fazer login no Price.')) return
    await fetch('/api/price-users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'toggle_active', active: currentlyBanned }),
    })
    loadUsers()
  }

  async function handleDelete(id: string, email: string) {
    if (!confirm(`Excluir o usuário ${email} do ORBIS Price permanentemente?`)) return
    await fetch('/api/price-users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    loadUsers()
  }

  const inp: React.CSSProperties = { width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 8, border: '0.5px solid #d1d8e8', outline: 'none', color: '#1a1f36', background: '#fff', boxSizing: 'border-box' as const }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Usuários do ORBIS Price</h1>
          <p style={{ fontSize: 12, color: '#8892a4', margin: '4px 0 0' }}>Gerencie quem tem acesso ao sistema de precificação</p>
        </div>
        <button onClick={() => setShowForm(true)}
          style={{ padding: '8px 16px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#1b556b,#32af9d)', color: '#fff', cursor: 'pointer' }}>
          + Novo usuário
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20, marginBottom: 20 }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: '#1a1f36', marginBottom: 16 }}>Novo usuário do Price</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: '#8892a4', display: 'block', marginBottom: 4 }}>Nome completo *</label>
              <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} style={inp} placeholder="Carlos Mendes" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#8892a4', display: 'block', marginBottom: 4 }}>E-mail *</label>
              <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={inp} type="email" placeholder="carlos@orbis.com.br" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#8892a4', display: 'block', marginBottom: 4 }}>Senha inicial *</label>
              <input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={inp} type="password" placeholder="Mínimo 6 caracteres" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#8892a4', display: 'block', marginBottom: 4 }}>Perfil *</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={{ ...inp, cursor: 'pointer' }}>
                <option value="reviewer">👁 Somente leitura (Aprovador)</option>
                <option value="editor">✏️ Editor (Precificador)</option>
                <option value="admin">⚙️ Admin</option>
              </select>
            </div>
          </div>
          {error && <p style={{ fontSize: 12, color: '#8e4550', marginBottom: 8 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>Cancelar</button>
            <button onClick={handleCreate} disabled={saving} style={{ padding: '8px 20px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Criando...' : 'Criar usuário'}
            </button>
          </div>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#8892a4' }}>Carregando...</p>
        ) : users.length === 0 ? (
          <p style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#8892a4' }}>Nenhum usuário cadastrado.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid #e8edf5' }}>
                <th style={{ textAlign: 'left', padding: '10px 16px', color: '#8892a4', fontWeight: 500, fontSize: 11 }}>USUÁRIO</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', color: '#8892a4', fontWeight: 500, fontSize: 11 }}>PERFIL</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', color: '#8892a4', fontWeight: 500, fontSize: 11 }}>STATUS</th>
                <th style={{ padding: '10px 16px' }} />
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '0.5px solid #f1f3f8', opacity: u.is_banned ? 0.5 : 1 }}>
                  <td style={{ padding: '12px 16px' }}>
                    <p style={{ fontWeight: 500, color: '#1a1f36', margin: 0 }}>{u.full_name}</p>
                    <p style={{ fontSize: 11, color: '#8892a4', margin: '2px 0 0' }}>{u.email}</p>
                  </td>
                  <td style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <select value={u.role} onChange={e => handleRoleChange(u.id, e.target.value)}
                      style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '0.5px solid #d1d8e8', background: '#fff', cursor: 'pointer' }}>
                      <option value="reviewer">👁 Somente leitura</option>
                      <option value="editor">✏️ Editor</option>
                      <option value="admin">⚙️ Admin</option>
                    </select>
                    {savedId === u.id && (
                      <span style={{ fontSize: 11, color: '#1f8c7d', fontWeight: 500 }}>✅ Salvo</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                      background: u.is_banned ? '#f6e9ea' : '#e3f5f1',
                      color: u.is_banned ? '#8e4550' : '#1f8c7d' }}>
                      {u.is_banned ? 'Inativo' : 'Ativo'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => handleToggleActive(u.id, !!u.is_banned)}
                        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>
                        {u.is_banned ? 'Reativar' : 'Desativar'}
                      </button>
                      <button onClick={() => handleDelete(u.id, u.email)}
                        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '0.5px solid #dcadb3', background: '#fff', color: '#8e4550', cursor: 'pointer' }}>
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 10, background: '#f8f9fb', border: '0.5px solid #e8edf5', fontSize: 12, color: '#8892a4' }}>
        <strong style={{ color: '#1a1f36' }}>👁 Somente leitura</strong> — vê tudo mas não edita. Ideal para aprovadores.<br/>
        <strong style={{ color: '#1a1f36' }}>✏️ Editor</strong> — acesso completo para criar e editar precificações.
      </div>
    </div>
  )
}
