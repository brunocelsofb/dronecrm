'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function RegisterPage() {
  const router = useRouter()
  const supabase = createClient()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // NOTA: dependendo da config do projeto Supabase, signUp pode
    // exigir confirmação por e-mail antes de liberar login. Isso é
    // configurável no painel (Authentication > Settings) — não
    // tenho certeza de qual é o padrão atual, verifique lá.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Cria o registro correspondente em "profiles".
    // Assumindo aqui que NÃO há um trigger automático configurado
    // no banco (auth.users -> public.profiles). Se você criar esse
    // trigger no Supabase futuramente, este insert manual pode ser
    // removido para evitar duplicidade.
    //
    // CORREÇÃO: antes esse erro era ignorado silenciosamente — foi
    // exatamente isso que causou o bug do "insert or update on table
    // contracts violates foreign key constraint contracts_owner_id_fkey"
    // em contas criadas antes das políticas de RLS existirem. Agora
    // mostramos o erro real para o usuário em vez de fingir sucesso.
    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').insert({
        id: data.user.id,
        full_name: fullName,
        email,
      })

      if (profileError) {
        setError(
          `Conta criada, mas houve um problema ao configurar seu perfil: ${profileError.message}. Contate o administrador.`
        )
        setLoading(false)
        return
      }
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm space-y-4 rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Conta criada</h1>
          <p className="text-sm text-gray-500">
            Verifique seu e-mail para confirmar o cadastro (se a confirmação estiver
            habilitada no projeto) e depois faça login.
          </p>
          <a href="/login" className="inline-block text-sm font-medium text-gray-900 underline">
            Ir para login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Criar conta</h1>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Nome completo</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">E-mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Senha</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Criando...' : 'Criar conta'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          Já tem conta?{' '}
          <a href="/login" className="font-medium text-gray-900 underline">
            Entrar
          </a>
        </p>
      </div>
    </div>
  )
}
