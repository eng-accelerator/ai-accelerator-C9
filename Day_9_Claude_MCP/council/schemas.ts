import { z } from 'zod'

const NonEmpty = z.string().min(1)

// Spec 4.2: at minimum one gap and one risk per peer. A critic cannot pass
// by saying the peer looks good. Empty arrays fail validation and trigger
// exactly one repair round-trip.
export const PeerCritiqueSchema = z.object({
  target: z.enum(['A', 'B']),
  strengths: z.array(NonEmpty).min(1),
  gaps: z.array(NonEmpty).min(1),
  risks: z.array(NonEmpty).min(1),
  factual_errors: z.array(NonEmpty),
})

// One entry per peer shown. A full council shows 2 peers; a degraded council
// of 2 drafters shows 1. Fixing this at 2 would fail every degraded run.
export const CritiqueOutputSchema = z
  .object({
    critiques: z.array(PeerCritiqueSchema).min(1).max(2),
    revised_answer: NonEmpty,
  })
  .superRefine((data, ctx) => {
    const targets = data.critiques.map((c) => c.target)
    if (new Set(targets).size !== targets.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Each peer must be critiqued at most once — duplicate targets are not allowed',
        path: ['critiques'],
      })
    }
  })

export const ProvenanceEntrySchema = z.object({
  claim: NonEmpty,
  support: z.enum(['unanimous', 'majority', 'single']),
  seats: z.array(z.number().int()),
})

export const ContestedEntrySchema = z.object({
  point: NonEmpty,
  positions: z.array(z.object({ seat: z.number().int(), position: NonEmpty })).min(2),
  ruling: NonEmpty,
  reasoning: NonEmpty,
})

export const VerdictSchema = z.object({
  answer_markdown: NonEmpty,
  provenance: z.array(ProvenanceEntrySchema),
  contested: z.array(ContestedEntrySchema),
  confidence: z.enum(['high', 'medium', 'low']),
})

export type PeerCritique = z.infer<typeof PeerCritiqueSchema>
export type CritiqueOutput = z.infer<typeof CritiqueOutputSchema>
export type Verdict = z.infer<typeof VerdictSchema>
export type Confidence = Verdict['confidence']
