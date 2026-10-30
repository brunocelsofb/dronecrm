// Código para colar no site da empresa:
// <script async src="https://app.comercialdrone.com.br/api/t/script" data-empresa="<empresa>"></script>
import { trackerScript } from '@/lib/analytics/tracker-script'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  return new Response(trackerScript({ startUrl: `${origin}/api/t/v`, endUrl: `${origin}/api/t/x`, slugAttr: true }), {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
  })
}
