import type uPlot from 'uplot'
import { cssVar } from '@/composables/useTheme'
import { stepDecimals } from '@/lib/format'

/**
 * uPlot glue shared by the trend, histogram and session charts: theme-aware axis
 * styling (uPlot draws on canvas, so colors come from the CSS tokens at build time —
 * charts rebuild on a theme change), tooltip placement, and PNG export.
 */

export const CHART_FONT = '11px Iosevka, ui-monospace, monospace'

export function themedAxis(extra: Partial<uPlot.Axis> = {}): uPlot.Axis {
  return {
    stroke: cssVar('--chart-axis'),
    grid: { stroke: cssVar('--chart-grid'), width: 1 },
    ticks: { stroke: cssVar('--chart-tick'), width: 1 },
    font: CHART_FONT,
    ...extra,
  }
}

/**
 * Tick labels with as many decimals as the tick step needs. uPlot's default rounds
 * to a few significant digits, which collapses every label to the same string when
 * the spread is tiny relative to the value (a few µV around 5 V).
 */
export function stepTicks(
  _u: uPlot,
  splits: number[],
  _ax: number,
  _space: number,
  incr: number,
): string[] {
  return splits.map((v) => v.toFixed(stepDecimals(incr)))
}

/** Position a floating tooltip above the cursor, flipping at the plot edges. */
export function placeTip(u: uPlot, tip: HTMLElement, edge = 80): void {
  const left = u.cursor.left ?? 0
  const top = u.cursor.top ?? 0
  const w = u.over.clientWidth
  const tx = left < edge ? '0' : left > w - edge ? '-100%' : '-50%'
  tip.style.left = `${left}px`
  tip.style.top = `${top}px`
  tip.style.transform = `translate(${tx}, calc(-100% - 12px))`
}

/** Create the standard two-line tooltip element inside the plot overlay. */
export function makeTip(u: uPlot): { tip: HTMLDivElement; a: HTMLSpanElement; b: HTMLSpanElement } {
  const tip = document.createElement('div')
  tip.className = 'tip'
  const a = document.createElement('span')
  a.className = 'tip-v'
  const b = document.createElement('span')
  b.className = 'tip-t'
  tip.append(a, b)
  tip.style.display = 'none'
  u.over.appendChild(tip)
  return { tip, a, b }
}

/** Stroke a horizontal line at a y-scale value across the plot area. */
export function hLine(u: uPlot, y: number, color: string, width = 1.5, dash: number[] = []): void {
  if (!Number.isFinite(y)) return
  const ctx = u.ctx
  const py = Math.round(u.valToPos(y, 'y', true)) + 0.5
  if (py < u.bbox.top || py > u.bbox.top + u.bbox.height) return
  ctx.save()
  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.lineWidth = width * devicePixelRatio
  ctx.setLineDash(dash.map((d) => d * devicePixelRatio))
  ctx.moveTo(u.bbox.left, py)
  ctx.lineTo(u.bbox.left + u.bbox.width, py)
  ctx.stroke()
  ctx.restore()
}

/** Stroke a vertical line at an x-scale value; returns its canvas x (or null if off-plot). */
export function vLine(
  u: uPlot,
  x: number,
  color: string,
  width = 1.5,
  dash: number[] = [],
): number | null {
  const ctx = u.ctx
  const px = Math.round(u.valToPos(x, 'x', true)) + 0.5
  if (px < u.bbox.left || px > u.bbox.left + u.bbox.width) return null
  ctx.save()
  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.lineWidth = width * devicePixelRatio
  ctx.setLineDash(dash.map((d) => d * devicePixelRatio))
  ctx.moveTo(px, u.bbox.top)
  ctx.lineTo(px, u.bbox.top + u.bbox.height)
  ctx.stroke()
  ctx.restore()
  return px
}

/** Shade the band between two y values (e.g. outside the limits). */
export function hBand(u: uPlot, y0: number, y1: number, color: string): void {
  const top = u.bbox.top
  const bot = top + u.bbox.height
  const p0 = Math.min(bot, Math.max(top, u.valToPos(y0, 'y', true)))
  const p1 = Math.min(bot, Math.max(top, u.valToPos(y1, 'y', true)))
  if (Math.abs(p1 - p0) < 1) return
  u.ctx.save()
  u.ctx.fillStyle = color
  u.ctx.fillRect(u.bbox.left, Math.min(p0, p1), u.bbox.width, Math.abs(p1 - p0))
  u.ctx.restore()
}

/** Small text label drawn on the canvas (CSS px coordinates relative to the plot box). */
export function canvasLabel(u: uPlot, text: string, px: number, color: string): void {
  const ctx = u.ctx
  const dpr = devicePixelRatio
  ctx.save()
  ctx.font = `600 ${10 * dpr}px "Noto Sans", sans-serif`
  const w = ctx.measureText(text).width + 8 * dpr
  const h = 15 * dpr
  const x = Math.min(px + 3 * dpr, u.bbox.left + u.bbox.width - w)
  const y = u.bbox.top + 2 * dpr
  ctx.fillStyle = cssVar('--panel')
  ctx.globalAlpha = 0.85
  ctx.fillRect(x, y, w, h)
  ctx.globalAlpha = 1
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 4 * dpr, y + h / 2)
  ctx.restore()
}

/**
 * Save the chart as a PNG: the plot canvas on the panel background with a title
 * line (what/when) above it, so the image stands alone in a report.
 */
export function exportPng(u: uPlot, title: string, subtitle: string, filename: string): void {
  const src = u.ctx.canvas
  const dpr = devicePixelRatio
  const head = Math.round(46 * dpr)
  const pad = Math.round(16 * dpr)
  const out = document.createElement('canvas')
  out.width = src.width + pad * 2
  out.height = src.height + head + pad
  const g = out.getContext('2d')!
  g.fillStyle = cssVar('--panel')
  g.fillRect(0, 0, out.width, out.height)
  g.fillStyle = cssVar('--text')
  g.font = `700 ${14 * dpr}px "Noto Sans", sans-serif`
  g.textBaseline = 'alphabetic'
  g.fillText(title, pad, pad + 14 * dpr)
  g.fillStyle = cssVar('--muted')
  g.font = `400 ${11 * dpr}px "Noto Sans", sans-serif`
  g.fillText(subtitle, pad, pad + 30 * dpr)
  g.drawImage(src, pad, head)
  out.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }, 'image/png')
}

/** A filesystem-friendly local timestamp for export names, e.g. 2026-10-17_0623. */
export function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}
