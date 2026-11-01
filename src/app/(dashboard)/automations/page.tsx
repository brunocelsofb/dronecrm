import { redirect } from 'next/navigation'

// Automações agora ficam na Central de regras (junto das regras dos agentes)
export default function AutomationsPage() {
  redirect('/regras?tema=funil')
}
