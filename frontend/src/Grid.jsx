import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, fmt, pm, mlabel, ymd } from './util.js'

function GridIcon({ name }) {
  const paths = {
    undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 6 6',
    redo: 'm15 5 5 5-5 5m5-5h-9a6 6 0 0 0-6 6',
    archive: 'M4 4h16v4H4zM6 8v12h12V8M10 12h4',
    restore: 'M4 4h16v4H4zM6 8v12h12V8m-3 6-3-3-3 3m3-3v6',
    delete: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7'
  }
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

function AutoText({ value, onChange, label, disabled, placeholder, cls }) {
  const r = useRef(null)
  useLayoutEffect(() => { const e = r.current; if (e) { e.style.height = 'auto'; e.style.height = Math.min(e.scrollHeight, 160) + 'px' } }, [value])
  return <textarea ref={r} rows={1} aria-label={label} className={cls} value={value} placeholder={placeholder} disabled={disabled} onChange={e => onChange(e.target.value)} />
}

export default function Grid({ T, pending, conf, edit, mgr, colTotal, setErr, setMsg, sel, loading, reload, dropPending, editBatch, endEdit, undo, redo, canUndo, canRedo, historyDisabled }) {
  const t = T.tracker, P = T.periods, G = []
  P.forEach(p => { const g = G[G.length - 1]; if (g && g.k === p.month_key) g.n++; else G.push({ k: p.month_key, n: 1 }) })
  const [meta, setMeta] = useState({ work_package: t.work_package, start_date: t.start_date, end_date: t.end_date || '' }), [busy, setBusy] = useState(false)
  useEffect(() => setMeta({ work_package: t.work_package, start_date: t.start_date, end_date: t.end_date || '' }), [t.id, t.work_package, t.start_date, t.end_date])
  const wrapRef = useRef(null), iso = ymd(new Date())
  useEffect(() => { const w = wrapRef.current, th = w && w.querySelector('th.cur'); if (th) w.scrollLeft = Math.max(0, th.offsetLeft - 420) }, [t.id, T.range.from])
  const run = async fn => { if (busy) return; setBusy(true); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const nav = (e, ri, ci) => {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
    let next
    if (e.key === 'Tab') {
      const cells = [...wrapRef.current.querySelectorAll('input[data-r]:not(:disabled)')]
      next = cells[cells.indexOf(e.currentTarget) + (e.shiftKey ? -1 : 1)]
      if (!next) return // Allow Tab to leave the grid at its boundaries.
    } else {
      const step = e.key === 'Enter' ? (e.shiftKey ? -1 : 1) : { ArrowDown: 1, ArrowUp: -1 }[e.key]
      if (!step) return
      for (let row = ri + step; row >= 0 && row < T.activities.length; row += step) {
        next = wrapRef.current.querySelector(`input[data-r="${row}"][data-c="${ci}"]:not(:disabled)`)
        if (next) break
      }
    }
    e.preventDefault()
    if (next) { next.focus(); next.select() }
  }
  const paste = (e, ri, ci) => {
    e.preventDefault()
    if (historyDisabled || loading || busy) return
    const tx = e.clipboardData.getData('text')
    const edits = [], invalid = []
    let ignored = 0
    tx.replace(/\r/g, '').replace(/\n$/, '').split('\n').forEach((line, dr) => line.split('\t').forEach((v, dc) => {
      const a = T.activities[ri + dr], p = P[ci + dc]
      if (!a || !p || a.archived) { ignored++; return }
      const old = (T.entries[a.id] || {})[p.id] || 0
      if (outside(p) && !old) { ignored++; return }
      const raw = v.trim(), value = pm(raw)
      if (value === null || value > 1000000) { invalid.push(`row ${dr + 1}, column ${dc + 1}`); return }
      edits.push([`c:${a.id}:${p.id}`, { type: 'cell', activity_id: a.id, period_id: p.id, pid: p.id, old, raw }])
    }))
    if (invalid.length) {
      setMsg('')
      setErr(`Paste cancelled: ${invalid.length} invalid value(s) (${invalid.slice(0, 3).join('; ')}). Use 0–1000 days, a point or comma, and at most 3 decimals. No cell was changed.`)
      return
    }
    if (edits.length) editBatch(edits)
    setErr('')
    setMsg(`Pasted ${edits.length} cell(s).${ignored ? ` ${ignored} cell(s) ignored: read-only or outside the displayed grid.` : ''}${edits.length ? ' Ctrl+Z undoes this paste.' : ''}`)
  }
  const outside = p => p.end < t.start_date || (t.end_date && p.start > t.end_date)
  const pf = (a, f) => pending[`f:${a.id}:${f}`] ? pending[`f:${a.id}:${f}`].raw : a[f]
  const onField = (a, f, v) => edit(`f:${a.id}:${f}`, { type: 'field', activity_id: a.id, field: f, old: a[f], raw: v }, a[f])
  const eff = (a, p) => pending[`c:${a}:${p}`] ? pending[`c:${a}:${p}`].raw : fmt((T.entries[a] || {})[p] || 0)
  const mtot = k => P.filter(p => p.month_key === k).reduce((s, p) => s + colTotal(p.id), 0)
  const txt = (a, f, ph) => <td className={'txt ' + (pending[`f:${a.id}:${f}`] ? 'dirty' : '')}><AutoText label={`${f}-${a.id}`} value={pf(a, f)} placeholder={ph} disabled={!!a.archived} onChange={v => onField(a, f, v)} /></td>
  const infoRow = (kind, label) => <tr className="inp"><td className="lab stl" colSpan={2}>{label}</td><td colSpan={5} />
    {P.map(p => { const k = `i:${kind}:${p.id}`, old = (T.info[p.id] || {})[kind] || 0; return <td key={p.id} className={`n info ${pending[k] ? 'dirty' : ''} ${conf[k] ? 'conf' : ''}`}><input inputMode="decimal" aria-label={`${kind}-${p.id}`} value={pending[k] ? pending[k].raw : fmt(old)} onChange={e => edit(k, { type: 'info', kind, period_id: p.id, pid: p.id, old, raw: e.target.value })} /></td> })}</tr>
  const [focusActivities, setFocusActivities] = useState(true), [showInfo, setShowInfo] = useState(false), [showTotals, setShowTotals] = useState(true)
  const infoDirty = Object.values(pending).some(q => q.type === 'info')
  const actionsLocked = busy || loading || historyDisabled
  const hasMonthPartial = Object.values(T.month_complete).some(x => !x)
  const historyKeys = e => {
    if (!e.target.closest('table') || !(e.ctrlKey || e.metaKey) || e.altKey) return
    const key = e.key.toLowerCase()
    if (key !== 'z' && key !== 'y') return
    e.preventDefault()
    if (historyDisabled || loading || busy) return
    if (key === 'y' || e.shiftKey) redo(); else undo()
  }
  return <div className={'gridtab' + (focusActivities ? ' activities-focus' : '')} onKeyDownCapture={historyKeys}>
    <div className="grid-toolbar" role="toolbar" aria-label="Grid editing">
      <div className="history-buttons">
        <button aria-label="Undo" title="Undo last unsaved grid edit (Ctrl+Z)" disabled={!canUndo || historyDisabled || loading || busy} onClick={undo}><GridIcon name="undo" /><span>Undo</span></button>
        <button aria-label="Redo" title="Redo grid edit (Ctrl+Y or Ctrl+Shift+Z)" disabled={!canRedo || historyDisabled || loading || busy} onClick={redo}><GridIcon name="redo" /><span>Redo</span></button>
      </div>
      <button className="view-toggle" aria-pressed={focusActivities} onClick={() => setFocusActivities(v => !v)} title="Hide mission details and legend to give activities more space">Focus activities</button>
      <button className="view-toggle" aria-expanded={showTotals} onClick={() => setShowTotals(v => !v)}>Totals</button>
      <button className="view-toggle" aria-expanded={showInfo || infoDirty} disabled={infoDirty} title={infoDirty ? 'Save or discard holiday edits before hiding them' : 'Show optional leave and public holiday information'} onClick={() => setShowInfo(v => !v)}>Leave / holidays</button>
      <span className="grid-help">Tab to move · Enter for next row</span>
      <span className="draft-status">{Object.keys(pending).length ? `${Object.keys(pending).length} unsaved change(s)` : 'All changes saved'}</span>
    </div>
    <details className="mission"><summary><b>Mission</b> {t.work_package || <i>no work package</i>} · start {t.start_date} · end {t.end_date || 'open (continues automatically)'} <span className="chip">Saved total: {fmt(T.bounds.all_total) || 0} days</span></summary>
      {mgr ? <div className="meta"><div><label>Work package</label><input aria-label="Work package" size={34} value={meta.work_package} onChange={e => setMeta({ ...meta, work_package: e.target.value })} /></div>
        <div><label>Mission start</label><input aria-label="Start date" type="date" value={meta.start_date} onChange={e => setMeta({ ...meta, start_date: e.target.value })} /></div>
        <div><label>Mission end (optional)</label><input aria-label="End date" type="date" value={meta.end_date} onChange={e => setMeta({ ...meta, end_date: e.target.value })} /></div>
        <div><label>&nbsp;</label><button disabled={busy} onClick={() => run(async () => { await api('/trackers/' + sel, { method: 'PUT', body: { work_package: meta.work_package, start_date: meta.start_date, end_date: meta.end_date || null } }); setMsg('Mission updated. No saved day was removed.'); setErr(''); await reload() })}>Update mission</button></div>
        <p className="hint">Mission dates do not change the period you are looking at, and never delete entries.</p></div> : <p className="hint">Dates are set by your manager.</p>}</details>
    <div className="legend"><span className="lg in">Input</span><span className="lg dirty">Changed, not saved</span><span className="lg calc">Calculated total</span><span className="lg off">Not editable</span><span className="lg b-c">Completed</span><span className="lg b-w">WIP</span></div>
    <div className={'wrap' + (loading ? ' loading' : '')} ref={wrapRef} onBlurCapture={endEdit}><table><thead>
      <tr><th className="s1" rowSpan={3}>Activity details</th><th className="s2" rowSpan={3}>Status</th><th rowSpan={3}>Affected projects</th><th rowSpan={3}>Deliverables / Functions</th><th rowSpan={3}>Estimation</th><th rowSpan={3}>Project Progress in %</th><th className="actions-heading" rowSpan={3}>Actions</th>{G.map(g => <th key={g.k} colSpan={g.n}><span className="mh">{mlabel(g.k)}</span></th>)}</tr>
      <tr>{P.map(p => <th key={p.id} className={p.start <= iso && iso <= p.end ? 'cur' : ''} title={`${p.start} → ${p.end}`}>WEEK{p.iso_week}</th>)}</tr><tr>{P.map(p => <th key={p.id}>{p.capacity} day{p.capacity > 1 ? 's' : ''}</th>)}</tr></thead>
      <tbody>{T.activities.map((a, ri) => { const st = pf(a, 'status'), rowDirty = Object.values(pending).some(q => q.activity_id === a.id); return <tr key={a.id} className={a.archived ? 'arch' : st === 'Completed' ? 'done' : 'wip'}>
        <td className={`s1 ${pending[`f:${a.id}:details`] ? 'dirty' : ''}`}><AutoText label={`details-${a.id}`} placeholder="Activity details" value={pf(a, 'details')} disabled={!!a.archived} onChange={v => onField(a, 'details', v)} /></td>
        <td className={`s2 ${pending[`f:${a.id}:status`] ? 'dirty' : ''}`}>{a.archived ? <span className="badge arch">Archived</span> : <select aria-label={`status-${a.id}`} value={st} onChange={e => onField(a, 'status', e.target.value)}><option>WIP</option><option>Completed</option></select>}</td>
        {txt(a, 'affected')}{txt(a, 'deliverables')}{txt(a, 'estimation')}<td className={`n ${pending[`f:${a.id}:progress`] ? 'dirty' : ''}`}><input aria-label={`progress-${a.id}`} style={{ width: 60 }} value={pf(a, 'progress')} disabled={!!a.archived} onChange={e => onField(a, 'progress', e.target.value)} /></td>
        <td className="action-cell"><div className="activity-actions">
          <button className="icon-action" aria-label={a.archived ? 'Restore' : 'Archive'} disabled={actionsLocked || rowDirty}
            title={rowDirty ? 'Save or discard changes to this activity first' : a.archived ? 'Restore editing for this activity' : 'Archive: stop editing, keep all saved days and totals'}
            onClick={() => run(async () => { if (!a.archived && !confirm('Archive this activity? It becomes read-only. All saved days and totals are kept. You can restore it later.')) return; await api(`/activities/${a.id}/archive`, { method: 'POST', body: { archived: !a.archived } }); setMsg(a.archived ? 'Activity restored. Editing is available again.' : 'Activity archived. Saved days and totals are kept.'); setErr(''); await reload() })}><GridIcon name={a.archived ? 'restore' : 'archive'} /></button>
          {!a.has_data && <button className="icon-action danger" aria-label="Delete" disabled={actionsLocked || rowDirty}
            title={rowDirty ? 'Save or discard changes to this activity first' : 'Delete permanently: only activities without saved days'}
            onClick={() => run(async () => { if (!confirm('Delete this empty activity permanently? This cannot be undone.')) return; await api(`/activities/${a.id}`, { method: 'DELETE' }); dropPending(a.id); setMsg('Activity deleted.'); setErr(''); await reload() })}><GridIcon name="delete" /></button>}
        </div></td>
        {P.map((p, ci) => { const k = `c:${a.id}:${p.id}`, old = (T.entries[a.id] || {})[p.id] || 0, off = a.archived || (outside(p) && !old)
          return <td key={p.id} className={`n wk ${pending[k] ? 'dirty' : ''} ${conf[k] ? 'conf' : ''} ${off ? 'off' : ''} ${outside(p) ? 'out' : ''}`}><input inputMode="decimal" data-r={ri} data-c={ci} onKeyDown={e => nav(e, ri, ci)} onPaste={e => paste(e, ri, ci)} aria-label={`days-${a.id}-${p.id}`} value={eff(a.id, p.id)} disabled={off} onChange={e => edit(k, { type: 'cell', activity_id: a.id, period_id: p.id, pid: p.id, old, raw: e.target.value })} /></td> })}</tr> })}</tbody>
      <tfoot>{(showInfo || infoDirty) && <>{infoRow('leave', 'Leave / Holidays (info only) :')}{infoRow('ph', 'PH holidays (info only) :')}</>}
        {showTotals && <><tr><td className="lab stl" colSpan={2}>Actual days spent on activity / week :</td><td colSpan={5} />
          {P.map(p => { const v = colTotal(p.id), cap = p.capacity * 1000; return <td key={p.id} data-testid={`ct-${p.id}`} className={'calc' + (v > cap ? ' over' : v === cap ? ' full' : '')}>{fmt(v) || '0'}</td> })}</tr>
        <tr><td className="lab stl" colSpan={2}>Monthwise (in days) :</td><td colSpan={5} />{G.map(g => <td key={g.k} colSpan={g.n} data-testid={`mt-${g.k}`} className="calc"><span className="mh">{fmt(mtot(g.k)) || '0'}{T.month_complete[g.k] ? '' : ' *'}</span></td>)}</tr></>}</tfoot></table></div>
    <p className="note"><button disabled={busy} onClick={() => run(async () => { await api(`/trackers/${sel}/activities`, { method: 'POST' }); await reload() })}>+ Add activity</button>
      <small> Totals cover the periods shown ({T.range.from} → {T.range.to}), all activities including archived ones.{hasMonthPartial ? ' * = month only partly shown.' : ''}</small></p>
  </div>
}

export function MobileList({ T }) {  // read-only consultation on small screens
  const ms = Object.keys(T.month_totals)
  return <div className="mobile"><p className="hint">Small screen: consultation only. Use a computer to edit.</p>
    <div className="card"><b>Totals shown</b>{ms.map(m => <div key={m} className="mrow"><span>{mlabel(m)}{T.month_complete[m] ? '' : ' *'}</span><b>{fmt(T.month_totals[m]) || 0} days</b></div>)}</div>
    {T.activities.map(a => <div key={a.id} className={'card act ' + (a.archived ? 'arch' : a.status === 'Completed' ? 'done' : 'wip')}><div><span className={'badge ' + (a.archived ? 'arch' : a.status === 'Completed' ? 'b-c' : 'b-w')}>{a.archived ? 'Archived' : a.status}</span> <b>{a.details || '(untitled)'}</b></div>
      <small>{[a.affected, a.deliverables, a.estimation && `Estimation: ${a.estimation}`, `${a.progress}%`].filter(Boolean).join(' · ')}</small>
      <div className="chips">{T.periods.filter(p => (T.entries[a.id] || {})[p.id]).map(p => <span key={p.id} className="chip">WK{p.iso_week} {mlabel(p.month_key)}: {fmt(T.entries[a.id][p.id])}</span>)}</div></div>)}</div>
}
