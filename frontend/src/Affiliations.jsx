import React, { useState } from 'react'
import { api } from './util.js'

export const emptyAffiliation = { trade_id: null, professional_role_id: null, client_id: null }
export function AffiliationFields({ value, onChange, catalog, disabled = false, prefix = '' }) {
  const field = (key, label, rows) => <label>{label}<select aria-label={prefix + label} disabled={disabled} value={value[key] || ''} onChange={e => onChange({ ...value, [key]: e.target.value ? +e.target.value : null, ...(key === 'trade_id' ? { professional_role_id: null } : {}) })}>
    <option value="">Not assigned</option>{rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
  return <div className="meta affiliation-fields">
    {field('trade_id', 'Trade', catalog.trades)}
    {field('professional_role_id', 'Professional role', catalog.roles.filter(r => r.trade_id === value.trade_id))}
    {field('client_id', 'Client', catalog.clients)}
  </div>
}
export function EmployeeAffiliation({ user, catalog, onSaved, setErr, setMsg }) {
  const [value, setValue] = useState({ trade_id: user.trade_id || null, professional_role_id: user.professional_role_id || null, client_id: user.client_id || null }), [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { await api('/users/' + user.id + '/affiliation', { method: 'PUT', body: value }); await onSaved(); setErr(''); setMsg('Affiliation updated for ' + user.name + '.') }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return <details><summary>Affiliation · {[user.trade_name, user.professional_role_name, user.client_name].filter(Boolean).join(' / ') || 'Not assigned'}</summary>
    <AffiliationFields value={value} onChange={setValue} catalog={catalog} disabled={busy} prefix={user.email + ' '} />
    <button disabled={busy} onClick={save}>Save affiliation</button>
  </details>
}
export function CatalogManager({ catalog, refresh, setErr, setMsg }) {
  const [kind, setKind] = useState('trade'), [name, setName] = useState(''), [trade, setTrade] = useState(''), [busy, setBusy] = useState(false)
  const add = async () => {
    setBusy(true)
    try { await api('/affiliations', { method: 'POST', body: { kind, name, trade_id: trade ? +trade : null } }); await refresh(); setName(''); setErr(''); setMsg('Added to affiliation choices.') }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return <details className="card"><summary><b>Manage trades, professional roles and clients</b></summary>
    <p className="hint">Professional roles belong to a trade. Clients are independent. Access rights stay Manager / Employee.</p>
    <div className="meta"><label>Type<select aria-label="Affiliation type" value={kind} onChange={e => setKind(e.target.value)}><option value="trade">Trade</option><option value="role">Professional role</option><option value="client">Client</option></select></label>
      {kind === 'role' && <label>Trade<select aria-label="Role trade" value={trade} onChange={e => setTrade(e.target.value)}><option value="">Choose trade</option>{catalog.trades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
      <label>Name<input aria-label="Affiliation name" maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      <button disabled={busy || !name.trim() || (kind === 'role' && !trade)} onClick={add}>Add choice</button>
    </div>
    <div className="catalog-list">{catalog.trades.map(t => <p key={t.id}><b>{t.name}:</b> {catalog.roles.filter(r => r.trade_id === t.id).map(r => r.name).join(', ') || 'No role yet'}</p>)}<p><b>Clients:</b> {catalog.clients.map(c => c.name).join(', ')}</p></div>
  </details>
}
