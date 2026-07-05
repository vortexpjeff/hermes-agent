/**
 * Face widget state — mirrors the pet store pattern for the Vortex/PyLips floating face.
 */
import { atom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'

const FACE_POSITION_KEY = 'hermes.desktop.face-position.v2'
const FACE_ENABLED_KEY = 'hermes.desktop.face-enabled.v1'
const FACE_SCALE_KEY = 'hermes.desktop.face-scale.v1'
const FACE_ROAM_KEY = 'hermes.desktop.face-roam.v1'
const FACE_PRESETS_KEY = 'hermes.desktop.face-presets.v1'

const DEFAULT_SCALE = 0.4
const MIN_SCALE = 0.15
const MAX_SCALE = 2.0

export interface FacePoint {
  x: number
  y: number
}

export interface FacePreset {
  name: string
  url: string
}

function clampPoint(x: number, y: number, w: number, h: number): FacePoint {
  return {
    x: Math.min(Math.max(0, x), Math.max(0, (window.innerWidth || 800) - w)),
    y: Math.min(Math.max(0, y), Math.max(0, (window.innerHeight || 600) - h)),
  }
}

export function loadFacePosition(defaultW: number, defaultH: number): FacePoint {
  try {
    const raw = storedString(FACE_POSITION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as FacePoint
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return clampPoint(parsed.x, parsed.y, defaultW, defaultH)
      }
    }
  } catch { /* fall through */ }
  return clampPoint(
    (window.innerWidth || 800) - defaultW - 24,
    24,
    defaultW,
    defaultH,
  )
}

export function saveFacePosition(pos: FacePoint): void {
  persistString(FACE_POSITION_KEY, JSON.stringify(pos))
}

export function loadFaceEnabled(): boolean {
  try {
    const stored = storedString(FACE_ENABLED_KEY)
    if (stored === 'false') return false
    return true
  } catch {
    return true
  }
}

export function persistFaceEnabled(enabled: boolean): void {
  persistString(FACE_ENABLED_KEY, String(enabled))
}

export function loadFaceScale(): number {
  try {
    const v = parseFloat(storedString(FACE_SCALE_KEY) || '')
    if (v >= MIN_SCALE && v <= MAX_SCALE) return v
  } catch { /* fall through */ }
  return DEFAULT_SCALE
}

export function persistFaceScale(scale: number): void {
  persistString(FACE_SCALE_KEY, String(Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))))
}

export function loadFaceRoam(): boolean {
  try {
    return storedString(FACE_ROAM_KEY) === 'true'
  } catch {
    return false
  }
}

export function persistFaceRoam(roam: boolean): void {
  persistString(FACE_ROAM_KEY, String(roam))
}

const DEFAULT_PRESETS: FacePreset[] = [
  { name: 'Solaris', url: 'http://192.168.1.143:8000/face' },
  { name: 'Default', url: 'http://192.168.1.143:8000/face' },
]

export function loadFacePresets(): FacePreset[] {
  try {
    const raw = storedString(FACE_PRESETS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as FacePreset[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* fall through */ }
  return DEFAULT_PRESETS
}

export function persistFacePresets(presets: readonly FacePreset[]): void {
  persistString(FACE_PRESETS_KEY, JSON.stringify(presets))
}

export const $faceEnabled = atom(loadFaceEnabled())
$faceEnabled.subscribe(persistFaceEnabled)

export const $faceScale = atom(loadFaceScale())
$faceScale.subscribe(persistFaceScale)

export const $faceRoam = atom(loadFaceRoam())
$faceRoam.subscribe(persistFaceRoam)

export const $facePresets = atom<FacePreset[]>(loadFacePresets())
$facePresets.subscribe((val) => persistFacePresets(val as FacePreset[]))