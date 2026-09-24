'use client'

import { useState, useEffect, useCallback } from 'react'

type Instance = {
  name: string
  connectionStatus: string
  ownerJid?: string
  profileName?: string
  profilePicUrl?: string
}

function StatusBadge({ status }: { status: string }) {
  const isOpen = status === 'open'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
      isOpen ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'
    }`}>
      <span className={`w-2 h-2 rounded-full ${isOpen ? 'bg-green-500' : 'bg-red-500'}`} />
      {isOpen ? 'Conectado' : status === 'connecting' ? 'Conectando...' : 'Desconectado'}
    </span>
  )
}

function AliasEditor({ instanceName, currentAlias, currentClosingMessage, onSave }: {
  instanceName: string
  currentAlias: string
  currentClosingMessage?: string
  onSave: (alias: string, closingMessage: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(currentAlias)
  const [closing, setClosing] = useState(currentClosingMessage ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await fetch('/api/settings/evo-aliases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName, alias: value, closingMessage: closing }),
    })
    setSaving(false)
    setEditing(false)
    onSave(value, closing)
  }

  if (editing) return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
      <div className="flex gap-1.5 items-center">
        <input value={value} onChange={e => setValue(e.target.value)}
          placeholder="Nome de exibição (ex: Bruno)"
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:border-[#1B556B] focus:outline-none" />
      </div>
      <textarea value={closing} onChange={e => setClosing(e.target.value)} rows={2}
        placeholder="Mensagem de finalização (deixe vazio para usar o padrão)"
        className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 focus:outline-none resize-none" />
      <div className="flex gap-1.5">
        <button onClick={handleSave} disabled={saving}
          className="rounded bg-[#1B556B] px-2 py-1 text-xs text-white disabled:opacity-50">
          {saving ? '...' : 'Salvar'}
        </button>
        <button onClick={() => setEditing(false)} className="text-gray-400 text-xs">Cancelar</button>
      </div>
    </div>
  )

  return (
    <button onClick={() => setEditing(true)}
      className="text-xs text-gray-400 hover:text-[#1B556B] hover:underline">
      {currentAlias ? `✏️ ${currentAlias}` : '+ Adicionar nome'}
      {currentClosingMessage && ' · mensagem personalizada'}
    </button>
  )
}

function ClosingMessageEditor({ instanceName, currentMessage, currentAlias, onSave }: {
  instanceName: string
  currentMessage: string
  currentAlias: string
  onSave: (msg: string) => void
}) {
  const [value, setValue] = useState(currentMessage)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    await fetch('/api/settings/evo-aliases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName, alias: currentAlias, closingMessage: value }),
    })
    setSaving(false); setSaved(true)
    onSave(value)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="mt-2 space-y-1">
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
        Mensagem de Encerramento
      </label>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        rows={2}
        placeholder="Ex: Atendimento finalizado! Se precisar, é só chamar. 😊 (deixe vazio para usar o texto padrão)"
        className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:border-[#1B556B] focus:outline-none resize-none"
      />
      <button onClick={handleSave} disabled={saving}
        className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
        {saving ? 'Salvando...' : saved ? '✓ Salvo' : 'Salvar mensagem'}
      </button>
    </div>
  )
}

export function WhatsAppInstancesPanel() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [aliases, setAliases] = useState<Record<string, { label: string; closingMessage?: string }>>({})
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [qrMap, setQrMap] = useState<Record<string, string>>({})
  const [loadingQr, setLoadingQr] = useState<string | null>(null)
  const [restartingInstance, setRestartingInstance] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [instRes, aliasRes] = await Promise.all([
      fetch('/api/settings/evo-instances'),
      fetch('/api/settings/evo-aliases'),
    ])
    const instData = await instRes.json()
    const aliasData = await aliasRes.json()
    setInstances((instData.instances ?? []).map((i: any) => ({
      name: i.name ?? i.instance?.instanceName ?? i.instanceName,
      connectionStatus: i.connectionStatus ?? i.instance?.state ?? 'close',
      ownerJid: i.ownerJid ?? i.instance?.ownerJid,
      profileName: i.instance?.profileName,
      profilePicUrl: i.instance?.profilePicUrl,
    })).filter((i: Instance) => i.name))
    setAliases(aliasData.aliases ?? {})
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const displayName = (name: string) => aliases[name]?.label || name

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true); setError(null)
    const res = await fetch('/api/settings/evo-instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName: newName.trim() }),
    })
    const data = await res.json()
    setCreating(false)
    if (!res.ok) { setError(data.error ?? 'Erro ao criar instância'); return }
    setNewName('')
    await fetchAll()
  }

  async function handleDelete(instanceName: string) {
    if (!confirm(`Excluir a instância "${instanceName}"?`)) return
    await fetch('/api/settings/evo-instances', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName }),
    })
    setQrMap(prev => { const n = { ...prev }; delete n[instanceName]; return n })
    await fetchAll()
  }

  async function handleGetQr(instanceName: string) {
    setLoadingQr(instanceName)
    setQrMap(prev => { const n = { ...prev }; delete n[instanceName]; return n })
    const res = await fetch('/api/settings/evo-instances', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName }),
    })
    const data = await res.json()
    setLoadingQr(null)
    if (data.qr) setQrMap(prev => ({ ...prev, [instanceName]: data.qr }))
    else setError('QR Code não disponível. Tente novamente.')
  }

  async function handleRestart(instanceName: string) {
    setRestartingInstance(instanceName)
    setError(null)
    const res = await fetch('/api/settings/evo-instances', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName }),
    })
    setRestartingInstance(null)
    if (!res.ok) {
      setError(`Erro ao reiniciar "${instanceName}". Tente novamente.`)
    } else {
      await fetchAll()
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-[#1B556B]">Instâncias conectadas</h3>
        <div className="flex gap-2">
          <button onClick={async () => {
            const res = await fetch('/api/settings/evo-instances?action=sync-webhooks')
            const data = await res.json()
            const synced = data.synced?.filter((r: any) => r.ok).length ?? 0
            alert(`✅ Webhooks sincronizados em ${synced} instância(s).`)
          }} className="rounded-md border border-[#1B556B] px-3 py-1 text-xs font-medium text-[#1B556B] hover:bg-[#1B556B]/5">
            🔗 Sincronizar Webhooks
          </button>
          <button onClick={fetchAll} className="text-xs text-gray-400 hover:text-gray-600">↻ Atualizar</button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-6">Carregando instâncias...</p>
      ) : instances.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-400">Nenhuma instância configurada ainda.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {instances.map(inst => (
            <div key={inst.name} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {inst.profilePicUrl && (
                    <img src={inst.profilePicUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-[#1B556B]">{displayName(inst.name)}</p>
                    <p className="text-[10px] font-mono text-gray-300">{inst.name}</p>
                    {inst.ownerJid && (
                      <p className="text-xs text-gray-400">{inst.ownerJid.replace('@s.whatsapp.net', '')}</p>
                    )}
                  </div>
                </div>
                <StatusBadge status={inst.connectionStatus} />
              </div>

              <AliasEditor
                instanceName={inst.name}
                currentAlias={aliases[inst.name]?.label ?? ''}
                currentClosingMessage={aliases[inst.name]?.closingMessage}
                onSave={(alias, closingMessage) => setAliases(prev => ({
                  ...prev,
                  [inst.name]: { label: alias, closingMessage: closingMessage || undefined }
                }))}
              />
              <ClosingMessageEditor
                instanceName={inst.name}
                currentMessage={aliases[inst.name]?.closingMessage ?? ''}
                currentAlias={aliases[inst.name]?.label ?? inst.name}
                onSave={(msg) => setAliases(prev => ({
                  ...prev,
                  [inst.name]: { ...(prev[inst.name] ?? { label: inst.name }), closingMessage: msg || undefined }
                }))}
              />

              <div className="flex gap-2 flex-wrap">
                {inst.connectionStatus !== 'open' && (
                  <button onClick={() => handleGetQr(inst.name)} disabled={loadingQr === inst.name}
                    className="rounded-md bg-[#1B556B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#164659] disabled:opacity-50">
                    {loadingQr === inst.name ? 'Gerando QR...' : '📱 Conectar'}
                  </button>
                )}
                <button onClick={() => handleRestart(inst.name)} disabled={restartingInstance === inst.name}
                  className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                  {restartingInstance === inst.name ? 'Reiniciando...' : '🔄 Reiniciar Conexão'}
                </button>
                <button onClick={() => handleDelete(inst.name)}
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                  🗑 Excluir
                </button>
              </div>

              {qrMap[inst.name] && (
                <div className="text-center space-y-2">
                  <p className="text-xs text-gray-500">Escaneie com o WhatsApp</p>
                  <img src={qrMap[inst.name]} alt="QR Code" className="mx-auto max-w-[200px] rounded-lg border" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <p className="text-sm font-semibold text-[#1B556B]">Adicionar nova instância</p>
        <div className="flex gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Ex: drone_comercial_v2"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none" />
          <button onClick={handleCreate} disabled={creating || !newName.trim()}
            className="rounded-lg bg-[#1B556B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#164659] disabled:opacity-50">
            {creating ? 'Criando...' : '+ Criar'}
          </button>
        </div>
        <p className="text-xs text-gray-400">O webhook será registrado automaticamente na nova instância.</p>
      </div>
    </div>
  )
}
