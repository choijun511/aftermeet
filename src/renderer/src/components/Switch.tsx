import React from 'react'
export default function Switch({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void
}): React.JSX.Element {
  return <button type="button" className={`toggle${checked ? ' on' : ''}`} role="switch"
    aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
    <span className="knob" />
  </button>
}
