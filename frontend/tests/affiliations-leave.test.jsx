import React, { useState } from 'react'
import { it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { AffiliationFields } from '../src/Affiliations.jsx'
import LeaveDates from '../src/LeaveDates.jsx'
import CurrentWeekComments from '../src/CurrentWeekComments.jsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const catalog = { trades: [{ id: 1, name: 'Train Control' }, { id: 2, name: 'Train System' }],
  roles: [{ id: 1, trade_id: 1, name: 'VTE' }, { id: 2, trade_id: 2, name: 'SE' }],
  clients: [{ id: 1, name: 'Alstom Petite-Forêt' }] }
it('filters roles by trade, resets the role on trade change, and keeps the client independent', () => {
  function Harness() {
    const [value, setValue] = useState({ trade_id: 1, professional_role_id: 1, client_id: 1 })
    return <AffiliationFields value={value} onChange={setValue} catalog={catalog} />
  }
  render(<Harness />)
  expect(screen.getByRole('option', { name: 'VTE' })).toBeTruthy()
  expect(screen.queryByRole('option', { name: 'SE' })).toBeNull()
  fireEvent.change(screen.getByLabelText('Trade'), { target: { value: '2' } })
  expect(screen.getByLabelText('Professional role').value).toBe('')
  expect(screen.queryByRole('option', { name: 'VTE' })).toBeNull()
  expect(screen.getByRole('option', { name: 'SE' })).toBeTruthy()
  expect(screen.getByLabelText('Client').value).toBe('1')
})
const T = { periods: [{ id: 1, start: '2026-10-05', end: '2026-10-09', iso_week: 41 }], info: { 1: { leave: 1500 } } }
it('saves dates separately without sending or changing the main duration', async () => {
  const requests = [], setMsg = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    if (opts.method === 'PUT') { const body = JSON.parse(opts.body); requests.push(body); return { ok: true, json: async () => ({ dates: body.dates }) } }
    return { ok: true, json: async () => ({}) }
  }))
  render(<LeaveDates T={T} tid={1} setErr={() => {}} setMsg={setMsg} />)
  const date = await screen.findByRole('button', { name: 'Leave date 2026-10-05' })
  fireEvent.click(date)
  await waitFor(() => expect(date.getAttribute('aria-pressed')).toBe('true'))
  expect(requests[0]).toEqual({ old: [], dates: ['2026-10-05'] })
  expect(screen.getByText('1.5')).toBeTruthy()
  fireEvent.click(date)
  await waitFor(() => expect(date.getAttribute('aria-pressed')).toBe('false'))
  expect(requests[1]).toEqual({ old: ['2026-10-05'], dates: [] })
})
it('reloads dates on a concurrent-edit conflict and never changes duration', async () => {
  let gets = 0
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => opts.method === 'PUT'
    ? { ok: false, status: 409, json: async () => ({ detail: 'Leave dates changed' }) }
    : { ok: true, json: async () => ++gets === 1 ? {} : { 1: ['2026-10-06'] } }))
  const err = vi.fn()
  render(<LeaveDates T={T} tid={1} setErr={err} setMsg={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Leave date 2026-10-05' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Leave date 2026-10-06' }).getAttribute('aria-pressed')).toBe('true'))
  expect(err).toHaveBeenCalledWith('Leave dates changed')
  expect(screen.getByText('1.5')).toBeTruthy()
})
it('requests only current-week saved comments and refreshes after tracker save', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ id: 1, author: 'Demo', text: 'This week', created: '2026-10-06T10:00' }] }) }))
  vi.stubGlobal('fetch', fetcher)
  const { rerender } = render(<CurrentWeekComments tid={1} week="2026-41" revision={1} />)
  await screen.findByText('This week')
  expect(fetcher.mock.calls[0][0]).toBe('/api/trackers/1/comments?week=2026-41&limit=10')
  rerender(<CurrentWeekComments tid={1} week="2026-41" revision={2} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
})
