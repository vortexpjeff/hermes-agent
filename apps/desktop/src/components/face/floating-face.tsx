import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'

import {
  $faceEnabled,
  $faceScale,
  loadFacePosition,
  saveFacePosition,
  type FacePoint,
  type FacePreset,
  $facePresets,
  persistFacePresets,
} from '@/store/face'

import { FaceCanvas, SOLARIS_FACE, type FaceCanvasAPI, type FaceParams } from './face-canvas'

const FACE_BASE_W = 400
const FACE_BASE_H = 300
const CLICK_SLOP_PX = 3
const PYLIPS_URL = 'http://192.168.1.143:8000'
const BRIDGE_URL = 'http://192.168.1.143:8765'

interface DragState {
  startX: number
  startY: number
  offX: number
  offY: number
  moved: boolean
}

// Expression presets (from bridge CUSTOM_PRESETS)
const EXPRESSION_PRESETS: Record<string, Record<string, number>> = {
  happy:        { AU1: 0.15, AU2: 0.25, AU6: 0.9, AU7: 0.25, AU12: 1.8, AU25: 0.25 },
  sad:          { AU1: 1, AU4: 0.5, AU5: -1, AU15: 1.5 },
  surprise:     { AU1: 1.5, AU2: 1.6, AU5: 1, AU15: 0.5, AU26: 1 },
  angry:        { AU4: 3, AU7: 1, AU15: 3.0, AU23: 0.6, AU24: 0.3, AU17: 1.0 },
  affectionate:{ AU6: 0.7, AU12: 0.5, AU7: 0.15 },
}

export function FloatingFace() {
  const scale = $faceScale.get()
  const [enabled, setEnabled] = useState($faceEnabled.get())
  const [currentScale, setCurrentScale] = useState(scale)
  const [presets, setPresets] = useState<FacePreset[]>($facePresets.get())
  const [faceParams] = useState<FaceParams>(SOLARIS_FACE)
  const w = Math.round(FACE_BASE_W * currentScale)
  const h = Math.round(FACE_BASE_H * currentScale)
  const [position, setPosition] = useState<FacePoint>(() => loadFacePosition(w, h))
  const [menuOpen, setMenuOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [connected, setConnected] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const apiRef = useRef<FaceCanvasAPI | null>(null)
  const socketRef = useRef<Socket | null>(null)

  // Subscribe to stores
  useEffect(() => {
    const unsubEn = $faceEnabled.listen(setEnabled)
    const unsubSc = $faceScale.listen(s => {
      setCurrentScale(s)
      const nw = Math.round(FACE_BASE_W * s)
      const nh = Math.round(FACE_BASE_H * s)
      setPosition(prev => clampPoint(prev.x, prev.y, nw, nh))
    })
    const unsubPresets = $facePresets.listen((val) => setPresets([...val]))
    return () => { unsubEn(); unsubSc(); unsubPresets() }
  }, [])

  // Connect to PyLips SocketIO when enabled
  useEffect(() => {
    if (!enabled) {
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
      setConnected(false)
      return
    }

    const socket = io(PYLIPS_URL, { transports: ['websocket'] })
    socketRef.current = socket

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    socket.on('face_control', (msg: any) => {
      if (msg.name !== 'default') return
      const api = apiRef.current
      if (!api) return

      if (msg.action_type === 'say') {
        api.playVisemes(msg.visemes, msg.times)
      } else if (msg.action_type === 'express') {
        const time = msg.time || 500
        // Expand shorthand AU keys (AU1 → AU1L + AU1R)
        const expanded: Record<string, number> = {}
        for (const [key, val] of Object.entries(msg.aus)) {
          const num = key.slice(0, -1) // "AU1" from "AU1L"
          const side = key.slice(-1)
          if (side === 'L' || side === 'l') {
            expanded[`AU${key.slice(2, -1)}L`] = val as number
          } else if (side === 'R' || side === 'r') {
            expanded[`AU${key.slice(2, -1)}R`] = val as number
          } else {
            // Both sides
            expanded[`AU${key.slice(2)}L`] = val as number
            expanded[`AU${key.slice(2)}R`] = val as number
          }
        }
        api.express(expanded, time)
      } else if (msg.action_type === 'look') {
        api.look(msg.location[0], msg.location[1], msg.location[2], msg.time)
      } else if (msg.action_type === 'release_gaze') {
        api.releaseGaze()
      } else if (msg.action_type === 'update_face') {
        api.updateFace(msg.configuration)
      } else if (msg.action_type === 'stop_speech') {
        api.stopSpeech()
      }
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [enabled])

  // Resize clamp
  useEffect(() => {
    const onResize = () => setPosition(prev => clampPoint(prev.x, prev.y, w, h))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [w, h])

  // Alt+wheel scale
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.03 : 0.03
      $faceScale.set(Math.min(2.0, Math.max(0.15, currentScale + delta)))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [currentScale])

  // Click outside to close menu
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      const el = document.querySelector('[data-face-widget]')
      if (el && !el.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [menuOpen])

  // Drag handlers
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = {
      offX: e.clientX - position.x,
      offY: e.clientY - position.y,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    }
    setIsDragging(true)
  }, [position])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) > CLICK_SLOP_PX || Math.abs(dy) > CLICK_SLOP_PX) {
      d.moved = true
      setMenuOpen(false)
    }
    if (d.moved) {
      setPosition(clampPoint(e.clientX - d.offX, e.clientY - d.offY, w, h))
    }
  }, [w, h])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    setIsDragging(false)
    if (!d) return
    if (!d.moved) {
      setMenuOpen(prev => !prev)
      return
    }
    saveFacePosition(clampPoint(e.clientX - d.offX, e.clientY - d.offY, w, h))
  }, [w, h])


  if (!enabled) return null

  const pushExpression = (emo: string) => {
    const preset = EXPRESSION_PRESETS[emo]
    if (preset && apiRef.current) {
      apiRef.current.express(preset, 400)
    }
    // Also send through the bridge for the full effect (affects TTS + audio)
    void fetch(`${BRIDGE_URL}/expression`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emotion: emo, intensity: 0.7, holdMs: 2000 }),
    }).catch(() => {})
  }

  const saveCurrentPreset = () => {
    const name = prompt('Preset name?')
    if (!name) return
    const next = [...presets, { name, url: PYLIPS_URL }]
    $facePresets.set(next)
    persistFacePresets(next)
  }

  return (
    <div data-face-widget style={{ position: 'fixed', left: position.x, top: position.y, zIndex: 1000 }}>
      {/* Face canvas — draggable */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          borderRadius: 12,
          cursor: 'grab',
          height: h,
          overflow: 'hidden',
          width: w,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
      >
        <FaceCanvas
          params={faceParams}
          width={w}
          height={h}
          onReady={(api) => { apiRef.current = api }}
        />
      </div>

      {/* Connection indicator */}
      <div style={{
        position: 'absolute',
        bottom: 4,
        right: 8,
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: connected ? '#4ade80' : '#6b7280',
      }} />

      {/* Click menu */}
      {menuOpen && (
        <FaceMenu
          currentScale={currentScale}
          connected={connected}
          presets={presets}
          onExpression={pushExpression}
          onSavePreset={saveCurrentPreset}
          onHide={() => { $faceEnabled.set(false); setMenuOpen(false) }}
          onScale={(v) => $faceScale.set(v)}
        />
      )}
    </div>
  )
}

function FaceMenu(props: {
  currentScale: number
  connected: boolean
  presets: FacePreset[]
  onExpression: (emo: string) => void
  onSavePreset: () => void
  onHide: () => void
  onScale: (v: number) => void
}) {
  return (
    <div style={menuStyle}>
      <div style={{ marginBottom: 8, fontWeight: 600, color: '#fff', fontSize: 13 }}>
        Vortex Face {props.connected ? '🟢' : '⚫'}
      </div>

      <button style={btnStyle} onClick={props.onHide}>Hide Face</button>
      <button style={btnStyle} onClick={props.onSavePreset}>Save Preset</button>

      <div style={labelStyle}>Quick Expression</div>
      {Object.keys(EXPRESSION_PRESETS).map(emo => (
        <button key={emo} style={btnStyle} onClick={() => props.onExpression(emo)}>
          {emo.charAt(0).toUpperCase() + emo.slice(1)}
        </button>
      ))}

      <div style={labelStyle}>Scale: {Math.round(props.currentScale * 100)}%</div>
      <input
        max="2.0" min="0.15" step="0.05"
        type="range" value={props.currentScale}
        onChange={e => props.onScale(parseFloat(e.target.value))}
        style={{ width: '100%', marginTop: 2 }}
      />
    </div>
  )
}

function clampPoint(x: number, y: number, w: number, h: number): FacePoint {
  return {
    x: Math.min(Math.max(0, x), Math.max(0, (window.innerWidth || 800) - w)),
    y: Math.min(Math.max(0, y), Math.max(0, (window.innerHeight || 600) - h)),
  }
}

const menuStyle: React.CSSProperties = {
  background: 'rgba(20,20,30,0.95)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
  color: '#ccc',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  left: -8,
  padding: '12px 14px',
  position: 'absolute',
  top: 'calc(100% + 8px)',
  width: 200,
  zIndex: 1001,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  backdropFilter: 'blur(8px)',
}

const btnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: 6,
  color: '#ddd',
  cursor: 'pointer',
  display: 'block',
  fontSize: 11,
  marginBottom: 3,
  padding: '5px 10px',
  textAlign: 'left',
  transition: 'background 0.15s',
  width: '100%',
}

const labelStyle: React.CSSProperties = {
  color: '#888',
  fontSize: 10,
  fontWeight: 600,
  marginTop: 8,
  marginBottom: 3,
  textTransform: 'uppercase',
}