// Cadastro aberto desativado: o Drone é vendido por licença. Empresas são criadas pelo
// Super Admin e cada equipe é cadastrada pelo admin da empresa (Usuários).
import { redirect } from 'next/navigation'

export default function RegisterPage() {
  redirect('/login')
}
