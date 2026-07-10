/**
 * Phosphor-persistence renderer: draws the reading stream the way an analog
 * scope's phosphor would show it — beam dwell accumulates brightness, fast slews
 * dim, history decays. Stateless by design: every frame re-splats the whole
 * visible window as capsule segments into a float accumulation buffer, then
 * tonemaps through a phosphor palette with a half-res bloom pass. Re-rendering
 * from data (instead of decaying a stateful buffer) keeps rescale/resize exact
 * and leaves nothing to corrupt.
 *
 * The caller supplies segments in device pixels with a precomputed intensity
 * (age decay × beam-speed dimming); the renderer only accumulates and grades.
 */

export type PhosphorPalette = 'green' | 'cyan' | 'amber'

export const PALETTE_TINT: Record<PhosphorPalette, [number, number, number]> = {
  green: [0.35, 1.0, 0.45],
  cyan: [0.4, 0.95, 1.0],
  amber: [1.0, 0.72, 0.22],
}

/** Floats per segment in the interleaved buffer: x0,y0,x1,y1,intensity. */
export const SEG_STRIDE = 5

const VS_SEG = `#version 300 es
layout(location=0) in vec4 aSeg;
layout(location=1) in float aInt;
uniform vec2 uRes;
uniform float uRad;
out vec2 vPos;
flat out vec4 vSeg;
flat out float vInt;
void main() {
  // Expand a unit strip (4 verts, ids 0..3) into a capsule-covering quad.
  float t = gl_VertexID >= 2 ? 1.0 : 0.0;
  float side = (gl_VertexID == 0 || gl_VertexID == 2) ? -1.0 : 1.0;
  vec2 p0 = aSeg.xy, p1 = aSeg.zw;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  vec2 p = mix(p0, p1, t) + dir * (t * 2.0 - 1.0) * uRad + n * side * uRad;
  vPos = p;
  vSeg = aSeg;
  vInt = aInt;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
}`

const FS_SEG = `#version 300 es
precision highp float;
in vec2 vPos;
flat in vec4 vSeg;
flat in float vInt;
uniform float uSigma;
out vec4 o;
void main() {
  vec2 a = vSeg.xy, ba = vSeg.zw - a, pa = vPos - a;
  float bb = dot(ba, ba);
  float h = bb > 1e-8 ? clamp(dot(pa, ba) / bb, 0.0, 1.0) : 0.0;
  float d = length(pa - ba * h);
  // Gaussian beam core plus a wide faint halo (the phosphor's spill).
  float core = exp(-0.5 * d * d / (uSigma * uSigma));
  float halo = 0.10 * exp(-d / (uSigma * 3.0));
  o = vec4(vInt * (core + halo), 0.0, 0.0, 1.0);
}`

const VS_QUAD = `#version 300 es
out vec2 vUv;
void main() {
  // Fullscreen triangle from gl_VertexID; no buffers.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 o;
void main() {
  float w[5] = float[](0.227027, 0.194594, 0.121621, 0.054054, 0.016216);
  float s = texture(uTex, vUv).r * w[0];
  for (int i = 1; i < 5; i++) {
    s += texture(uTex, vUv + uDir * float(i)).r * w[i];
    s += texture(uTex, vUv - uDir * float(i)).r * w[i];
  }
  o = vec4(s, 0.0, 0.0, 1.0);
}`

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uAcc;
uniform sampler2D uBloom;
uniform vec3 uTint;
uniform float uGain;
uniform vec2 uRes;
uniform vec2 uGrid;
out vec4 o;
void main() {
  float I = texture(uAcc, vUv).r + texture(uBloom, vUv).r * 0.55;
  // Filmic-ish saturation: dwell density compresses toward full brightness,
  // and the hottest spots bleach to white like overdriven phosphor.
  float L = 1.0 - exp(-I * uGain);
  vec3 col = uTint * L + vec3(1.0) * pow(L, 4.0) * 0.85;
  // Graticule, under the trace visually because the trace saturates over it.
  vec2 cell = uRes / uGrid;
  vec2 q = mod(vUv * uRes, cell);
  vec2 dl = min(q, cell - q);
  float line = 1.0 - smoothstep(0.5, 1.2, min(dl.x, dl.y));
  col += uTint * line * 0.05;
  col += uTint * 0.02; // idle phosphor glow so the screen reads as a lit CRT
  o = vec4(col, 1.0);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`phosphor shader: ${gl.getShaderInfoLog(sh)}`)
  }
  return sh
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`phosphor link: ${gl.getProgramInfoLog(p)}`)
  }
  return p
}

interface Target {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
  w: number
  h: number
}

export class PhosphorRenderer {
  private gl: WebGL2RenderingContext | null = null
  private progSeg!: WebGLProgram
  private progBlur!: WebGLProgram
  private progComp!: WebGLProgram
  private segBuf!: WebGLBuffer
  private segVao!: WebGLVertexArrayObject
  private quadVao!: WebGLVertexArrayObject
  private acc: Target | null = null
  private bloomA: Target | null = null
  private bloomB: Target | null = null
  private halfFloat = false
  private w = 0
  private h = 0

  /** False when WebGL2 is unavailable; the component shows a fallback note. */
  readonly ok: boolean

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    })
    this.ok = !!gl
    if (!gl) return
    this.gl = gl
    // Float accumulation needs this extension; without it RGBA8 still works,
    // density just clips earlier.
    this.halfFloat = !!gl.getExtension('EXT_color_buffer_float')
    this.progSeg = link(gl, VS_SEG, FS_SEG)
    this.progBlur = link(gl, VS_QUAD, FS_BLUR)
    this.progComp = link(gl, VS_QUAD, FS_COMPOSITE)
    this.segBuf = gl.createBuffer()!
    this.segVao = gl.createVertexArray()!
    gl.bindVertexArray(this.segVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, SEG_STRIDE * 4, 0)
    gl.vertexAttribDivisor(0, 1)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, SEG_STRIDE * 4, 16)
    gl.vertexAttribDivisor(1, 1)
    gl.bindVertexArray(null)
    this.quadVao = gl.createVertexArray()!
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl!
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texStorage2D(gl.TEXTURE_2D, 1, this.halfFloat ? gl.R16F : gl.RGBA8, w, h)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { fbo, tex, w, h }
  }

  private dropTarget(t: Target | null): void {
    if (!t || !this.gl) return
    this.gl.deleteFramebuffer(t.fbo)
    this.gl.deleteTexture(t.tex)
  }

  resize(w: number, h: number): void {
    if (!this.gl || (w === this.w && h === this.h) || w === 0 || h === 0) return
    this.w = w
    this.h = h
    this.gl.canvas.width = w
    this.gl.canvas.height = h
    this.dropTarget(this.acc)
    this.dropTarget(this.bloomA)
    this.dropTarget(this.bloomB)
    this.acc = this.makeTarget(w, h)
    const hw = Math.max(1, w >> 1)
    const hh = Math.max(1, h >> 1)
    this.bloomA = this.makeTarget(hw, hh)
    this.bloomB = this.makeTarget(hw, hh)
  }

  /**
   * Draw one frame. `segs` is the interleaved segment buffer (SEG_STRIDE floats
   * each, coordinates in device px, y up), `count` how many are valid.
   */
  render(segs: Float32Array, count: number, opts: { gain: number; tint: [number, number, number]; sigma: number }): void {
    const gl = this.gl
    if (!gl || !this.acc || this.w === 0) return

    // Pass 1: additive beam accumulation.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.acc.fbo)
    gl.viewport(0, 0, this.acc.w, this.acc.h)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (count > 0) {
      gl.useProgram(this.progSeg)
      gl.bindVertexArray(this.segVao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf)
      gl.bufferData(gl.ARRAY_BUFFER, segs.subarray(0, count * SEG_STRIDE), gl.DYNAMIC_DRAW)
      gl.uniform2f(gl.getUniformLocation(this.progSeg, 'uRes'), this.w, this.h)
      gl.uniform1f(gl.getUniformLocation(this.progSeg, 'uRad'), opts.sigma * 7)
      gl.uniform1f(gl.getUniformLocation(this.progSeg, 'uSigma'), opts.sigma)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
      gl.disable(gl.BLEND)
      gl.bindVertexArray(null)
    }

    // Pass 2+3: separable half-res blur for the bloom term.
    gl.useProgram(this.progBlur)
    gl.bindVertexArray(this.quadVao)
    const texLoc = gl.getUniformLocation(this.progBlur, 'uTex')
    const dirLoc = gl.getUniformLocation(this.progBlur, 'uDir')
    gl.uniform1i(texLoc, 0)
    gl.activeTexture(gl.TEXTURE0)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA!.fbo)
    gl.viewport(0, 0, this.bloomA!.w, this.bloomA!.h)
    gl.bindTexture(gl.TEXTURE_2D, this.acc.tex)
    gl.uniform2f(dirLoc, 1 / this.bloomA!.w, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB!.fbo)
    gl.viewport(0, 0, this.bloomB!.w, this.bloomB!.h)
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA!.tex)
    gl.uniform2f(dirLoc, 0, 1 / this.bloomB!.h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    // Pass 4: tonemap + palette + graticule to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.w, this.h)
    gl.useProgram(this.progComp)
    gl.uniform1i(gl.getUniformLocation(this.progComp, 'uAcc'), 0)
    gl.uniform1i(gl.getUniformLocation(this.progComp, 'uBloom'), 1)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.acc.tex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.bloomB!.tex)
    gl.uniform3fv(gl.getUniformLocation(this.progComp, 'uTint'), opts.tint)
    gl.uniform1f(gl.getUniformLocation(this.progComp, 'uGain'), opts.gain)
    gl.uniform2f(gl.getUniformLocation(this.progComp, 'uRes'), this.w, this.h)
    gl.uniform2f(gl.getUniformLocation(this.progComp, 'uGrid'), 10, 8)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    const gl = this.gl
    if (!gl) return
    this.dropTarget(this.acc)
    this.dropTarget(this.bloomA)
    this.dropTarget(this.bloomB)
    gl.deleteBuffer(this.segBuf)
    gl.deleteVertexArray(this.segVao)
    gl.deleteVertexArray(this.quadVao)
    gl.deleteProgram(this.progSeg)
    gl.deleteProgram(this.progBlur)
    gl.deleteProgram(this.progComp)
    this.gl = null
  }
}
