import React from 'react'
import { fmt, mlabel } from './util.js'
export default function BL({ T, label }) {
  const ms = Object.keys(T.month_totals).sort(), sum = m => T.activities.reduce((s, a) => s + ((T.bl[a.id] || {})[m] || 0), 0), star = m => T.month_complete[m] ? '' : ' *'
  return <div className="card"><h3 style={{ marginTop: 0 }}>Monthly BL — days per activity and month</h3><small>Scope: {label} ({T.range.from} → {T.range.to}). Saved values only; archived activities are included. BL total = Monthwise for each month. * = month only partly in this scope.</small>
    <div className="wrap tall" style={{ marginTop: 8 }}><table className="plain"><tbody><tr><th>Activity</th><th>Status</th>{ms.map(m => <th key={m} style={{ textAlign: 'right' }}>BL {mlabel(m)}{star(m)}</th>)}</tr>
      {T.activities.map(a => <tr key={a.id}><td>{a.details || '(untitled)'}{a.archived ? ' (archived)' : ''}</td><td>{a.status}</td>{ms.map(m => <td key={m} style={{ textAlign: 'right' }}>{fmt((T.bl[a.id] || {})[m] || 0)}</td>)}</tr>)}
      <tr><th colSpan={2}>Total BL</th>{ms.map(m => <th key={m} data-testid={`bl-${m}`} style={{ textAlign: 'right' }}>{fmt(sum(m)) || 0}</th>)}</tr>
      <tr><th colSpan={2}>Monthwise (in days)</th>{ms.map(m => <th key={m} style={{ textAlign: 'right' }}>{fmt(T.month_totals[m]) || 0}</th>)}</tr></tbody></table></div></div>
}
