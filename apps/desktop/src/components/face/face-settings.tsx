import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { $faceEnabled, $faceScale } from '@/store/face'

export function FaceSettings() {
  const enabled = useStore($faceEnabled)
  const scale = useStore($faceScale)

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', color: 'hsl(var(--muted-foreground))' }}>
        Floating Face
      </div>

      <Row label="Show vortex face">
        <Button onClick={() => $faceEnabled.set(!enabled)} size="sm" variant={enabled ? 'default' : 'outline'}>
          {enabled ? 'On' : 'Off'}
        </Button>
      </Row>

      {enabled && (
        <>
          <Row label={`Size (${Math.round(scale * 100)}%)`}>
            <input
              max="1.0" min="0.15" step="0.05"
              type="range" value={scale}
              onChange={e => $faceScale.set(parseFloat(e.target.value))}
              style={{ width: 120 }}
            />
          </Row>

          <Row label="Open face editor">
            <Button
              onClick={() => window.open('http://192.168.1.143:8000/editor', '_blank')}
              size="sm" variant="outline"
            >
              Editor
            </Button>
          </Row>
        </>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      {children}
    </div>
  )
}