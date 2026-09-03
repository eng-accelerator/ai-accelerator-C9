import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import type { RunRecord } from '@/council/orchestrator'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createPrisma(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? 'file:./dev.db',
  })
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrisma()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

type RunRow = {
  id: string
  query: string
  config: string
  status: string
  stages: string
  verdict: string | null
  usage: string
  error: string | null
  elapsedMs: number
}

/**
 * The single seam between the domain model and storage. Moving to Postgres
 * means changing the datasource and dropping the JSON.stringify calls here.
 */
export function serializeRun(run: RunRecord): RunRow {
  return {
    id: run.id,
    query: run.query,
    config: JSON.stringify(run.config),
    status: run.status,
    stages: JSON.stringify({ ...run.stages, confidenceAdjusted: run.confidenceAdjusted }),
    verdict: run.verdict ? JSON.stringify(run.verdict) : null,
    usage: JSON.stringify(run.usage),
    error: run.error ?? null,
    elapsedMs: run.elapsedMs,
  }
}

export function deserializeRun(row: RunRow): RunRecord {
  const stages = JSON.parse(row.stages) as RunRecord['stages'] & { confidenceAdjusted: boolean }
  const { confidenceAdjusted, ...rest } = stages
  const record: RunRecord = {
    id: row.id,
    query: row.query,
    config: JSON.parse(row.config),
    status: row.status as RunRecord['status'],
    stages: { drafts: rest.drafts, critiques: rest.critiques },
    verdict: row.verdict ? JSON.parse(row.verdict) : null,
    confidenceAdjusted,
    usage: JSON.parse(row.usage),
    elapsedMs: row.elapsedMs,
  }
  if (row.error !== null) record.error = row.error
  return record
}

export async function saveRun(run: RunRecord): Promise<string> {
  const data = serializeRun(run)
  await prisma.run.upsert({ where: { id: run.id }, create: data, update: data })
  return run.id
}

export async function loadRun(id: string): Promise<RunRecord | null> {
  const row = await prisma.run.findUnique({ where: { id } })
  return row ? deserializeRun(row as RunRow) : null
}
