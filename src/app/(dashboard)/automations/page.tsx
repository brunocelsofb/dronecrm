import { redirect } from 'next/navigation'

// Automações agora ficam na tela Regras automáticas (junto das regras dos agentes)
export default function AutomationsPage() {
  redirect('/regras#funil')
}
