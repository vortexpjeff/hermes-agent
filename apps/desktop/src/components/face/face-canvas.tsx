import { memo, useEffect, useRef } from 'react'

// ── Face Parameters (PyLips FacePresets format) ─────────────────
export interface FaceParams {
  background_color: string
  eyeball_color: string
  iris_color: string
  eye_size: number
  eye_height: number
  eye_separation: number
  iris_size: number
  pupil_scale: number
  eye_shine: boolean
  eyelid_color: string
  nose_color: string
  nose_vertical_position: number
  nose_width: number
  nose_height: number
  mouth_color: string
  mouth_width: number
  mouth_height: number
  mouth_thickness: number
  mouth_y: number
  brow_color: string
  brow_width: number
  brow_height: number
  brow_thickness: number
}

// Virtual canvas dimensions for face math (PyLips params expect ~fullscreen)
const VW_VIRTUAL = 800
const VH_VIRTUAL = 600

// ── Default Solaris face ────────────────────────────────────────
export const SOLARIS_FACE: FaceParams = {
  background_color: '#062C2C',
  eyeball_color: '#D7F2E7',
  iris_color: '#1F7A3D',
  eye_size: 164,
  eye_height: 84,
  eye_separation: 400,
  iris_size: 92,
  pupil_scale: 0.56,
  eye_shine: true,
  eyelid_color: '#062C2C',
  nose_color: '#062C2C00',
  nose_vertical_position: 0,
  nose_width: 0,
  nose_height: 0,
  mouth_color: '#B8D6C4',
  mouth_width: 360,
  mouth_height: 22,
  mouth_thickness: 16,
  mouth_y: 50,
  brow_color: '#B8D6C4',
  brow_width: 140,
  brow_height: 210,
  brow_thickness: 16,
}

// ── AU state (27 AUs + gaze, bilateral L/R) ─────────────────────
interface AuState {
  [key: string]: number
}

function createDefaultAuState(): AuState {
  const s: AuState = {}
  for (let i = 1; i <= 27; i++) {
    s[`AU${i}L`] = 0
    s[`AU${i}R`] = 0
  }
  s['AU43L'] = 0
  s['AU43R'] = 0
  s['lookAtX'] = 0
  s['lookAtY'] = 0
  s['lookAtZ'] = 2000
  return s
}

// ── Active interpolation goals ──────────────────────────────────
interface InterpGoal {
  initialValue: number
  targetValue: number
  duration: number
  startTime: number
}

// ── Easing ──────────────────────────────────────────────────────
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// ── Spline interpolation (from PyLips canvasFace.js) ────────────
function getControlPoints(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number, tension = 0.33
) {
  const a1 = Math.atan2(ay - by, ax - bx)
  const a2 = Math.atan2(cy - by, cx - bx)
  let d1 = Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)
  let d2 = Math.sqrt((cx - bx) ** 2 + (cy - by) ** 2)
  let mid = (a1 + a2) / 2

  if (d1 < 0.0001 || d2 < 0.0001) {
    return { leftx: 0, lefty: 0, rightx: 0, righty: 0 }
  }

  d1 *= tension
  d2 *= tension

  if (a2 < a1) mid += Math.PI / 2
  else mid -= Math.PI / 2

  const leftx = Math.cos(mid) * d1
  const lefty = Math.sin(mid) * d1
  mid -= Math.PI
  const rightx = Math.cos(mid) * d2
  const righty = Math.sin(mid) * d2

  return { leftx, lefty, rightx, righty }
}

function interpolateSpline(
  ctx: CanvasRenderingContext2D,
  points: number[],
  thickness: number,
  color: string
) {
  ctx.strokeStyle = color
  ctx.lineWidth = thickness
  ctx.lineCap = 'round'
  ctx.beginPath()

  const numPoints = points.length / 2
  let prevrightx = 0, prevrighty = 0, prevx = 0, prevy = 0

  for (let i = 0; i < numPoints; i++) {
    const px = points[2 * i]
    const py = points[2 * i + 1]
    const prev_i = Math.max(i - 1, 0)
    const next_i = Math.min(i + 1, numPoints - 1)
    const ax = points[2 * prev_i]
    const ay = points[2 * prev_i + 1]
    const cx = points[2 * next_i]
    const cy = points[2 * next_i + 1]
    const cp = getControlPoints(ax, ay, px, py, cx, cy, 0.33)

    if (i === 0) {
      ctx.moveTo(px, py)
    } else {
      ctx.bezierCurveTo(prevx + prevrightx, prevy + prevrighty, px + cp.leftx, py + cp.lefty, px, py)
    }

    prevrightx = cp.rightx
    prevrighty = cp.righty
    prevx = px
    prevy = py
  }

  ctx.stroke()
}

// ── Drawing functions (ported from canvasFace.js) ────────────────

function drawEye(
  side: 'L' | 'R',
  p: FaceParams,
  fs: AuState,
  ctx: CanvasRenderingContext2D
) {
  const eyeCenter = side === 'L'
    ? { x: ctx.canvas.width / 2 - p.eye_separation / 2, y: ctx.canvas.height / 2 - p.eye_height }
    : { x: ctx.canvas.width / 2 + p.eye_separation / 2, y: ctx.canvas.height / 2 - p.eye_height }
  const { lookAtX, lookAtY, lookAtZ } = fs
  const dir = side === 'L' ? 1 : -1

  const dx = dir * (p.eye_size * (p.eye_separation / 2 + dir * lookAtX)) /
    Math.sqrt(lookAtZ ** 2 + (p.eye_separation / 2 + dir * lookAtX) ** 2)
  const dy = -(lookAtY * p.eye_size) / lookAtZ

  const dist = Math.sqrt(dx * dx + dy * dy)
  const maxDist = p.eye_size - p.iris_size
  const irisOffsetX = dist > maxDist ? (dx / dist) * maxDist : dx
  const irisOffsetY = dist > maxDist ? (dy / dist) * maxDist : dy

  // Eyeball
  ctx.fillStyle = p.eyeball_color
  ctx.beginPath()
  ctx.arc(eyeCenter.x, eyeCenter.y, p.eye_size, 0, 2 * Math.PI)
  ctx.fill()

  // Iris
  ctx.fillStyle = p.iris_color
  ctx.beginPath()
  ctx.arc(eyeCenter.x + irisOffsetX, eyeCenter.y + irisOffsetY, p.iris_size, 0, 2 * Math.PI)
  ctx.fill()

  // Pupil
  ctx.fillStyle = 'black'
  ctx.beginPath()
  ctx.arc(
    eyeCenter.x + irisOffsetX,
    eyeCenter.y + irisOffsetY,
    p.iris_size * p.pupil_scale,
    0, 2 * Math.PI
  )
  ctx.fill()

  // Eye shine
  if (p.eye_shine) {
    ctx.fillStyle = 'white'
    ctx.beginPath()
    ctx.arc(
      eyeCenter.x + irisOffsetX - (p.iris_size * p.pupil_scale) / 2,
      eyeCenter.y + irisOffsetY - (p.iris_size * p.pupil_scale) / 1.6,
      p.iris_size * p.pupil_scale / 3,
      0, 2 * Math.PI
    )
    ctx.fill()
  }
}

function drawLids(
  side: 'L' | 'R',
  p: FaceParams,
  fs: AuState,
  ctx: CanvasRenderingContext2D
) {
  const eyeCenter = side === 'L'
    ? { x: ctx.canvas.width / 2 - p.eye_separation / 2, y: ctx.canvas.height / 2 - p.eye_height }
    : { x: ctx.canvas.width / 2 + p.eye_separation / 2, y: ctx.canvas.height / 2 - p.eye_height }
  const cx = eyeCenter.x
  const cy = eyeCenter.y
  const AU5 = fs[`AU5${side}`]
  const AU7 = fs[`AU7${side}`]
  const AU43 = fs[`AU43${side}`]

  // Upper eyelid
  const cy_upper = cy - 0.15 * p.eye_size * AU5 + 0.8 * p.eye_size * AU43
  ctx.fillStyle = p.eyelid_color || p.background_color
  ctx.beginPath()
  ctx.moveTo(cx - p.eye_size, cy_upper)
  ctx.quadraticCurveTo(cx - p.eye_size * 0.75, cy_upper - p.eye_size * 0.5, cx, cy_upper - p.eye_size * 0.5)
  ctx.quadraticCurveTo(cx + p.eye_size * 0.75, cy_upper - p.eye_size * 0.5, cx + p.eye_size, cy_upper)
  ctx.lineTo(cx + p.eye_size, cy_upper - 2.5 * p.eye_size)
  ctx.lineTo(cx - p.eye_size, cy_upper - 2.5 * p.eye_size)
  ctx.closePath()
  ctx.fill()

  // Lower eyelid
  const cy_lower = cy - 0.2 * p.eye_size * AU7 - 0.8 * p.eye_size * AU43
  ctx.fillStyle = p.eyelid_color || p.background_color
  ctx.beginPath()
  ctx.moveTo(cx - p.eye_size, cy_lower)
  ctx.quadraticCurveTo(cx - p.eye_size * 0.75, cy_lower + p.eye_size * 0.5, cx, cy_lower + p.eye_size * 0.5)
  ctx.quadraticCurveTo(cx + p.eye_size * 0.75, cy_lower + p.eye_size * 0.5, cx + p.eye_size, cy_lower)
  ctx.lineTo(cx + p.eye_size, cy_lower + 2.5 * p.eye_size)
  ctx.lineTo(cx - p.eye_size, cy_lower + 2.5 * p.eye_size)
  ctx.closePath()
  ctx.fill()

  // Corner rectangles
  const rectWidth = p.eye_size / 10
  const rectHeight = p.eye_size
  ctx.fillRect(cx - p.eye_size, cy_lower - p.eye_size / 2, rectWidth, rectHeight)
  ctx.fillRect(cx + p.eye_size - rectWidth, cy_lower - p.eye_size / 2, rectWidth, rectHeight)
}

function drawBrows(
  side: 'L' | 'R',
  p: FaceParams,
  fs: AuState,
  ctx: CanvasRenderingContext2D
) {
  const dir = side === 'L' ? -1 : 1
  const cx = ctx.canvas.width / 2 + dir * p.eye_separation / 2
  const cy = ctx.canvas.height / 2 - p.brow_height

  let points = [
    cx - dir * p.brow_width, cy + 0.7 * p.brow_thickness,
    cx - dir * p.brow_width / 8, cy,
    cx + dir * p.brow_width, cy + 1.2 * p.brow_thickness,
  ]

  const AU1 = fs[`AU1${side}`]
  const AU2 = fs[`AU2${side}`]
  const AU4 = fs[`AU4${side}`]

  // inner
  points[0] -= 0.05 * p.eye_separation * dir * (AU1 + 1.3 * AU4)
  points[1] -= 2 * p.brow_thickness * (AU1 - 0.7 * AU4)
  // middle
  points[2] -= 0.05 * p.eye_separation * dir * (-0.7 * AU2 + 1 * AU4)
  points[3] -= 2 * p.brow_thickness * (0.05 * AU1 + 0.7 * AU2 - 0.4 * AU4)
  // outer
  points[4] -= 0.05 * p.eye_separation * dir * (-0.7 * AU2)
  points[5] -= 2 * p.brow_thickness * (0.6 * AU2)

  interpolateSpline(ctx, points, p.brow_thickness, p.brow_color)
}

function drawNose(
  p: FaceParams,
  fs: AuState,
  ctx: CanvasRenderingContext2D
) {
  if (p.nose_width <= 0) return
  const cx = ctx.canvas.width / 2
  const cy = ctx.canvas.height / 2 + p.nose_vertical_position

  ctx.fillStyle = p.nose_color
  ctx.beginPath()
  ctx.moveTo(cx - p.nose_width / 2, cy - fs.AU9L * p.nose_height / 4)
  ctx.lineTo(cx + p.nose_width / 2, cy - fs.AU9R * p.nose_height / 4)
  ctx.lineTo(cx, cy - p.nose_height - 0.5 * (fs.AU9L + fs.AU9R) * p.nose_height / 8)
  ctx.closePath()
  ctx.fill()
}

function drawMouth(
  p: FaceParams,
  fs: AuState,
  ctx: CanvasRenderingContext2D
) {
  const cx = ctx.canvas.width / 2
  const cy = ctx.canvas.height / 2 + p.mouth_y

  const max_up_dist = p.mouth_height * 2.25
  const max_down_dist = p.mouth_height * 2.25
  const max_x_variation = p.mouth_width / 4

  let upperLipPoints = [
    cx - p.mouth_width / 2, cy,
    cx - p.mouth_width / 6, cy + p.mouth_height,
    cx + p.mouth_width / 6, cy + p.mouth_height,
    cx + p.mouth_width / 2, cy,
  ]

  let lowerLipPoints = [
    cx - p.mouth_width / 2, cy,
    cx - p.mouth_width / 6, cy + p.mouth_height,
    cx + p.mouth_width / 6, cy + p.mouth_height,
    cx + p.mouth_width / 2, cy,
  ]

  // Left corner adjustments
  const lcorner_x = max_x_variation * (
    -0.2 * fs.AU12L - 0.05 * fs.AU13L - 0.25 * fs.AU14L +
    0.1 * fs.AU26L + 0.3 * fs.AU27L - 0.35 * fs.AU17L +
    0.75 * fs.AU18L - 0.25 * fs.AU20L + 0.2 * fs.AU23L + 0.1 * fs.AU24L
  ) / 1.1
  const lcorner_y = max_down_dist * (
    0.2 * fs.AU25L + 0.2 * fs.AU26L - 0.7 * fs.AU13L +
    1.5 * fs.AU15L + 0.5 * fs.AU27L + 0.2 * fs.AU20L +
    0.3 * fs.AU23L + 0.5 * fs.AU24L
  ) / 3.4

  // Right corner adjustments
  const rcorner_x = -max_x_variation * (
    -0.2 * fs.AU12R - 0.05 * fs.AU13R - 0.25 * fs.AU14R +
    0.1 * fs.AU26R + 0.3 * fs.AU27R - 0.35 * fs.AU17R +
    0.75 * fs.AU18R - 0.25 * fs.AU20R + 0.2 * fs.AU23R + 0.1 * fs.AU24R
  ) / 1.1
  const rcorner_y = max_down_dist * (
    0.2 * fs.AU25R + 0.2 * fs.AU26R - 0.7 * fs.AU13R +
    1.5 * fs.AU15R + 0.5 * fs.AU27R + 0.2 * fs.AU20R +
    0.3 * fs.AU23R + 0.5 * fs.AU24R
  ) / 3.4

  upperLipPoints[0] += lcorner_x; upperLipPoints[1] += lcorner_y
  upperLipPoints[6] += rcorner_x; upperLipPoints[7] += rcorner_y
  lowerLipPoints[0] += lcorner_x; lowerLipPoints[1] += lcorner_y
  lowerLipPoints[6] += rcorner_x; lowerLipPoints[7] += rcorner_y

  // Control points adjustments (upper lip)
  upperLipPoints[2] += max_x_variation * (0.25 * fs.AU10L - 0.25 * fs.AU14L + 0.3 * fs.AU18L - 0.25 * fs.AU20L + 0.05 * fs.AU23L) / 1.05
  upperLipPoints[3] += max_up_dist * (-0.1 * fs.AU25L - 0.3 * fs.AU26L - 0.6 * fs.AU27L - 0.55 * fs.AU10L - 0.35 * fs.AU17L) / 2.2
  upperLipPoints[4] -= max_x_variation * (0.25 * fs.AU10R - 0.25 * fs.AU14R + 0.3 * fs.AU18R - 0.25 * fs.AU20R + 0.05 * fs.AU23R) / 1.05
  upperLipPoints[5] += max_up_dist * (-0.1 * fs.AU25R - 0.3 * fs.AU26R - 0.6 * fs.AU27R - 0.55 * fs.AU10R - 0.35 * fs.AU17R) / 2.2

  // Control points adjustments (lower lip)
  lowerLipPoints[2] += max_x_variation * (-0.25 * fs.AU14L - 0.5 * fs.AU16L - 0.2 * fs.AU26L + 0.3 * fs.AU18L - 0.25 * fs.AU20L + 0.15 * fs.AU23L) / 1.05
  lowerLipPoints[3] += max_down_dist * (0.4 * fs.AU25L + 0.7 * fs.AU26L + 1.6 * fs.AU27L - 0.55 * fs.AU10L + 0.2 * fs.AU16L - 0.45 * fs.AU17L) / 2.2
  lowerLipPoints[4] -= max_x_variation * (-0.25 * fs.AU14R - 0.5 * fs.AU16R - 0.2 * fs.AU26R + 0.3 * fs.AU18R - 0.25 * fs.AU20R + 0.15 * fs.AU23R) / 1.05
  lowerLipPoints[5] += max_down_dist * (0.4 * fs.AU25R + 0.7 * fs.AU26R + 1.6 * fs.AU27R - 0.55 * fs.AU10R + 0.2 * fs.AU16R - 0.45 * fs.AU17R) / 2.2

  interpolateSpline(ctx, upperLipPoints, p.mouth_thickness, p.mouth_color)
  interpolateSpline(ctx, lowerLipPoints, p.mouth_thickness, p.mouth_color)
}

function drawFace(
  p: FaceParams,
  fs: AuState,
  canvas: HTMLCanvasElement
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Clear with background
  ctx.fillStyle = p.background_color
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  drawEye('L', p, fs, ctx)
  drawEye('R', p, fs, ctx)
  drawLids('L', p, fs, ctx)
  drawLids('R', p, fs, ctx)
  drawBrows('L', p, fs, ctx)
  drawBrows('R', p, fs, ctx)
  drawNose(p, fs, ctx)
  drawMouth(p, fs, ctx)

}

// ── Viseme → AU mapping (from canvasFace.js viseme()) ───────────
function applyViseme(
  visemeName: string,
  t: number,
  activeGoals: Record<string, InterpGoal>,
  faceState: AuState
) {
  const au = (number: number, degree: number, side: string, time: number) => {
    if (side !== 'r' && side !== 'R') {
      setGoal(activeGoals, `AU${number}L`, degree, time, faceState[`AU${number}L`] || 0)
    }
    if (side !== 'l' && side !== 'L') {
      setGoal(activeGoals, `AU${number}R`, degree, time, faceState[`AU${number}R`] || 0)
    }
  }

  const zero_aus = (aus: number[], t: number) => {
    for (let i = 0; i < aus.length; i++) {
      setGoal(activeGoals, `AU${aus[i]}L`, 0, t, faceState[`AU${aus[i]}L`] || 0)
      setGoal(activeGoals, `AU${aus[i]}R`, 0, t, faceState[`AU${aus[i]}R`] || 0)
    }
  }

  switch (visemeName) {
    case 'BILABIAL':
      zero_aus([10, 13, 16, 18, 20, 25, 26, 27], t)
      au(23, 0.75, 'b', t); au(14, 0.25, 'b', t); au(24, 0.7, 'b', t)
      break
    case 'LABIODENTAL':
      zero_aus([10, 13, 14, 16, 18, 20, 23, 24, 25, 26, 27], t)
      au(10, 0.5, 'b', t); au(20, 0.4, 'b', t); au(25, 0.8, 'b', t)
      break
    case 'INTERDENTAL':
      zero_aus([10, 13, 14, 16, 18, 20, 23, 24, 25, 26, 27], t)
      au(10, 0.6, 'b', t); au(18, 0.75, 'b', t); au(25, 0.5, 'b', t)
      break
    case 'DENTAL_ALVEOLAR':
      zero_aus([10, 13, 14, 16, 18, 20, 23, 24, 25, 26, 27], t)
      au(25, 0.65, 'b', t)
      break
    case 'POSTALVEOLAR':
      zero_aus([10, 13, 14, 16, 18, 20, 23, 24, 25, 26, 27], t)
      au(10, 0.75, 'b', t); au(18, 1, 'b', t); au(25, 1, 'b', t)
      break
    case 'VELAR_GLOTTAL':
      zero_aus([10, 13, 14, 16, 18, 20, 23, 24, 25, 26, 27], t)
      au(10, 0.6, 'b', t); au(26, 0.5, 'b', t)
      break
    case 'CLOSE_FRONT_VOWEL':
      zero_aus([13, 14, 16, 18, 23, 24, 25, 27], t)
      au(26, 1, 'b', t); au(20, 1, 'b', t); au(10, 0.4, 'b', t)
      break
    case 'OPEN_FRONT_VOWEL':
      zero_aus([10, 13, 14, 16, 18, 20, 23, 24, 25, 26, 27], t)
      au(14, 1, 'b', t); au(20, 1, 'b', t); au(25, 0.7, 'b', t); au(26, 0.75, 'b', t)
      break
    case 'MID_CENTRAL_VOWEL':
      zero_aus([10, 13, 14, 16, 18, 20, 23, 24, 25, 26, 27], t)
      au(26, 1, 'b', t); au(25, 0.5, 'b', t); au(23, 1, 'b', t)
      break
    case 'CLOSE_BACK_VOWEL':
      zero_aus([10, 13, 14, 16, 18, 20, 23, 24, 25, 26, 27], t)
      au(10, 0.5, 'b', t); au(13, 0.8, 'b', t); au(16, 0.6, 'b', t)
      au(18, 1, 'b', t); au(23, 1, 'b', t); au(24, 1, 'b', t)
      au(25, 1, 'b', t); au(26, 0.4, 'b', t)
      break
    case 'OPEN_BACK_VOWEL':
      zero_aus([10, 13, 14, 16, 18, 20, 23, 24, 25, 26, 27], t)
      au(26, 0.5, 'b', t); au(27, 1, 'b', t)
      break
    case 'IDLE':
      zero_aus([10, 13, 14, 16, 18, 20, 23, 24, 25, 26, 27], t)
      break
  }
}

function setGoal(
  activeGoals: Record<string, InterpGoal>,
  key: string,
  targetValue: number,
  duration: number,
  currentValue?: number
) {
  activeGoals[key] = {
    initialValue: currentValue ?? 0,
    targetValue,
    duration,
    startTime: performance.now(),
  }
}

// ── FaceCanvas Component ────────────────────────────────────────

interface FaceCanvasProps {
  params: FaceParams
  /** Width in pixels */
  width: number
  /** Height in pixels */
  height: number
  /** Called when the canvas mounts — gives parent access to the imperative API */
  onReady?: (api: FaceCanvasAPI) => void
}

export interface FaceCanvasAPI {
  /** Express AUs — same as PyLips express() */
  express(aus: Record<string, number>, timeMs: number): void
  /** Play visemes — same as PyLips say */
  playVisemes(visemes: string[], times: number[]): void
  /** Look at a 3D point */
  look(x: number, y: number, z: number, timeMs: number): void
  /** Release gaze to idle */
  releaseGaze(): void
  /** Update face appearance params */
  updateFace(newParams: Partial<FaceParams>): void
  /** Stop speech */
  stopSpeech(): void
}

function FaceCanvasImpl({ params, width, height, onReady }: FaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const paramsRef = useRef<FaceParams>(params)
  const faceStateRef = useRef<AuState>(createDefaultAuState())
  const activeGoalsRef = useRef<Record<string, InterpGoal>>({})
  const lookingRef = useRef(false)
  const visemeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // Update params when prop changes
  useEffect(() => {
    paramsRef.current = { ...paramsRef.current, ...params }
  }, [params])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Set canvas PIXEL dimensions to the virtual 800×600 so all PyLips
    // face params (eye_separation=400, eye_size=164, etc.) render correctly.
    // CSS scales the canvas DISPLAY down to the widget size — no context scaling needed.
    canvas.width = VW_VIRTUAL
    canvas.height = VH_VIRTUAL
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    // Animation loop
    let raf = 0

    const update = () => {
      const now = performance.now()
      const goals = activeGoalsRef.current
      const fs = faceStateRef.current

      // Interpolate active goals — clean lerp from initial to target
      for (const [key, goal] of Object.entries(goals)) {
        const elapsed = now - goal.startTime
        const t = Math.min(1, elapsed / Math.max(1, goal.duration))
        const eased = easeInOutCubic(t)
        fs[key] = goal.initialValue + (goal.targetValue - goal.initialValue) * eased
        if (t >= 1) {
          fs[key] = goal.targetValue  // snap to exact target
          delete goals[key]
        }
      }

      // Idle gaze wander
      if (!lookingRef.current) {
        const t = now * 0.0005
        const targetX = Math.sin(t * 0.7) * 200
        const targetY = Math.sin(t * 0.5 + 1) * 100
        fs.lookAtX += (targetX - fs.lookAtX) * 0.02
        fs.lookAtY += (targetY - fs.lookAtY) * 0.02
      }

      // Idle blink
      // (simplified — real blink would need timer)

      drawFace(paramsRef.current, fs, canvas)
      raf = requestAnimationFrame(update)
    }

    raf = requestAnimationFrame(update)

    // Build the imperative API
    const api: FaceCanvasAPI = {
      express(aus: Record<string, number>, timeMs: number) {
        for (const [auCmd, degree] of Object.entries(aus)) {
          const auNumber = parseInt(auCmd.slice(2))
          const side = auCmd.slice(-1)
          const key = `AU${auNumber}${side.toUpperCase()}`
          const keyL = `AU${auNumber}L`
          const keyR = `AU${auNumber}R`

          if (side === 'l' || side === 'L') {
            activeGoalsRef.current[keyL] = {
              initialValue: faceStateRef.current[keyL] || 0,
              targetValue: degree,
              duration: timeMs,
              startTime: performance.now(),
            }
          } else if (side === 'r' || side === 'R') {
            activeGoalsRef.current[keyR] = {
              initialValue: faceStateRef.current[keyR] || 0,
              targetValue: degree,
              duration: timeMs,
              startTime: performance.now(),
            }
          } else {
            // both sides
            activeGoalsRef.current[keyL] = {
              initialValue: faceStateRef.current[keyL] || 0,
              targetValue: degree,
              duration: timeMs,
              startTime: performance.now(),
            }
            activeGoalsRef.current[keyR] = {
              initialValue: faceStateRef.current[keyR] || 0,
              targetValue: degree,
              duration: timeMs,
              startTime: performance.now(),
            }
          }
        }
      },

      playVisemes(visemes: string[], times: number[]) {
        // Clear previous timers
        visemeTimersRef.current.forEach(t => clearTimeout(t))
        visemeTimersRef.current = []

        const transitionMs = 55

        // Ensure arrays
        const vis = Array.isArray(visemes) ? visemes : []
        const tms = Array.isArray(times) ? times : []

        vis.forEach((visemeName, i) => {
          const startMs = parseFloat(String(tms[i] || 0)) * 1000
          const tid = setTimeout(() => {
            applyViseme(visemeName, transitionMs, activeGoalsRef.current, faceStateRef.current)
          }, Math.max(0, startMs - transitionMs))
          visemeTimersRef.current.push(tid)
        })

        // Schedule final mouth reset after the last viseme
        const lastTime = parseFloat(String(tms[tms.length - 1] || 0)) * 1000
        const finalTid = setTimeout(() => {
          const mouthAus = [10, 13, 14, 16, 18, 20, 23, 24, 25, 26, 27]
          const now = performance.now()
          mouthAus.forEach(n => {
            activeGoalsRef.current[`AU${n}L`] = {
              initialValue: faceStateRef.current[`AU${n}L`] || 0,
              targetValue: 0,
              duration: 120,
              startTime: now,
            }
            activeGoalsRef.current[`AU${n}R`] = {
              initialValue: faceStateRef.current[`AU${n}R`] || 0,
              targetValue: 0,
              duration: 120,
              startTime: now,
            }
          })
        }, lastTime + 200)
        visemeTimersRef.current.push(finalTid)
      },

      look(x: number, y: number, z: number, timeMs: number) {
        lookingRef.current = true
        activeGoalsRef.current['lookAtX'] = {
          initialValue: faceStateRef.current.lookAtX,
          targetValue: x,
          duration: timeMs,
          startTime: performance.now(),
        }
        activeGoalsRef.current['lookAtY'] = {
          initialValue: faceStateRef.current.lookAtY,
          targetValue: y,
          duration: timeMs,
          startTime: performance.now(),
        }
        activeGoalsRef.current['lookAtZ'] = {
          initialValue: faceStateRef.current.lookAtZ,
          targetValue: z,
          duration: timeMs,
          startTime: performance.now(),
        }
      },

      releaseGaze() {
        lookingRef.current = false
        activeGoalsRef.current['lookAtX'] = {
          initialValue: faceStateRef.current.lookAtX,
          targetValue: 0,
          duration: 1000,
          startTime: performance.now(),
        }
        activeGoalsRef.current['lookAtY'] = {
          initialValue: faceStateRef.current.lookAtY,
          targetValue: 0,
          duration: 1000,
          startTime: performance.now(),
        }
        activeGoalsRef.current['lookAtZ'] = {
          initialValue: faceStateRef.current.lookAtZ,
          targetValue: 2000,
          duration: 1000,
          startTime: performance.now(),
        }
      },

      updateFace(newParams: Partial<FaceParams>) {
        paramsRef.current = { ...paramsRef.current, ...newParams }
      },

      stopSpeech() {
        visemeTimersRef.current.forEach(t => clearTimeout(t))
        visemeTimersRef.current = []
        const mouthAus = [10, 13, 14, 16, 18, 20, 23, 24, 25, 26, 27]
        mouthAus.forEach(n => {
          activeGoalsRef.current[`AU${n}L`] = {
            initialValue: faceStateRef.current[`AU${n}L`] || 0,
            targetValue: 0,
            duration: 80,
            startTime: performance.now(),
          }
          activeGoalsRef.current[`AU${n}R`] = {
            initialValue: faceStateRef.current[`AU${n}R`] || 0,
            targetValue: 0,
            duration: 80,
            startTime: performance.now(),
          }
        })
      },
    }

    onReadyRef.current?.(api)

    return () => {
      cancelAnimationFrame(raf)
      visemeTimersRef.current.forEach(t => clearTimeout(t))
    }
  }, [width, height])

  return (
    <canvas
      aria-label="Vortex face"
      ref={canvasRef}
      style={{ display: 'block', height, width }}
    />
  )
}

export const FaceCanvas = memo(FaceCanvasImpl)