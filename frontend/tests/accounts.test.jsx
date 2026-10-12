import React from 'react'
import { it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import Accounts from '../src/Accounts.jsx'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const manager = { id: 1, name: 'Manager', email: 'boss@example.org', role: 'admin', active: 1 }
const employee = { id: 2, name: 'Mark', email: 'mark@example.org', role: 'employee', active: 1 }
function setup(user = employee) {
  const fetcher = vi.fn(async url => ({ ok: true, json: async () => url === '/api/affiliations' ? { trades: [], roles: [], clients: [] } : url === '/api/emails' ? [] : { ok: true } }))
  vi.stubGlobal('fetch', fetcher)
  const refresh = vi.fn(), setMsg = vi.fn()
  render(<Accounts me={manager} users={[manager, user]} refresh={refresh} setErr={() => {}} setMsg={setMsg} />)
  return { fetcher, refresh, setMsg }
}
it('confirms deactivation, retains data and protects the current manager', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { fetcher, setMsg } = setup()
  await screen.findByRole('button', { name: 'Delete account' })
  expect(screen.getByLabelText('active-boss@example.org').disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('active-mark@example.org'))
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/active'))).toBe(false)
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByLabelText('active-mark@example.org'))
  await waitFor(() => expect(setMsg).toHaveBeenCalledWith('Account deactivated. Access revoked; data kept.'))
  const call = fetcher.mock.calls.find(([url]) => url.endsWith('/active'))
  expect(JSON.parse(call[1].body)).toEqual({ active: false })
})
it('reactivates an inactive account and disables email links until then', async () => {
  const { fetcher } = setup({ ...employee, active: 0 })
  expect(screen.getByText('Deactivated')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Send invitation' })[1].disabled).toBe(true)
  expect(screen.getByLabelText('active-mark@example.org').textContent).toBe('Reactivate')
  fireEvent.click(screen.getByLabelText('active-mark@example.org'))
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/active'))).toBe(true))
  expect(JSON.parse(fetcher.mock.calls.find(([url]) => url.endsWith('/active'))[1].body)).toEqual({ active: true })
})
it('deletes an employee only after explicit confirmation and refreshes the profiles', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { fetcher, refresh } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
  expect(fetcher.mock.calls.some(([,options]) => options?.method === 'DELETE')).toBe(false)
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  const call = fetcher.mock.calls.find(([,options]) => options?.method === 'DELETE')
  expect(call[0]).toBe('/api/users/2')
  expect(confirm.mock.calls.at(-1)[0]).toContain('This cannot be undone')
})
