import React, { useEffect, useState } from 'react'
import { api, fmt, ymd } from './util.js'

function workingDates(p) {
  const dates = [], d = new Date(p.start + 'T12:00:00')
  while (ymd(d) <= p.end) { if (d.getDay() !== 0 && d.getDay() !== 6) dates.push(ymd(d)); d.setDate(d.getDate() + 1) }
  return dates
}
export default function LeaveDates({ T, tid, setErr, setMsg }) {
  const [saved, setSaved] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const load = async () => { try { setSaved(await api('/trackers/' + tid + '/leave-dates')); setError('') } catch (e) { setError(e.message) } }
  useEffect(() => { let alive = true; setSaved(null); setError(''); api('/trackers/' + tid + '/leave-dates').then(d => { if (alive) setSaved(d) }).catch(e => { if (alive) setError(e.message) }); return () => { alive = false } }, [tid])
  const toggle = async (p, d) => {
    if (busy) return
    const old = saved[p.id] || [], dates = old.includes(d) ? old.filter(x => x !== d) : [...old, d].sort()
    setBusy(true)
    try { const r = await api('/trackers/' + tid + '/leave-dates/' + p.id, { method: 'PUT', body: { old, dates } }); setSaved(s => ({ ...s, [p.id]: r.dates })); setErr(''); setMsg('Leave dates saved. The duration in the tracker is unchanged.') }
    catch (e) { setErr(e.message); if (e.status === 409) await load() } finally { setBusy(false) }
  }
  const rows = T.periods.filter(p => (T.info[p.id]?.leave || 0) > 0 || saved?.[p.id]?.length)
  return <section className="card leave-dates"><h2>Leave dates</h2>
    <p className="hint">Durations are entered in the Tracker. Select the corresponding dates here; each click saves the date immediately and does not change the duration. A selected date may represent a partial day.</p>
    {error ? <div role="alert" className="err">{error} <button onClick={load}>Retry</button></div> : saved === null ? <p role="status">Loading leave dates…</p> : <>
      {!rows.length ? <p>No leave entered in this interval. Save a Leave duration in the Tracker first.</p> : <div className="wrap"><table className="plain"><thead><tr><th>Week / period</th><th>Leave (days)</th><th>Corresponding dates</th></tr></thead><tbody>
        {rows.map(p => <tr key={p.id}><td>WEEK{p.iso_week} · {p.start} → {p.end}</td><td className="leave-duration">{fmt(T.info[p.id]?.leave || 0) || '0'}</td><td><div className="leave-date-choices">{workingDates(p).map(d => <button key={d} aria-label={'Leave date ' + d} aria-pressed={(saved[p.id] || []).includes(d)} disabled={busy} onClick={() => toggle(p, d)}>{d.slice(8)} / {d.slice(5, 7)}</button>)}</div>
          {!(saved[p.id] || []).length && <small className="warn">Dates to specify</small>}
          {!T.info[p.id]?.leave && <small className="warn">Saved dates retained; the Tracker duration is currently zero.</small>}
        </td></tr>)}
      </tbody></table></div>}
    </>}
  </section>
}
