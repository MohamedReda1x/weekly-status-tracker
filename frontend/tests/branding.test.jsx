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
