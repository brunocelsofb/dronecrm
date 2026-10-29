'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function LoginForm() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    // Abre a página inteira (não troca de tela por dentro): lê o login novo no servidor e os
    // arquivos da versão publicada agora. Trocar por dentro às vezes deixava a tela em branco.
    window.location.assign('/')
  }

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      <div>
        <label className="block text-sm font-semibold text-[#1B556B]">E-mail</label>
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#1B556B] focus:ring-2 focus:ring-[#1B556B]/20 focus:outline-none" />
      </div>
      <div>
        <label className="block text-sm font-semibold text-[#1B556B]">Senha</label>
        <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#1B556B] focus:ring-2 focus:ring-[#1B556B]/20 focus:outline-none" />
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <button type="submit" disabled={loading}
        className="w-full rounded-lg bg-[#1B556B] py-2.5 text-sm font-semibold text-white hover:bg-[#164659] disabled:opacity-50 transition-colors">
        {loading ? 'Entrando...' : 'Entrar'}
      </button>
      <p className="text-center text-sm text-gray-500">
        Não tem conta?{' '}
        <a href="/register" className="font-medium text-[#1B556B] underline">Criar conta</a>
      </p>
    </form>
  )
}
