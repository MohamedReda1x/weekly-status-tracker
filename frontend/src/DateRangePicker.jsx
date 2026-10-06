import React, { useEffect, useState } from 'react'

export default function DateRangePicker({ from, to, onApply }) {
  const [bounds, setBounds] = useState({ from, to })
  useEffect(() => setBounds({ from, to }), [from, to])
  const days = (Date.parse(bounds.to) - Date.parse(bounds.from)) / 86400000
  const invalid = !bounds.from || !bounds.to || !Number.isFinite(days) || days < 0 || days > 800
  return <span className="date-range">
    <label>From <input type="date" aria-label="Range from" value={bounds.from} onChange={e => setBounds({ ...bounds, from: e.target.value })} /></label>
    <label>To <input type="date" aria-label="Range to" value={bounds.to} onChange={e => setBounds({ ...bounds, to: e.target.value })} /></label>
    <button disabled={invalid} onClick={() => onApply(bounds)}>Apply range</button>
    {invalid && <small role="alert">Choose an ordered interval of at most 800 days.</small>}
  </span>
}
