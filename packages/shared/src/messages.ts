import { z } from 'zod'
import { METER_FUNCTIONS } from './functions.js'

export const MeterFunctionSchema = z.enum(METER_FUNCTIONS)

/** A single measurement sample. */
export const ReadingSchema = z.object({
  ts: z.number(), // epoch milliseconds
  value: z.number(), // parsed value (±Infinity when overloaded)
  unit: z.string(),
  function: z.string(),
  overload: z.boolean().default(false),
  raw: z.string().optional(),
})
export type Reading = z.infer<typeof ReadingSchema>

/** Full instrument + broker state, broadcast on change. */
export const MeterStateSchema = z.object({
  connected: z.boolean(),
  enabled: z.boolean(), // false = user disconnected; socket closed, panel free

  idn: z.string().nullable(),
  resource: z.string().nullable(),
  function: MeterFunctionSchema.nullable(),
  range: z.string().nullable(), // numeric string, or 'AUTO'
  autoRange: z.boolean().nullable(),
  nplc: z.number().nullable(),
  // CONT only; the instrument resets it to 50 Ω on every CONFigure.
  contThreshold: z.number().nullable(),
  // Relative/Null offset (per function; the meter subtracts nullValue when enabled).
  nullEnabled: z.boolean().default(false),
  nullValue: z.number().nullable().default(null),
  // AC functions only: low-frequency AC filter, in Hz (3 / 20 / 200).
  acBandwidth: z.number().nullable().default(null),
  // FREQ/PER only: gate time (aperture), in seconds (0.01 / 0.1 / 1).
  freqAperture: z.number().nullable().default(null),
  polling: z.boolean(),
  intervalMs: z.number(),
  lastError: z.string().nullable(),
})
export type MeterState = z.infer<typeof MeterStateSchema>

/* ------------------------------------------------------------------ */
/* Client -> Server                                                    */
/* ------------------------------------------------------------------ */

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setFunction'), function: MeterFunctionSchema }),
  z.object({ type: z.literal('setRange'), range: z.string() }), // numeric or 'AUTO'
  z.object({ type: z.literal('setAutoRange'), enabled: z.boolean() }),
  z.object({ type: z.literal('setNplc'), nplc: z.number().positive() }),
  z.object({ type: z.literal('setContThreshold'), ohms: z.number().min(0).max(2000) }),
  z.object({ type: z.literal('setNull'), enabled: z.boolean(), value: z.number() }),
  z.object({ type: z.literal('setAcBandwidth'), hz: z.number() }),
  z.object({ type: z.literal('setFreqAperture'), seconds: z.number().positive() }),
  z.object({ type: z.literal('setPolling'), enabled: z.boolean() }),
  z.object({ type: z.literal('setConnected'), enabled: z.boolean() }),
  z.object({ type: z.literal('setInterval'), intervalMs: z.number().int().min(50).max(60000) }),
  z.object({ type: z.literal('measureOnce') }),
  z.object({ type: z.literal('refresh') }),
  z.object({ type: z.literal('raw'), cmd: z.string().min(1), expectReply: z.boolean() }),
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>

/* ------------------------------------------------------------------ */
/* Server -> Client                                                    */
/* ------------------------------------------------------------------ */

export const ConsoleEntrySchema = z.object({
  ts: z.number(),
  direction: z.enum(['tx', 'rx', 'info', 'error']),
  text: z.string(),
})
export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    state: MeterStateSchema,
    readings: z.array(ReadingSchema),
  }),
  z.object({ type: z.literal('state'), state: MeterStateSchema }),
  z.object({ type: z.literal('reading'), reading: ReadingSchema }),
  z.object({ type: z.literal('console'), entry: ConsoleEntrySchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
])
export type ServerMessage = z.infer<typeof ServerMessageSchema>
