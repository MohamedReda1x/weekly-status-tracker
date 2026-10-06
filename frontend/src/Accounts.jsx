import React, { useEffect, useState } from 'react'
import { api, randomPassword } from './util.js'
import { PwInput } from './ui.jsx'
import { AffiliationFields, EmployeeAffiliation, CatalogManager, emptyAffiliation } from './Affiliations.jsx'

export default function Accounts({ me, users, refresh, setErr, setMsg }) {
  const [n, setN] = useState(''), [e, setE] = useState(''), [mode, setMode] = useState('invite'), [pw, setPw] = useState(''), [mails, setMails] = useState([]), [busy, setBusy] = useState(false), [tempFor, setTempFor] = useState(null), [tpw, setTpw] = useState('')
  const loadMails = async () => { try { setMails(await api('/emails')) } catch {} }
  const [catalog, setCatalog] = useState({ trades: [], roles: [], clients: [] }), [aff, setAff] = useState(emptyAffiliation), [catalogReady, setCatalogReady] = useState(false)
  const loadCatalog = async () => { try { setCatalog(await api('/affiliations')); setCatalogReady(true) } catch (e) { setErr(e.message) } }
  useEffect(() => { loadCatalog() }, [])
  useEffect(() => { loadMails() }, [])
  const st = s => /failed/.test(s || '') ? <b className="warn">{s}</b> : (s || '—')
  const run = async (fn, okmsg) => { if (busy) return false; setBusy(true); try { const r = await fn(); if (r && /failed/.test(r.email_status || '')) { setErr('Email failed: ' + r.email_error + '. Use "Resend invitation".'); setMsg('') } else { setErr(''); setMsg(okmsg) } await refresh(); await loadMails(); return true } catch (x) { setErr(x.message); return false } finally { setBusy(false) } }
  return <><div className="card"><h3 style={{ marginTop: 0 }}>Create an employee account</h3>
    <div className="meta"><div><label>Name</label><input aria-label="New employee name" value={n} onChange={x => setN(x.target.value)} /></div><div><label>Email (any domain)</label><input aria-label="New employee email" type="email" size={30} value={e} onChange={x => setE(x.target.value)} /></div></div>
    <AffiliationFields value={aff} onChange={setAff} catalog={catalog} disabled={busy || !catalogReady} prefix="New employee " />
    <div className="meta"><label className="radio"><input type="radio" name="mode" checked={mode === 'invite'} onChange={() => setMode('invite')} /> Send invitation (email with a link)</label>
      <label className="radio"><input type="radio" name="mode" checked={mode === 'temp_password'} onChange={() => setMode('temp_password')} /> Set temporary password (no email)</label></div>
    {mode === 'temp_password' && <div className="meta"><div><label>Temporary password (min. 8 characters)</label><PwInput label="Temporary password" value={pw} onChange={setPw} /></div><div><label>&nbsp;</label><button onClick={() => setPw(randomPassword())}>Generate</button></div>
      <p className="hint">Give it to the employee yourself. Only its hash is stored; they must choose their own password at first sign-in.</p></div>}
    <button className="p" disabled={busy || !catalogReady} onClick={async () => { if (await run(() => api('/users', { method: 'POST', body: { name: n, email: e, mode, ...aff, temp_password: mode === 'temp_password' ? pw : null } }), mode === 'invite' ? 'Account created, invitation processed.' : 'Account created. Hand over the temporary password.')) { setN(''); setE(''); setPw(''); setAff(emptyAffiliation) } }}>{mode === 'invite' ? 'Create and send invitation' : 'Create with temporary password'}</button>
    {me.email_test_mode && <div className="err test">Email TEST MODE: nothing is sent. Copy the activation link from the Outbox below.</div>}
    <div className="wrap tall"><table className="plain"><tbody><tr><th>Name</th><th>Email</th><th>Role</th><th>Password</th><th>Last email</th><th>Active</th><th /></tr>
      {users.map(u => <React.Fragment key={u.id}><tr><td>{u.name}{u.role === 'employee' && catalogReady && <EmployeeAffiliation key={[u.id,u.trade_id,u.professional_role_id,u.client_id].join('-')} user={u} catalog={catalog} onSaved={refresh} setErr={setErr} setMsg={setMsg} />}</td><td>{u.email}</td><td>{u.role}</td><td>{u.must_change_password ? 'temporary (must change)' : u.has_password ? 'set' : 'not set'}</td><td>{st(u.last_email)}</td>
        <td><input type="checkbox" aria-label={`active-${u.email}`} checked={!!u.active} disabled={u.id === me.id || busy} onChange={x => run(() => api(`/users/${u.id}/active`, { method: 'POST', body: { active: x.target.checked } }), 'Updated.')} /></td>
        <td className="acts"><button disabled={busy} onClick={() => run(() => api(`/users/${u.id}/resend`, { method: 'POST' }), 'Email processed.')}>{u.has_password ? 'Send reset link' : 'Send invitation'}</button>
          {u.id !== me.id && <button disabled={busy} onClick={() => { setTempFor(tempFor === u.id ? null : u.id); setTpw('') }}>Set temporary password</button>}</td></tr>
        {tempFor === u.id && <tr><td colSpan={7} className="inline"><b>New temporary password for {u.name}</b> <PwInput label={`Temporary password for ${u.email}`} value={tpw} onChange={setTpw} /> <button onClick={() => setTpw(randomPassword())}>Generate</button>
          <button className="p" disabled={busy} onClick={async () => { if (await run(() => api(`/users/${u.id}/temp-password`, { method: 'POST', body: { password: tpw } }), `Temporary password set for ${u.name}. Their sessions and pending links were revoked.`)) { setTempFor(null); setTpw('') } }}>Apply</button> <button onClick={() => setTempFor(null)}>Cancel</button></td></tr>}</React.Fragment>)}</tbody></table></div></div>
    <CatalogManager catalog={catalog} refresh={loadCatalog} setErr={setErr} setMsg={setMsg} />
    <div className="card"><h3 style={{ marginTop: 0 }}>Outbox (last 30)</h3><div className="wrap tall"><table className="plain"><tbody><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th>{me.email_test_mode && <th>Link (test mode)</th>}</tr>
      {mails.map(m => <tr key={m.id}><td>{m.created.replace('T', ' ').slice(0, 16)}</td><td>{m.to_addr}</td><td>{m.subject}</td><td>{st(m.status)} {m.error}</td>
        {me.email_test_mode && <td><input readOnly size={40} aria-label={`link-${m.to_addr}`} value={(m.body.match(/https?:\S+/) || [''])[0]} onClick={x => x.target.select()} /></td>}</tr>)}</tbody></table></div></div></>
}
