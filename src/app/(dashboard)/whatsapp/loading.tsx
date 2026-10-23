export default function WhatsAppLoading() {
  return (
    <div className="flex flex-col h-[calc(100dvh-5.5rem)] md:h-[calc(100dvh-4rem)] animate-pulse">
      <div className="flex items-center justify-between px-1 py-2 flex-shrink-0">
        <div className="h-5 w-48 rounded bg-gray-200" />
        <div className="h-7 w-24 rounded bg-gray-200" />
      </div>
      <div className="flex flex-1 min-h-0 gap-3">
        <div className="w-full md:w-72 shrink-0 border-r border-gray-100 pr-2 space-y-2 pt-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-lg border border-gray-100 p-3 space-y-2">
              <div className="h-4 w-3/4 rounded bg-gray-200" />
              <div className="h-3 w-full rounded bg-gray-100" />
            </div>
          ))}
        </div>
        <div className="hidden md:flex flex-1 flex-col items-center justify-center gap-3">
          <div className="h-12 w-12 rounded-full bg-gray-200" />
          <div className="h-4 w-32 rounded bg-gray-200" />
        </div>
      </div>
    </div>
  )
}
