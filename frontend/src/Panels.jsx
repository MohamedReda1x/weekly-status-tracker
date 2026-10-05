import React, { useCallback, useEffect, useState } from 'react'
import { api, weekLabel } from './util.js'
import { Pager } from './ui.jsx'

const scopeText = s => s.length ? s.map(weekLabel).join(', ') : 'General comment'
const LIMIT = 25
export default function Panels({ T, tid, mgr, range, reload, setErr, setMsg }) {
  const [sub, setSub] = useState('comments')
  return <div className="card"><div className="subtabs"><button className={sub === 'comments' ? 'on' : ''} onClick={() => setSub('comments')}>Summary report (comments)</button><button className={sub === 'history' ? 'on' : ''} onClick={() => setSub('history')}>Change history</button></div>
    {sub === 'comments' ? <Comments {...{ T, tid, range, reload, setErr, setMsg }} /> : <History {...{ T, tid }} />}</div>
}

function Comments({ T, tid, range, reload, setErr, setMsg }) {
  const [data, setData] = useState({ items: [], total: 0, authors: [] }), [off, setOff] = useState(0), [f, setF] = useState({ week: '', author_id: '', q: '' }), [loading, setLoading] = useState(true)
  const [text, setText] = useState(''), [general, setGeneral] = useState(false), [weeks, setWeeks] = useState([]), [yy, setYy] = useState(new Date().getFullYear()), [ww, setWw] = useState(''), [busy, setBusy] = useState(false)
  const shown = [...new Set(T.periods.map(p => `${p.iso_year}-${p.iso_week}`))]
  const fetchPage = useCallback(async () => {
    setLoading(true); const q = new URLSearchParams({ limit: LIMIT, offset: off }); if (f.week) q.set('week', f.week); if (f.author_id) q.set('author_id', f.author_id); if (f.q) q.set('q', f.q)
    try { setData(await api(`/trackers/${tid}/comments?${q}`)) } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [tid, off, f])
  useEffect(() => { fetchPage() }, [fetchPage])
  const toggle = w => setWeeks(x => x.includes(w) ? x.filter(y => y !== w) : [...x, w])
  const add = async () => {
    if (busy || !text.trim()) return; setBusy(true)
    try { await api(`/trackers/${tid}/save`, { method: 'POST', body: { changes: [], comment: text, weeks: general ? [] : weeks, general: general || !weeks.length } }); setText(''); setWeeks([]); setGeneral(false); setMsg('Comment added.'); setErr(''); setOff(0); await fetchPage() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return <div>
    <div className="composer"><textarea aria-label="Comment only" value={text} onChange={e => setText(e.target.value)} placeholder="Add a comment (e.g. Week39 – Review in progress)" />
      <div className="weeks"><label className="radio"><input type="checkbox" aria-label="General comment" checked={general} onChange={e => setGeneral(e.target.checked)} /> General comment</label>
        {!general && <>{shown.map(w => <button key={w} type="button" className={'chip sel' + (weeks.includes(w) ? ' on' : '')} aria-pressed={weeks.includes(w)} onClick={() => toggle(w)}>{weekLabel(w.split('-').map(Number))}</button>)}
          {weeks.filter(w => !shown.includes(w)).map(w => <button key={w} type="button" className="chip sel on" onClick={() => toggle(w)}>{weekLabel(w.split('-').map(Number))} ✕</button>)}
          <span className="addweek">Other week: <input type="number" aria-label="Year" value={yy} onChange={e => setYy(e.target.value)} style={{ width: 70 }} /> <input type="number" aria-label="Week number" min="1" max="53" value={ww} onChange={e => setWw(e.target.value)} style={{ width: 56 }} placeholder="WK" />
            <button type="button" onClick={() => { const k = `${yy}-${+ww}`; if (+ww >= 1 && +ww <= 53 && !weeks.includes(k)) setWeeks([...weeks, k]); setWw('') }}>Add</button></span></>}
        <small>{general || !weeks.length ? 'Will be saved as a general comment.' : `Linked to ${weeks.length} week${weeks.length > 1 ? 's' : ''}.`}</small></div>
      <button className="p" disabled={busy || !text.trim()} onClick={add}>{busy ? 'Adding…' : 'Add comment'}</button></div>
    <div className="filters"><select aria-label="Filter week" value={f.week} onChange={e => { setOff(0); setF({ ...f, week: e.target.value }) }}><option value="">All periods</option><option value="general">General comments</option>{shown.map(w => <option key={w} value={w}>{weekLabel(w.split('-').map(Number))}</option>)}</select>
      <select aria-label="Filter author" value={f.author_id} onChange={e => { setOff(0); setF({ ...f, author_id: e.target.value }) }}><option value="">All authors</option>{data.authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <input aria-label="Search comments" placeholder="Search text…" value={f.q} onChange={e => { setOff(0); setF({ ...f, q: e.target.value }) }} /></div>
    {loading && <small role="status">Loading…</small>}
    {!loading && !data.items.length && <p className="hint">No comments {f.week || f.author_id || f.q ? 'match these filters' : 'yet. Add the first one above, or write one when you save changes'}.</p>}
    {data.items.map(c => <div className="cm" key={c.id}><b>{scopeText(c.scopes)}</b> · {c.author} · <small>{c.created.replace('T', ' ').slice(0, 16)}</small><div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div></div>)}
    <Pager total={data.total} limit={LIMIT} offset={off} onChange={setOff} /></div>
}

function History({ T, tid }) {
  const [data, setData] = useState({ items: [], total: 0, authors: [] }), [off, setOff] = useState(0), [loading, setLoading] = useState(true), [err, setErr] = useState('')
  const [f, setF] = useState({ month: '', year: '', week: '', author_id: '', activity_id: '', date_from: '', date_to: '' })
  const fetchPage = useCallback(async () => {
    setLoading(true); const q = new URLSearchParams({ limit: LIMIT, offset: off }); if (f.month) q.set('month', f.month); if (f.week && f.year) q.set('week', `${f.year}-${f.week}`)
    for (const k of ['author_id', 'activity_id', 'date_from', 'date_to']) if (f[k]) q.set(k, f[k])
    try { setData(await api(`/trackers/${tid}/history?${q}`)); setErr('') } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [tid, off, f])
  useEffect(() => { fetchPage() }, [fetchPage])
  const set = (k, v) => { setOff(0); setF(x => ({ ...x, [k]: v })) }
  return <div><div className="filters">
    <label>Month <input type="month" aria-label="History month" value={f.month} onChange={e => set('month', e.target.value)} /></label>
    <label>Week <input type="number" aria-label="History year" placeholder="Year" style={{ width: 72 }} value={f.year} onChange={e => set('year', e.target.value)} /><input type="number" aria-label="History week" placeholder="WK" style={{ width: 56 }} value={f.week} onChange={e => set('week', e.target.value)} /></label>
    <select aria-label="History author" value={f.author_id} onChange={e => set('author_id', e.target.value)}><option value="">All authors</option>{data.authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
    <select aria-label="History activity" value={f.activity_id} onChange={e => set('activity_id', e.target.value)}><option value="">All activities</option>{T.activities.map(a => <option key={a.id} value={a.id}>{a.details || `Activity #${a.id}`}</option>)}</select>
    <label>From <input type="date" aria-label="History from" value={f.date_from} onChange={e => set('date_from', e.target.value)} /></label><label>to <input type="date" aria-label="History to" value={f.date_to} onChange={e => set('date_to', e.target.value)} /></label>
    <button onClick={() => { setOff(0); setF({ month: '', year: '', week: '', author_id: '', activity_id: '', date_from: '', date_to: '' }) }}>Clear filters</button></div>
    {err && <div className="err">{err}</div>}{loading && <small role="status">Loading…</small>}
    <div className="wrap tall"><table className="plain"><tbody><tr><th>When</th><th>Who</th><th>What</th><th>Old</th><th>New</th></tr>
      {data.items.map(h => <tr key={h.id}><td>{h.at.replace('T', ' ').slice(0, 16)}</td><td>{h.author}{h.author_role === 'admin' && h.author_id !== T.owner.id ? ' (manager)' : ''}</td><td>{h.what}</td><td>{h.old}</td><td>{h.new}</td></tr>)}
      {!loading && !data.items.length && <tr><td colSpan={5}>No change recorded {Object.values(f).some(Boolean) ? 'for these filters' : 'yet'}.</td></tr>}</tbody></table></div>
    <Pager total={data.total} limit={LIMIT} offset={off} onChange={setOff} /><small className="hint">Filters by period or activity only match entries recorded since this version (older entries stay visible without filters).</small></div>
}
