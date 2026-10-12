import React from 'react'
import { it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import DateRangePicker from '../src/DateRangePicker.jsx'
import App from '../src/App.jsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); location.hash = '' })
it('applies both date bounds together', () => {
  const apply = vi.fn()
  render(<DateRangePicker from="2026-10-01" to="2026-10-31" onApply={apply} />)
  fireEvent.change(screen.getByLabelText('Range from'), { target: { value: '2026-09-01' } })
  expect(apply).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Apply range'))
  expect(apply).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-10-31' })
})
it('rejects missing, inverted and overlong intervals', () => {
  render(<DateRangePicker from="2026-10-01" to="2026-10-31" onApply={() => {}} />)
  for (const to of ['', '2026-09-01', '2030-10-31']) {
    fireEvent.change(screen.getByLabelText('Range to'), { target: { value: to } })
    expect(screen.getByText('Apply range').disabled).toBe(true)
  }
})
it('hides Accounts and Monthly BL for employees and shows the logo', async () => {
  const T = { tracker: { id: 1, start_date: '2026-01-01' }, owner: { name: 'Demo' }, activities: [],
    periods: [], entries: {}, info: {}, col_totals: {}, month_totals: {}, month_complete: {},
    bounds: { all_total: 0 }, range: { from: '2026-10-01', to: '2026-10-31' } }
  vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () =>
    url === '/api/me' ? { id: 1, name: 'Demo', email: 'demo@example.org', role: 'employee', tracker_id: 1 } : T })))
  render(<App />)
  await screen.findByRole('button', { name: 'Comments & history' })
  expect(screen.queryByRole('button', { name: 'Monthly BL' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Accounts' })).toBeNull()
  expect(screen.getByAltText('SEGULA Technologies')).toBeTruthy()
})

it('saves a current-week comment without requiring grid changes', async () => {
  const T = { tracker: { id: 1, start_date: '2026-01-01' }, owner: { name: 'Demo' }, activities: [],
    periods: [], entries: {}, info: {}, col_totals: {}, month_totals: {}, month_complete: {},
    bounds: { all_total: 0 }, range: { from: '2026-10-01', to: '2026-10-31' } }
  const requests = []
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    if (options.method === 'POST') { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true, changes: 0 }) } }
    return { ok: true, json: async () => url === '/api/me'
      ? { id: 1, name: 'Demo', email: 'demo@example.org', role: 'employee', tracker_id: 1 } : T }
  }))
  render(<App />)
  fireEvent.change(await screen.findByLabelText('Current week commentary'), { target: { value: 'Review completed' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('Weekly comment saved.')
  expect(requests[0].changes).toEqual([])
  expect(requests[0].comment).toBe('Review completed')
  expect(requests[0].comment_scope_explicit).toBe(true)
  expect(requests[0].weeks.length).toBe(1)
})

it('shows manager tabs and the selected employee affiliation', async () => {
  const T = { tracker: { id: 1, start_date: '2026-01-01' }, owner: { name: 'Demo', trade_name: 'Train Control', professional_role_name: 'VTE', client_name: 'Alstom Petite-Forêt' },
    activities: [], periods: [], entries: {}, info: {}, col_totals: {}, month_totals: {}, month_complete: {},
    bounds: { all_total: 0 }, range: { from: '2026-10-01', to: '2026-10-31' } }
  vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () =>
    url === '/api/me' ? { id: 2, name: 'Manager', email: 'boss@example.org', role: 'admin' }
    : url === '/api/users' ? [{ id: 1, name: 'Demo', role: 'employee', tracker_id: 1 }] : T })))
  render(<App />)
  await screen.findByRole('button', { name: 'Monthly BL' })
  expect(screen.getByRole('button', { name: 'Accounts' })).toBeTruthy()
  expect(screen.getByLabelText('Employee affiliation').textContent).toContain('Train Control')
  expect(screen.getByLabelText('Employee affiliation').textContent).toContain('Alstom Petite-Forêt')
  const buttons = [...document.querySelector('nav').querySelectorAll('button')].map(b => b.textContent)
  expect(buttons.indexOf('Leave dates')).toBe(buttons.indexOf('Comments & history') + 1)
})

it('combines affiliation filters, clears stale trackers on no match, and resets filters', async () => {
  const users = [
    { id: 1, name: 'Mark', role: 'employee', tracker_id: 1, trade_id: 1, trade_name: 'Train Control', professional_role_id: 1, professional_role_name: 'CE', client_id: 1, client_name: 'Alstom' },
    { id: 2, name: 'Alice', role: 'employee', tracker_id: 2, trade_id: 2, trade_name: 'Train System', professional_role_id: 2, professional_role_name: 'SE', client_id: 2, client_name: 'Other' }
  ]
  const tracker = id => ({ tracker: { id, start_date: '2026-01-01' }, owner: users[id - 1], activities: [],
    periods: [], entries: {}, info: {}, col_totals: {}, month_totals: {}, month_complete: {},
    bounds: { all_total: 0 }, range: { from: '2026-10-01', to: '2026-10-31' } })
  vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () =>
    url === '/api/me' ? { id: 3, name: 'Manager', email: 'boss@example.org', role: 'admin' }
    : url === '/api/users' ? users : tracker(+url.match(/trackers\/(\d+)/)?.[1] || 1) })))
  render(<App />)
  await screen.findByLabelText('Filter Trade')
  fireEvent.change(screen.getByLabelText('Filter Trade'), { target: { value: '2' } })
  await screen.findByText('1 / 2 employees')
  await vi.waitFor(() => expect(screen.getByLabelText('Employee').value).toBe('2'))
  expect(screen.getByLabelText('Filter Professional role').querySelectorAll('option').length).toBe(2)
  fireEvent.change(screen.getByLabelText('Filter Client'), { target: { value: '1' } })
  await screen.findByText('No employee matches these filters')
  expect(screen.queryByLabelText('Employee affiliation')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
  await screen.findByText('2 / 2 employees')
  await vi.waitFor(() => expect(screen.getByLabelText('Employee').value).toBe('1'))
  fireEvent.change(screen.getByLabelText('Filter Professional role'), { target: { value: '2' } })
  await vi.waitFor(() => expect(screen.getByLabelText('Employee').value).toBe('2'))
})
it('guards pending commentary before changing the selected employee through a filter', async () => {
  const users = [1, 2].map(id => ({ id, name: 'Person ' + id, role: 'employee', tracker_id: id, client_id: id, client_name: 'Client ' + id }))
  const T = { tracker: { id: 1, start_date: '2026-01-01' }, owner: users[0], activities: [], periods: [],
    entries: {}, info: {}, col_totals: {}, month_totals: {}, month_complete: {}, bounds: { all_total: 0 },
    range: { from: '2026-10-01', to: '2026-10-31' } }
  vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () =>
    url === '/api/me' ? { id: 3, role: 'admin', email: 'boss@example.org' } : url === '/api/users' ? users : T })))
  render(<App />)
  fireEvent.change(await screen.findByLabelText('Current week commentary'), { target: { value: 'Keep this draft' } })
  fireEvent.change(screen.getByLabelText('Filter Client'), { target: { value: '2' } })
  await screen.findByRole('dialog', { name: 'Unsaved changes' })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByLabelText('Filter Client').value).toBe('')
  expect(screen.getByLabelText('Employee').value).toBe('1')
  expect(screen.getByLabelText('Current week commentary').value).toBe('Keep this draft')
})
it('removes the repeated interval label in Date range mode', async () => {
  const T = { tracker: { id: 1, start_date: '2026-01-01' }, owner: { name: 'Demo' }, activities: [], periods: [],
    entries: {}, info: {}, col_totals: {}, month_totals: {}, month_complete: {}, bounds: { all_total: 0 },
    range: { from: '2026-10-01', to: '2026-10-31' } }
  vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () =>
    url === '/api/me' ? { id: 1, role: 'employee', tracker_id: 1, name: 'Demo', email: 'demo@example.org' } : T })))
  render(<App />)
  fireEvent.change(await screen.findByLabelText('View'), { target: { value: 'custom' } })
  await screen.findByLabelText('Range from')
  expect(screen.queryByTestId('period-label')).toBeNull()
})

it('keeps a single profile selector with its filters and excludes inactive accounts', async () => {
  const users = [{ id: 1, name: 'Mark', role: 'employee', active: 1, tracker_id: 1 },
    { id: 2, name: 'Inactive', role: 'employee', active: 0, tracker_id: 2 }]
  const T = { tracker: { id: 1, start_date: '2026-01-01' }, owner: users[0], activities: [], periods: [],
    entries: {}, info: {}, col_totals: {}, month_totals: {}, month_complete: {}, bounds: { all_total: 0 },
    range: { from: '2026-10-01', to: '2026-10-31' } }
  vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () =>
    url === '/api/me' ? { id: 3, role: 'admin', email: 'boss@example.org' } : url === '/api/users' ? users : T })))
  render(<App />)
  const picker = await screen.findByLabelText('Employee')
  expect(screen.getAllByLabelText('Employee').length).toBe(1)
  expect(picker.closest('header')).toBeNull()
  expect(picker.closest('[aria-label="Filter employees by affiliation"]')).toBeTruthy()
  expect(picker.querySelectorAll('option').length).toBe(1)
  expect(screen.getByRole('button', { name: 'Previous employee' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Next employee' }).disabled).toBe(true)
})
it.each(['deactivate', 'delete'])('refreshes the selected profile after account %s', async action => {
  let users = [{ id: 1, name: 'Mark', email: 'mark@example.org', role: 'employee', active: 1, tracker_id: 1 }]
  const T = { tracker: { id: 1, start_date: '2026-01-01' }, owner: users[0], activities: [], periods: [],
    entries: {}, info: {}, col_totals: {}, month_totals: {}, month_complete: {}, bounds: { all_total: 0 },
    range: { from: '2026-10-01', to: '2026-10-31' } }
  vi.stubGlobal('confirm', () => true)
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => ({ ok: true, json: async () => {
    if (url === '/api/me') return { id: 3, role: 'admin', email: 'boss@example.org' }
    if (url === '/api/users') return users
    if (url === '/api/affiliations') return { trades: [], roles: [], clients: [] }
    if (url === '/api/emails') return []
    if (options.method === 'DELETE' || url.endsWith('/active')) {
      users = action === 'delete' ? [] : users.map(u => ({ ...u, active: 0 }))
      return { ok: true }
    }
    return T
  } })))
  render(<App />)
  await screen.findByLabelText('Employee affiliation')
  fireEvent.click(await screen.findByRole('button', { name: 'Accounts' }))
  fireEvent.click(await screen.findByRole('button', { name: action === 'delete' ? 'Delete account' : 'active-mark@example.org' }))
  await screen.findByText(action === 'delete' ? 'Account and its data permanently deleted.' : 'Account deactivated. Access revoked; data kept.')
  fireEvent.click(screen.getByRole('button', { name: 'Tracker' }))
  await screen.findByText('No active employee')
  expect(screen.queryByLabelText('Employee affiliation')).toBeNull()
})
