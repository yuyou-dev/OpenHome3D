import { useStore } from '../state/store'
import { getModel, type FurnitureInstance, type ParamSpec } from '../models/registry'
import { Checkbox, GhostButton, NumberInput, Section, Slider } from './components'

/** Param display heuristic: integer steps are counts; small ranges are meters. */
function paramDisplay(spec: ParamSpec): { unit?: string; digits: number } {
  const step = spec.step ?? 0.01
  if (step >= 1) return { digits: 0 }
  const digits = step >= 0.1 ? 1 : 2
  if (spec.max !== undefined && spec.max <= 5) return { unit: 'm', digits }
  return { digits }
}

export default function SelectionPanel() {
  const inst = useStore((s) => s.furniture.find((f) => f.id === s.selectedId))
  const def = inst ? getModel(inst.modelId) : undefined
  if (!inst || !def) return null
  // key forces a clean remount per selected instance
  return <SelectionView key={inst.id} inst={inst} isParametric={def.kind === 'parametric'} params={def.params ?? []} />
}

function SelectionView({
  inst,
  params,
  isParametric,
}: {
  inst: FurnitureInstance
  params: ParamSpec[]
  isParametric: boolean
}) {
  const setParam = useStore((s) => s.setParam)
  const setScale = useStore((s) => s.setScale)
  const resetShape = useStore((s) => s.resetShape)

  return (
    <Section title="选中 Selection">
      <div className="sel-name">{inst.label}</div>
      <div className="sel-source">{isParametric ? '内建 built-in' : '导入模型 imported model'}</div>

      {isParametric && params.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {params.map((spec) => {
            const current = inst.params[spec.key] ?? spec.default
            if (spec.kind === 'boolean') {
              return (
                <Checkbox
                  key={spec.key}
                  label={spec.label}
                  checked={current === true}
                  onChange={(v) => setParam(inst.id, spec.key, v)}
                />
              )
            }
            const { unit, digits } = paramDisplay(spec)
            return (
              <NumberInput
                key={spec.key}
                label={spec.label}
                value={typeof current === 'number' ? current : (spec.default as number)}
                min={spec.min}
                max={spec.max}
                step={spec.step}
                digits={digits}
                unit={unit}
                onCommit={(v) => setParam(inst.id, spec.key, v)}
              />
            )
          })}
          <div className="btn-row">
            <GhostButton onClick={() => resetShape(inst.id)}>重置形状 Reset shape</GhostButton>
          </div>
        </div>
      )}

      {!isParametric && (
        <div style={{ marginTop: 10 }}>
          <Slider
            label="缩放 Scale"
            value={Math.round(inst.scale * 100)}
            min={10}
            max={200}
            step={1}
            display={`${Math.round(inst.scale * 100)}%`}
            onChange={(v) => setScale(inst.id, v / 100)}
          />
        </div>
      )}
    </Section>
  )
}
