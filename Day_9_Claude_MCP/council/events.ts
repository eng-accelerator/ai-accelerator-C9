import type { Usage } from './providers/types'
import type { CritiqueOutput, Verdict } from './schemas'
import type { CouncilConfig } from './config'

export type Stage = 'draft' | 'critique' | 'judge'

// The wire contract in spec section 9. Event order is part of the contract
// and is covered by tests.
export type CouncilEvent =
  | { type: 'run_started'; runId: string; config: CouncilConfig }
  | { type: 'stage_started'; stage: Stage }
  | { type: 'seat_started'; seat: number; model: string }
  | { type: 'token'; seat: number; text: string }
  | { type: 'seat_done'; seat: number; usage: Usage }
  | { type: 'seat_failed'; seat: number; reason: string }
  | { type: 'critique_done'; seat: number; payload: CritiqueOutput }
  | { type: 'stage_done'; stage: Stage }
  | { type: 'verdict'; payload: Verdict; confidenceAdjusted: boolean }
  | { type: 'run_done'; runId: string; usage: Usage }
  | { type: 'run_failed'; runId: string; reason: string }

export type Emit = (e: CouncilEvent) => void
