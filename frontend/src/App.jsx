import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { api, pm, mlabel, viewRange, shiftAnchor, viewLabel, todayAnchor, monthStart, monthEnd, isoWeek, weekLabel, ymd } from './util.js'
import { Err, Ok, PwInput } from './ui.jsx'
import Grid, { MobileList } from './Grid.jsx'
import BL from './BL.jsx'
import useDraftHistory from './useDraftHistory.js'
import Panels from './Panels.jsx'
import Accounts from './Accounts.jsx'

function AuthCard({ title, children }) { return <div className="auth"><div className="card login"><h2>{title}</h2>{children}</div></div> }
function Login({ onDone }) {
  const [em, setEm] = useState(''), [pw, setPw] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const go = async () => { if (busy) return; setBusy(true); try { await api('/login', { method: 'POST', body: { email: em, password: pw } }); onDone() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  return <AuthCard title="Weekly Process Status Report"><Err>{err}</Err>
    <label>Email<input aria-label="Email" type="email" value={em} onChange={e => setEm(e.target.value)} autoComplete="username" /></label>
    <label>Password<PwInput label="Password" value={pw} onChange={setPw} onEnter={go} autoComplete="current-password" /></label>
    <button className="p" disabled={busy} onClick={go}>{busy ? 'Signing in…' : 'Sign in'}</button> <a href="#/forgot">Forgot password?</a></AuthCard>
}
function Forgot() {
  const [em, setEm] = useState(''), [msg, setMsg] = useState('')
  return <AuthCard title="Reset password"><Ok>{msg}</Ok><label>Email<input aria-label="Email" type="email" value={em} onChange={e => setEm(e.target.value)} /></label>
    <button className="p" onClick={async () => { await api('/forgot', { method: 'POST', body: { email: em } }); setMsg('If this account exists, a reset link has been sent.') }}>Send reset link</button> <a href="#/">Back to sign in</a></AuthCard>
}
function SetPw({ tok }) {
  const [pw, setPw] = useState(''), [err, setErr] = useState(''), [done, setDone] = useState(false)
  if (done) return <AuthCard title="Password saved"><Ok>Password saved.</Ok><a href="#/">Go to sign in</a></AuthCard>
  return <AuthCard title="Choose your password"><Err>{err}</Err><label>New password (min. 8 characters)<PwInput label="New password" value={pw} onChange={setPw} /></label>
    <button className="p" onClick={async () => { try { await api('/set-password', { method: 'POST', body: { token: tok, password: pw } }); setDone(true) } catch (e) { setErr(e.message) } }}>Save password</button></AuthCard>
}
function ChangePw({ me, onDone, onOut }) {
  const [cur, setCur] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const go = async () => { if (busy) return; if (pw !== pw2) return setErr('The two new passwords are different.'); setBusy(true); try { await api('/change-password', { method: 'POST', body: { current: cur, new: pw } }); onDone() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  return <AuthCard title="Choose a new password"><p>Hello {me.name}, your administrator gave you a temporary password. Choose your own password to continue.</p><Err>{err}</Err>
    <label>Temporary password<PwInput label="Temporary password" value={cur} onChange={setCur} autoComplete="current-password" /></label>
    <label>New password (min. 8 characters)<PwInput label="New password" value={pw} onChange={setPw} /></label>
    <label>Repeat new password<PwInput label="Repeat new password" value={pw2} onChange={setPw2} onEnter={go} /></label>
    <button className="p" disabled={busy} onClick={go}>Save and continue</button> <button onClick={onOut}>Sign out</button></AuthCard>
}

export default function App() {
  const [hash, setHash] = useState(location.hash), [me, setMe] = useState(undefined)
  useEffect(() => { const f = () => setHash(location.hash); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }, [])
  const boot = async () => { try { setMe(await api('/me')) } catch { setMe(null) } }
  useEffect(() => { boot() }, [])
  if (hash.startsWith('#/set-password/')) return <SetPw tok={hash.split('/')[2]} />
  if (hash === '#/forgot') return <Forgot />
  if (me === undefined) return <div className="center">Loading…</div>
  if (!me) return <Login onDone={boot} />
  const out = async () => { await api('/logout', { method: 'POST' }); setMe(null) }
  if (me.must_change_password) return <ChangePw me={me} onDone={boot} onOut={out} />
  return <Shell me={me} onOut={out} />
}

function useNarrow() { const [n, setN] = useState(() => window.innerWidth <= 800); useEffect(() => { const f = () => setN(window.innerWidth <= 800); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, []); return n }

function Shell({ me, onOut }) {
  const mgr = me.role === 'admin', narrow = useNarrow()
  const [tab, setTab] = useState('grid'), [users, setUsers] = useState(null), [sel, setSel] = useState(mgr ? null : me.tracker_id), [T, setT] = useState(null), [loading, setLoading] = useState(true)
  const [view, setView] = useState({ mode: 'month', anchor: todayAnchor(), from: '', to: '' })
  const { pending, setPending, changePending, endGroup, undo, redo, canUndo, canRedo } = useDraftHistory()
  const [conf, setConf] = useState({}), [msg, setMsg] = useState(''), [err, setErr] = useState(''), [saving, setSaving] = useState(false), [comment, setComment] = useState('')
  const [dlg, setDlg] = useState(null), [exp, setExp] = useState(null), [loadFail, setLoadFail] = useState(null)
  const savingRef = useRef(false), dirty = Object.keys(pending).length > 0, n = Object.keys(pending).length
  const range = viewRange(view)

  const load = useCallback(async (id, v, keep = false) => {
    if (!id) { setLoading(false); return null }
    setLoading(true); setLoadFail(null); const r = viewRange(v)
    try { const d = await api(`/trackers/${id}?from=${r.from}&to=${r.to}`); setT(d); if (!keep) { setPending({}); setConf({}) } return d }
    catch (e) { if (e.status === 401) onOut(); else { setErr(e.message); setLoadFail(() => () => load(id, v, keep)) } return null }
    finally { setLoading(false) }
  }, [])
  const refreshUsers = async () => { const u = await api('/users'); setUsers(u); return u }
  useEffect(() => { (async () => { try { if (mgr) { const u = await refreshUsers(); const f = u.find(x => x.role === 'employee' && x.tracker_id); if (f) { setSel(f.tracker_id); await load(f.tracker_id, view) } else setLoading(false) } else await load(me.tracker_id, view) } catch (e) { if (e.status === 401) onOut(); else { setErr(e.message); setLoading(false) } } })() }, [])
  useEffect(() => { if (!dirty) return; const f = e => { e.preventDefault(); e.returnValue = '' }; window.addEventListener('beforeunload', f); return () => window.removeEventListener('beforeunload', f) }, [dirty])

  // ---- unsaved changes guard: Save / Discard / Cancel before anything that would drop the pending cells
  const guard = action => { if (!dirty) return action(); setDlg({ action }) }
  const goView = v => guard(async () => { setView(v); setErr(''); setMsg(''); setComment(''); await load(sel, v) })
  const pickEmployee = id => guard(async () => { setSel(+id); setErr(''); setMsg(''); setComment(''); await load(+id, view) })
  const scope = useMemo(() => {  // weeks the comment will be linked to, detected automatically from the pending cells
    if (!T) return []; const pmap = Object.fromEntries(T.periods.map(p => [p.id, p])), s = new Map()
    Object.values(pending).forEach(q => { const p = q.type !== 'field' && pmap[q.pid]; if (p) s.set(`${p.iso_year}-${p.iso_week}`, [p.iso_year, p.iso_week]) }); return [...s.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  }, [pending, T])
  const colTotal = pid => { let t = T.col_totals[pid] || 0; for (const q of Object.values(pending)) if (q.type === 'cell' && q.pid === pid) { const x = pm(q.raw); if (x !== null) t += x - q.old } return t }
  const over = T ? T.periods.filter(p => colTotal(p.id) > p.capacity * 1000).map(p => `WEEK${p.iso_week} (${mlabel(p.month_key)}): ${colTotal(p.id) / 1000} > ${p.capacity}`) : []
  const bad = Object.values(pending).filter(q => q.type !== 'field' && pm(q.raw) === null).length
  const applyEdit = (P, [k, obj, orig]) => { const x = { ...P }; const same = obj.type === 'field' ? String(obj.raw) === String(orig) : pm(obj.raw) === obj.old; if (same) delete x[k]; else x[k] = obj; return x }
  const edit = (k, obj, orig) => changePending(P => applyEdit(P, [k, obj, orig]), k)
  const editBatch = edits => changePending(P => edits.reduce(applyEdit, P))

  const save = async () => {   // returns true only when the batch was saved (used by "Save and export")
    if (savingRef.current) return false; savingRef.current = true; setSaving(true)
    const changes = Object.values(pending).map(q => ({ type: q.type, activity_id: q.activity_id, period_id: q.period_id, kind: q.kind, field: q.field, old: q.old, new: q.raw }))
    try { const r = await api(`/trackers/${sel}/save`, { method: 'POST', body: { changes, comment } }); setMsg(`Saved ${r.changes} change${r.changes > 1 ? 's' : ''}.`); setErr(''); setComment(''); await load(sel, view); return true }
    catch (e) {
      if (e.status === 409) {
        const fresh = await api(`/trackers/${sel}?from=${range.from}&to=${range.to}`); const P = {}
        for (const [k, q] of Object.entries(pending)) P[k] = { ...q, old: q.type === 'cell' ? (fresh.entries[q.activity_id] || {})[q.pid] || 0 : q.type === 'info' ? (fresh.info[q.pid] || {})[q.kind] || 0 : fresh.activities.find(a => a.id === q.activity_id)[q.field] }
        setT(fresh); setPending(P); setConf(Object.fromEntries(e.data.conflicts.map(c => [c.key, 1])))
        setErr('Someone else changed the highlighted cells since you loaded this page. Their values are now the reference; review your entries and press Save again to overwrite.'); setMsg('')
      } else { setErr(e.message); setMsg('') }
      return false
    } finally { savingRef.current = false; setSaving(false) }
  }
  const dlgChoice = async c => { const d = dlg; if (c === 'cancel') return setDlg(null); if (c === 'discard') { setPending({}); setConf({}); setComment(''); setDlg(null); return d.action() } if (await save()) { setDlg(null); await d.action() } else setDlg(null) }

  const doExport = async (mode, opts) => {   // download without leaving the page
    setExp(e => ({ ...e, busy: true, error: '' }))
    try {
      if (mode === 'save' && !(await save())) { setExp(e => ({ ...e, busy: false, error: 'Save failed: nothing was exported. Your changes are still pending.' })); return }
      const q = opts.scope === 'all' ? 'scope=all' : opts.scope === 'range' ? `scope=range&from=${opts.from}&to=${opts.to}` : `scope=view&from=${range.from}&to=${range.to}`
      const r = await fetch(`/api/trackers/${sel}/export.xlsx?${q}`); if (!r.ok) { let m = 'Export failed'; try { const j = await r.json(); m = typeof j.detail === 'string' ? j.detail : j.detail.message } catch {} throw new Error(m) }
      const blob = await r.blob(), url = URL.createObjectURL(blob), a = document.createElement('a')
      a.href = url; a.download = `Weekly_Status_${(T.owner.name || 'tracker').replace(/[^A-Za-z0-9_-]+/g, '_')}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000)
      setExp(null); setMsg('Excel file downloaded.')
    } catch (e) { setExp(x => ({ ...x, busy: false, error: e.message })) }
  }

  const employees = (users || []).filter(u => u.tracker_id && u.role === 'employee'), ids = employees.map(u => u.tracker_id), idx = ids.indexOf(+sel)
  const nav = [['grid', 'Tracker'], ['bl', 'Monthly BL'], ['activity', 'Comments & history'], ...(mgr ? [['acc', 'Accounts']] : [])]
  const empty = mgr && users && !employees.length
  const setMode = m => { const [y, mo] = (view.anchor).split('-').map(Number); if (m === 'custom') return goView({ mode: 'custom', anchor: view.anchor, from: range.from, to: range.to }); if (m === 'mission' && T) { const s = T.tracker.start_date, e = T.tracker.end_date || ymd(new Date(Math.max(Date.now(), T.bounds.last ? Date.parse(T.bounds.last) : 0))); return goView({ mode: 'custom', anchor: s.slice(0, 7), from: monthStart(+s.slice(0, 4), +s.slice(5, 7)), to: monthEnd(+e.slice(0, 4), +e.slice(5, 7)), mission: true }) } goView({ mode: m, anchor: view.anchor }) }

  return <div className="app">
    <header><h1>Weekly Status</h1>
      {mgr && !empty && <span className="picker"><button aria-label="Previous employee" onClick={() => idx > 0 && pickEmployee(ids[idx - 1])}>‹</button>
        <select aria-label="Employee" value={sel || ''} onChange={e => pickEmployee(e.target.value)}>{employees.map(u => <option key={u.id} value={u.tracker_id}>{u.name}</option>)}</select>
        <button aria-label="Next employee" onClick={() => idx < ids.length - 1 && pickEmployee(ids[idx + 1])}>›</button></span>}
      {!mgr && <b className="who">{me.name}</b>}
      {T && !empty && <span className="period" aria-label="Period navigation">
        <button disabled={view.mode === 'custom'} onClick={() => goView({ ...view, anchor: shiftAnchor(view.anchor, view.mode === 'quarter' ? -3 : -1) })}>Previous</button>
        <button onClick={() => goView({ mode: view.mode === 'custom' ? 'month' : view.mode, anchor: todayAnchor() })}>Today</button>
        <button disabled={view.mode === 'custom'} onClick={() => goView({ ...view, anchor: shiftAnchor(view.anchor, view.mode === 'quarter' ? 3 : 1) })}>Next</button>
        <input type="month" aria-label="Go to month" value={view.anchor} onChange={e => e.target.value && goView({ mode: view.mode === 'custom' ? 'month' : view.mode, anchor: e.target.value })} />
        <select aria-label="View" value={view.mode === 'custom' && view.mission ? 'mission' : view.mode} onChange={e => setMode(e.target.value)}><option value="month">Month</option><option value="quarter">Quarter</option><option value="mission">Whole mission</option><option value="custom">Date range</option></select>
        <strong className="plabel" data-testid="period-label">{viewLabel(view, range)}</strong></span>}
      <span className="sp" />
      {T && !empty && <button onClick={() => setExp({ scope: 'view', from: range.from, to: range.to, busy: false, error: '' })}>Export Excel</button>}
      <details className="user"><summary>{me.email}</summary><button onClick={() => guard(onOut)}>Sign out</button></details></header>
    {T && !empty && <nav>{nav.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setErr(''); setMsg(''); if (k === 'acc') refreshUsers().catch(e => setErr(e.message)) }}>{l}</button>)}</nav>}
    {(!T || empty) && mgr && <nav><button className={tab !== 'acc' ? 'on' : ''} onClick={() => setTab('grid')}>Tracker</button><button className={tab === 'acc' ? 'on' : ''} onClick={() => setTab('acc')}>Accounts</button></nav>}
    <main>
      <Err onRetry={loadFail}>{err}</Err><Ok>{msg}</Ok>
      {loading && !T && <div className="center" role="status">Loading tracker…</div>}
      {tab === 'acc' && mgr && <Accounts me={me} users={users || []} refresh={refreshUsers} setErr={setErr} setMsg={setMsg} />}
      {tab !== 'acc' && empty && <div className="card empty"><h2>No employee yet</h2><p>Create an account for each team member. Each employee gets one tracker and sees only their own.</p><button className="p" onClick={() => setTab('acc')}>Create employee</button></div>}
      {tab !== 'acc' && !empty && !T && !loading && !err && <div className="card empty"><h2>No tracker available</h2><p>{mgr ? 'Select an employee above.' : 'Ask your manager to check your account.'}</p></div>}
      {T && !empty && tab === 'grid' && (narrow ? <MobileList T={T} /> : <Grid {...{ T, pending, conf, edit, editBatch, endEdit: endGroup, undo, redo, canUndo, canRedo, historyDisabled: saving || !!dlg || !!exp, mgr, colTotal, setErr, setMsg, sel, loading, reload: () => load(sel, view, true), dropPending: aid => setPending(P => Object.fromEntries(Object.entries(P).filter(([, q]) => q.activity_id !== aid))), onMission: () => load(sel, view, true) }} />)}
      {T && !empty && tab === 'bl' && <BL T={T} label={viewLabel(view, range)} />}
      {T && !empty && tab === 'activity' && <Panels T={T} tid={sel} mgr={mgr} range={range} reload={() => load(sel, view, true)} setErr={setErr} setMsg={setMsg} />}
    </main>
    {dirty && tab === 'grid' && !narrow && <div className="bar"><div className="barinfo"><b>{n} unsaved change{n > 1 ? 's' : ''}</b>
      <div className="warn">{bad ? 'Invalid number: use a point or a comma, max 3 decimals.' : over.length ? 'Capacity exceeded: ' + over.join('; ') : ''}</div>
      <small>Comment will be linked to: {scope.length ? scope.map(weekLabel).join(', ') : 'General comment (no period changed)'}</small></div>
      <textarea aria-label="Summary of changes" value={comment} onChange={e => setComment(e.target.value)} placeholder="Summary of these changes (optional)" />
      <button className="p" disabled={!!(bad || over.length || saving)} onClick={save}>{saving ? 'Saving…' : 'Save'}</button><button disabled={saving} onClick={() => { setPending({}); setConf({}); setErr(''); setComment('') }}>Discard</button></div>}
    {dlg && <div className="modal" role="dialog" aria-label="Unsaved changes"><div className="card"><h3>Unsaved changes</h3><p>You have {n} unsaved change{n > 1 ? 's' : ''}. What do you want to do?</p>
      <div className="row"><button className="p" disabled={saving || !!(bad || over.length)} onClick={() => dlgChoice('save')}>Save</button><button onClick={() => dlgChoice('discard')}>Discard</button><button onClick={() => dlgChoice('cancel')}>Cancel</button></div>
      {(bad || over.length) ? <small className="warn">Fix the invalid or over-capacity cells before saving.</small> : null}</div></div>}
    {exp && <div className="modal" role="dialog" aria-label="Export to Excel"><div className="card"><h3>Export to Excel</h3>
      <Err>{exp.error}</Err>
      <label className="radio"><input type="radio" name="sc" checked={exp.scope === 'view'} onChange={() => setExp({ ...exp, scope: 'view' })} /> Displayed period ({viewLabel(view, range)})</label>
      <label className="radio"><input type="radio" name="sc" checked={exp.scope === 'range'} onChange={() => setExp({ ...exp, scope: 'range' })} /> Date range <input type="date" aria-label="Export from" value={exp.from} onChange={e => setExp({ ...exp, scope: 'range', from: e.target.value })} /> to <input type="date" aria-label="Export to" value={exp.to} onChange={e => setExp({ ...exp, scope: 'range', to: e.target.value })} /></label>
      <label className="radio"><input type="radio" name="sc" checked={exp.scope === 'all'} onChange={() => setExp({ ...exp, scope: 'all' })} /> Whole tracker (all periods with data)</label>
      {dirty && <p className="warn">You have {n} unsaved change{n > 1 ? 's' : ''}. They are not in the saved data.</p>}
      <div className="row">{dirty ? <><button className="p" disabled={exp.busy || !!(bad || over.length)} onClick={() => doExport('save', exp)}>Save and export</button><button disabled={exp.busy} onClick={() => doExport('saved', exp)}>Export saved data</button></> : <button className="p" disabled={exp.busy} onClick={() => doExport('saved', exp)}>{exp.busy ? 'Exporting…' : 'Export'}</button>}
        <button disabled={exp.busy} onClick={() => setExp(null)}>Cancel</button></div></div></div>}
  </div>
}
