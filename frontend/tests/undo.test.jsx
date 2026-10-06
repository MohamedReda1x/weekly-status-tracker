import React, { useState } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Grid from '../src/Grid.jsx'
import useDraftHistory from '../src/useDraftHistory.js'

afterEach(cleanup)
const T = {
  tracker: { id: 1, work_package: '', start_date: '2026-01-01', end_date: null },
  periods: [1, 2].map(id => ({ id, start: '2026-10-05', end: '2026-10-09', month_key: '2026-10', iso_week: 41, capacity: 5 })),
  activities: [{ id: 7, details: '', status: 'WIP', affected: '', deliverables: '', estimation: '', progress: 0, archived: false, has_data: false }],
  entries: {}, info: {}, col_totals: {}, month_complete: { '2026-10': true },
  bounds: { all_total: 0 }, range: { from: '2026-10-01', to: '2026-10-31' }
}
function Harness({ data = T }) {
  const [err, setErr] = useState(''), [msg, setMsg] = useState('')
  const h = useDraftHistory()
  const apply = (P, edits) => { const next = { ...P }; for (const [k, q] of edits) next[k] = q; return next }
  return <>
    <Grid T={data} pending={h.pending} conf={{}} mgr={false} sel={1} colTotal={() => 0}
      edit={(k, q) => h.changePending(P => apply(P, [[k, q]]), k)}
      editBatch={edits => h.changePending(P => apply(P, edits))}
      endEdit={h.endGroup} undo={h.undo} redo={h.redo} canUndo={h.canUndo} canRedo={h.canRedo}
      setErr={setErr} setMsg={setMsg} reload={() => {}} dropPending={() => {}} />
    <div role="alert">{err}</div><div role="status">{msg}</div>
    <input aria-label="Outside grid" defaultValue="unchanged" />
    <button onClick={() => h.setPending({})}>Reset draft</button>
    <button onClick={() => h.setPending(P => Object.fromEntries(Object.entries(P).filter(([, q]) => q.activity_id !== 7)))}>Remove activity draft</button>
  </>
}
const cell = id => screen.getByLabelText('days-7-' + id)
const undo = () => fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
const redo = () => fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
describe('draft undo without backend', () => {
  it('groups typing in one cell and supports keyboard undo/redo', () => {
    render(<Harness />)
    fireEvent.change(cell(1), { target: { value: '1' } })
    fireEvent.change(cell(1), { target: { value: '1.5' } })
    fireEvent.keyDown(cell(1), { key: 'z', ctrlKey: true })
    expect(cell(1).value).toBe('')
    fireEvent.keyDown(cell(1), { key: 'y', ctrlKey: true })
    expect(cell(1).value).toBe('1.5')
    fireEvent.keyDown(cell(1), { key: 'z', metaKey: true })
    fireEvent.keyDown(cell(1), { key: 'Z', metaKey: true, shiftKey: true })
    expect(cell(1).value).toBe('1.5')
  })
  it('undoes an entire rectangular paste once', () => {
    render(<Harness />)
    fireEvent.paste(cell(1), { clipboardData: { getData: () => '1\t2' } })
    expect(cell(1).value).toBe('1'); expect(cell(2).value).toBe('2')
    undo()
    expect(cell(1).value).toBe(''); expect(cell(2).value).toBe('')
    redo()
    expect(cell(1).value).toBe('1'); expect(cell(2).value).toBe('2')
  })
  it('separates edits after blur and discards redo on new input', () => {
    render(<Harness />)
    fireEvent.change(cell(1), { target: { value: '1' } }); fireEvent.blur(cell(1))
    fireEvent.change(cell(1), { target: { value: '2' } }); undo()
    expect(cell(1).value).toBe('1')
    fireEvent.change(cell(2), { target: { value: '3' } })
    expect(screen.getByRole('button', { name: 'Redo' }).disabled).toBe(true)
    undo(); undo(); expect(cell(1).value).toBe('')
  })
  it('resets history when drafts are saved, discarded, rebased or removed', () => {
    render(<Harness />)
    fireEvent.change(cell(1), { target: { value: '1' } })
    fireEvent.click(screen.getByText('Reset draft'))
    expect(screen.getByRole('button', { name: 'Undo' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Redo' }).disabled).toBe(true)
    fireEvent.change(cell(1), { target: { value: '2' } })
    fireEvent.click(screen.getByText('Remove activity draft'))
    expect(cell(1).value).toBe('')
    expect(screen.getByRole('button', { name: 'Undo' }).disabled).toBe(true)
  })
  it('leaves native undo outside the grid alone', () => {
    render(<Harness />)
    fireEvent.change(cell(1), { target: { value: '1' } })
    fireEvent.keyDown(screen.getByLabelText('Outside grid'), { key: 'z', ctrlKey: true })
    expect(cell(1).value).toBe('1')
  })

  it('moves with Tab and Shift+Tab, selecting the destination value', () => {
    render(<Harness />)
    cell(1).focus()
    fireEvent.keyDown(cell(1), { key: 'Tab' })
    expect(document.activeElement).toBe(cell(2))
    fireEvent.keyDown(cell(2), { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cell(1))
    fireEvent.change(cell(2), { target: { value: '1.5' } })
    cell(1).focus(); fireEvent.keyDown(cell(1), { key: 'Tab' })
    expect(cell(2).selectionStart).toBe(0); expect(cell(2).selectionEnd).toBe(3)
    expect(fireEvent.keyDown(cell(2), { key: 'Tab' })).toBe(true)
  })
  it('moves vertically past archived rows and supports Shift+Enter', () => {
    const data = { ...T, activities: [T.activities[0], { ...T.activities[0], id: 8, archived: true }, { ...T.activities[0], id: 9 }] }
    render(<Harness data={data} />)
    cell(1).focus(); fireEvent.keyDown(cell(1), { key: 'Enter' })
    const below = screen.getByLabelText('days-9-1')
    expect(document.activeElement).toBe(below)
    fireEvent.keyDown(below, { key: 'Enter', shiftKey: true })
    expect(document.activeElement).toBe(cell(1))
    fireEvent.keyDown(cell(1), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(below)
    fireEvent.keyDown(below, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(cell(1))
  })
  it('rejects invalid paste atomically and preserves the previous draft', () => {
    render(<Harness />)
    fireEvent.change(cell(1), { target: { value: '3' } })
    fireEvent.paste(cell(1), { clipboardData: { getData: () => '1\tbad' } })
    expect(cell(1).value).toBe('3'); expect(cell(2).value).toBe('')
    expect(screen.getByRole('alert').textContent).toContain('row 1, column 2')
    undo(); expect(cell(1).value).toBe('')
  })
  it('reports ignored cells and retains one-step undo', () => {
    render(<Harness />)
    fireEvent.paste(cell(1), { clipboardData: { getData: () => '0,5\t2\t3\n4\t5\t6\n' } })
    expect(cell(1).value).toBe('0,5'); expect(cell(2).value).toBe('2')
    expect(screen.getByRole('status').textContent).toContain('4 cell(s) ignored')
    undo(); expect(cell(1).value).toBe(''); expect(cell(2).value).toBe('')
    redo(); expect(cell(1).value).toBe('0,5')
  })
  it('validates single-cell paste and accepts blank cells as zero', () => {
    render(<Harness />)
    for (const value of ['-1', '1001', '0.0001']) {
      fireEvent.paste(cell(1), { clipboardData: { getData: () => value } })
      expect(cell(1).value).toBe('')
      expect(screen.getByRole('alert').textContent).toContain('Paste cancelled')
    }
    fireEvent.paste(cell(1), { clipboardData: { getData: () => '1.25\t' } })
    expect(cell(1).value).toBe('1.25'); expect(cell(2).value).toBe('')
    expect(screen.getByRole('status').textContent).toContain('Pasted 2 cell(s)')
  })
})
