import { useId } from 'react'

export interface SegmentedOption {
  id: string
  label: string
  experimental?: boolean
}

/** A compact native radio group styled as an Ember segmented control. */
export function SegmentedControl({
  value, options, disabled = false, ariaLabel, onChange,
}: {
  value: string | null
  options: SegmentedOption[]
  disabled?: boolean
  ariaLabel: string
  onChange(id: string): void
}) {
  const name = useId()
  return <fieldset className="segmented-choice" disabled={disabled} aria-label={ariaLabel}>
    <div className="segmented-choice-options">
      {options.map((option) => <label className="segmented-choice-option" key={option.id}>
        <input type="radio" name={name} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} />
        <span className="segmented-choice-label">{option.label}</span>
        {option.experimental && <span className="segmented-choice-experimental">Experimental</span>}
      </label>)}
    </div>
  </fieldset>
}
