/**
 * Continuity tone: a soft sine dyad (660 Hz + 990 Hz, a perfect fifth) with a
 * gentle gain envelope — sustained while continuity holds, like a bench meter's
 * beeper but easier on the ears. Browsers gate audio behind a user gesture; the
 * AudioContext is created lazily and resumed on each start attempt, so any prior
 * click in the page (e.g. selecting the continuity function) unlocks it.
 */

let ctx: AudioContext | null = null
let active: { master: GainNode; oscs: OscillatorNode[] } | null = null

export function startTone(): void {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  if (active) return

  const t = ctx.currentTime
  const master = ctx.createGain()
  master.gain.setValueAtTime(0, t)
  master.gain.linearRampToValueAtTime(0.07, t + 0.025) // soft attack, no click
  master.connect(ctx.destination)

  const oscs = [
    { freq: 660, level: 1 },
    { freq: 990, level: 0.35 },
  ].map(({ freq, level }) => {
    const osc = ctx!.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    const g = ctx!.createGain()
    g.gain.value = level
    osc.connect(g)
    g.connect(master)
    osc.start()
    return osc
  })

  active = { master, oscs }
}

export function stopTone(): void {
  if (!ctx || !active) return
  const { master, oscs } = active
  active = null

  const t = ctx.currentTime
  master.gain.cancelScheduledValues(t)
  master.gain.setValueAtTime(master.gain.value, t)
  master.gain.linearRampToValueAtTime(0, t + 0.08) // soft release
  for (const osc of oscs) osc.stop(t + 0.12)
  setTimeout(() => master.disconnect(), 200)
}
