export const runtime = 'nodejs'
export const revalidate = 3600

type CatalogModel = { id: string; name: string; context_length: number; pricing: { prompt: string } }

export async function GET() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    next: { revalidate: 3600 },
  })
  if (!res.ok) {
    return Response.json({ error: `catalog unavailable (${res.status})` }, { status: 502 })
  }

  const data = (await res.json()) as { data: CatalogModel[] }

  // Trim the payload — the roster picker needs four fields, not the full
  // catalog, which is several hundred KB.
  const models = data.data
    .map((m) => ({
      id: m.id,
      name: m.name,
      context: m.context_length,
      inputPerM: Number(m.pricing?.prompt ?? 0) * 1e6,
      lab: m.id.split('/')[0],
    }))
    .filter((m) => !m.id.endsWith(':batch'))
    .sort((a, b) => a.id.localeCompare(b.id))

  return Response.json({ models })
}
