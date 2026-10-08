// DOM-level UI test (jsdom) against a REAL running backend + empty database. Not a visual browser test.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import App from '../src/App.jsx'

const BASE = process.env.UI_BASE || 'http://127.0.0.1:8012'
let jar = {}
const real = globalThis.fetch
globalThis.fetch = async (u, o = {}) => {
  const r = await real(BASE + u, { ...o, headers: { ...(o.headers || {}), cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } })
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (!v || v === '""') delete jar[k]; else jar[k] = v }
  return r
}
window.confirm = () => true
const downloads = []; URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {}
HTMLAnchorElement.prototype.click = function () { downloads.push(this.download) }
const type = (label, v) => fireEvent.change(typeof label === 'string' ? screen.getByLabelText(label) : label, { target: { value: v } })
const click = name => fireEvent.click(screen.getByRole('button', { name }))
async function signIn(email, pw) { window.location.hash = '#/'; await screen.findByLabelText('Email'); type('Email', email); type('Password', pw); click('Sign in') }
async function signOut() { fireEvent.click((await screen.findAllByText(/^[^ ]+@[^ ]+$/))[0]); click('Sign out'); await screen.findByLabelText('Email') }
const freeInputs = () => screen.getAllByLabelText(/^days-/).filter(i => !i.disabled)
const idle = () => waitFor(() => expect(document.querySelector('.wrap.loading')).toBeNull())
const label = () => screen.getByTestId('period-label').textContent
afterEach(cleanup)

describe('manager and employee journeys', () => {
  let tid
  it('empty state, account creation by invitation, activation, no password shown in clear', async () => {
    render(<App />); await signIn('boss@x.com', 'Admin-pass-1')
    await screen.findByText('No employee yet'); fireEvent.click(screen.getByRole('button', { name: 'Create employee' }))
    type(await screen.findByLabelText('New employee name'), 'Alice'); type('New employee email', 'alice@gmail.com'); click('Create and send invitation')
    const link = (await screen.findByLabelText('link-alice@gmail.com')).value
    expect(link).toContain('/#/set-password/')
    const users = await (await fetch('/api/users')).json(); tid = users.find(u => u.email === 'alice@gmail.com').tracker_id
    expect((await fetch(`/api/trackers/${tid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ work_package: 'WP', start_date: '2026-01-01' }) })).status).toBe(200)
    window.location.hash = '#/set-password/' + link.split('/set-password/')[1]
    const f = await screen.findByLabelText('New password'); expect(f.type).toBe('password'); type(f, 'Employee-pw-1')
    click('Show New password'); expect(f.type).toBe('text'); click('Save password'); await screen.findByText('Password saved.')
    window.location.hash = '#/'; await signOut()
  })
  it('employee: decimals, capacity block, current-week comment, archive, hidden BL, keyboard/paste, conflict', async () => {
    render(<App />); await signIn('alice@gmail.com', 'Employee-pw-1')
    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0); expect(screen.queryByLabelText('Employee')).toBeNull(); expect(screen.queryByRole('button', { name: 'Accounts' })).toBeNull()
    expect(await screen.findByLabelText('Employee affiliation')).toBeTruthy(); expect((await screen.findAllByText('Alstom Estimation')).length).toBeGreaterThan(0)
    // an activity added by mistake can be deleted while it has no saved day
    fireEvent.click(await screen.findByRole('button', { name: '+ Add activity' })); fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await screen.findByText('Activity moved to trash. Its days are excluded from totals.'); await waitFor(() => expect(screen.queryAllByLabelText(/^details-/).length).toBe(0))
    fireEvent.click(await screen.findByRole('button', { name: '+ Add activity' }))
    type(await screen.findByLabelText(/^details-/), 'Review SwDS')
    const T = await (await fetch('/api/trackers/' + tid)).json()
    const [a, b] = freeInputs(), pid = a.getAttribute('aria-label').split('-')[2], cap = T.periods.find(p => p.id == pid).capacity
    type(a, String(cap + 1)); await screen.findByText(/Capacity exceeded/); expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
    type(a, '0,5'); type(b, '1.25'); await screen.findByText(/Comment will be linked to: WEEK\d+\/\d{4}/)
    type(screen.getByLabelText('Current week commentary'), 'Review in progress')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false)); click('Save'); await screen.findByText(/Saved 3 changes/)
    expect(screen.getByTestId('ct-' + pid).textContent).toBe('0.5')
    fireEvent.click(screen.getByRole('button', { name: 'Comments & history' })); await screen.findByText('Review in progress')
    expect((await (await fetch(`/api/trackers/${tid}/comments`)).json()).items[0].scopes.length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Tracker' })); await screen.findByLabelText(/^details-/)
    const mt = () => Number(screen.getAllByTestId(/^mt-/)[0].textContent.replace('*', '')); const before = mt(); expect(before).toBeGreaterThan(0)
    click('Archive'); await screen.findByText('Archived'); expect(mt()).toBe(before)
    click('Restore'); await waitFor(() => expect(screen.queryByText('Archived')).toBeNull())
    expect(screen.getByRole('button', { name: 'Delete' }).disabled).toBe(false) // recoverable deletion also applies to saved days
    expect(screen.queryByRole('button', { name: 'Monthly BL' })).toBeNull()
    // keyboard + Excel paste
    fireEvent.click(await screen.findByRole('button', { name: '+ Add activity' })); await waitFor(() => expect(screen.getAllByLabelText(/^details-/).length).toBe(2))
    const f0 = freeInputs()[0], c0 = +f0.dataset.c, cell = (r, c) => document.querySelector(`input[data-r="${r}"][data-c="${c}"]`)
    f0.focus(); fireEvent.keyDown(f0, { key: 'Enter' }); expect(document.activeElement).toBe(cell(1, c0))
    fireEvent.paste(f0, { clipboardData: { getData: () => '0,25\t0,5\n1\t1,5' } })
    expect([cell(0, c0).value, cell(0, c0 + 1).value, cell(1, c0).value, cell(1, c0 + 1).value]).toEqual(['0,25', '0,5', '1', '1,5'])
    // period navigation with pending changes: Save / Discard / Cancel
    const lab0 = label(); click('Next')
    const dlg = await screen.findByRole('dialog', { name: 'Unsaved changes' }); expect(within(dlg).getByRole('button', { name: 'Save' })).toBeTruthy()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' })); expect(label()).toBe(lab0); expect(cell(1, c0).value).toBe('1')   // nothing lost
    click('Next'); fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(label()).not.toBe(lab0)); click('Previous'); await waitFor(() => expect(label()).toBe(lab0)); await idle()
    expect(cell(1, c0).value).toBe('')            // discarded
    fireEvent.click(screen.getByLabelText('View')); fireEvent.change(screen.getByLabelText('View'), { target: { value: 'quarter' } }); await waitFor(() => expect(label()).toMatch(/^Q\d \d{4}$/))
    fireEvent.change(screen.getByLabelText('View'), { target: { value: 'month' } }); click('Today'); await waitFor(() => expect(label()).toBe(lab0)); await idle(); await new Promise(r => setTimeout(r, 300))
    // export without leaving the page: Save and export / failed save => no export
    const d0 = downloads.length; type(freeInputs()[2], '0,25')
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' })); const ed = await screen.findByRole('dialog', { name: 'Export to Excel' })
    expect(within(ed).getByRole('button', { name: 'Export saved data' })).toBeTruthy(); fireEvent.click(within(ed).getByRole('button', { name: 'Save and export' }))
    await screen.findByText('Excel file downloaded.'); expect(downloads.length).toBe(d0 + 1); expect(downloads.at(-1)).toMatch(/Weekly_Status_Alice\.xlsx/); expect(screen.queryByText(/unsaved change/)).toBeNull()
    const T2 = await (await fetch('/api/trackers/' + tid)).json(), act = T2.activities[0].id, c2 = freeInputs()[3], p2 = c2.getAttribute('aria-label').split('-')[2]
    type(c2, '1'); await fetch(`/api/trackers/${tid}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: [{ type: 'cell', activity_id: T2.activities.find(x => !x.archived && x.id !== act)?.id ?? act, period_id: +p2, old: 0, new: '0,25' }] }) })
    const aid2 = c2.getAttribute('aria-label').split('-')[1]
    await fetch(`/api/trackers/${tid}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: [{ type: 'cell', activity_id: +aid2, period_id: +p2, old: (T2.entries[aid2] || {})[p2] || 0, new: '0,75' }] }) })
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' })); fireEvent.click(within(await screen.findByRole('dialog', { name: 'Export to Excel' })).getByRole('button', { name: 'Save and export' }))
    await screen.findByText(/Save failed: nothing was exported/); expect(downloads.length).toBe(d0 + 1)    // no export after a failed save
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Export to Excel' })).getByRole('button', { name: 'Cancel' }))
    expect(c2.closest('td').className).toContain('conf'); fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await signOut()
  })
  it('manager: temporary password account, forced change, employee selection', async () => {
    render(<App />); await signIn('boss@x.com', 'Admin-pass-1')
    const sel = await screen.findByLabelText('Employee'); await waitFor(() => expect(within(sel).getByText('Alice')).toBeTruthy()); await screen.findByDisplayValue('Review SwDS')
    fireEvent.click(screen.getByRole('button', { name: 'Accounts' })); await screen.findByLabelText('New employee name')
    fireEvent.click(screen.getByLabelText(/Set temporary password \(no email\)/)); type('New employee name', 'Bob'); type('New employee email', 'bob@outlook.com')
    click('Generate'); const tp = screen.getByLabelText('Temporary password').value; expect(tp.length).toBeGreaterThanOrEqual(12)
    click('Create with temporary password'); await screen.findByText(/Account created\. Hand over the temporary password/)
    await screen.findByText('temporary (must change)'); await signOut()
    await signIn('bob@outlook.com', tp); await screen.findByText('Choose a new password'); type('Temporary password', tp); type('New password', 'Bob-own-pass-1'); type('Repeat new password', 'Bob-own-pass-1')
    click('Save and continue'); expect((await screen.findAllByText('Bob')).length).toBeGreaterThan(0); expect(screen.queryByLabelText('Employee')).toBeNull()
  })
})
