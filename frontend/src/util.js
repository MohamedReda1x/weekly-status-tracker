export async function api(p, o = {}) {
  const r = await fetch('/api' + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined })
  let d = null; try { d = await r.json() } catch {}
  if (!r.ok) { const x = d && d.detail; const e = new Error(typeof x === 'string' ? x : (x && x.message) || 'Request failed'); e.status = r.status; e.data = x; throw e }
  return d
}
// same rule as the server (the server stays authoritative): comma or point, max 3 decimals
export function pm(s) { s = String(s ?? '').trim(); if (!s) return 0; if (s.includes(',') && s.includes('.')) return null; if (!/^\d+([.,]\d{1,3})?$/.test(s)) return null; return Math.round(parseFloat(s.replace(',', '.')) * 1000) }
export const fmt = m => (m ? String(m / 1000) : '')
export const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const mlabel = k => MN[+k.slice(5) - 1] + ' ' + k.slice(2, 4)
export const pad = n => String(n).padStart(2, '0')
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const monthStart = (y, m) => `${y}-${pad(m)}-01`
export const monthEnd = (y, m) => ymd(new Date(y, m, 0))
export const todayAnchor = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
// the consulted period (client-side only, never imposed on someone else) -> {from,to}
export function viewRange(v) {
  const [y, m] = v.anchor.split('-').map(Number)
  if (v.mode === 'month') return { from: monthStart(y, m), to: monthEnd(y, m) }
  if (v.mode === 'quarter') { const q = Math.floor((m - 1) / 3) * 3 + 1; return { from: monthStart(y, q), to: monthEnd(y, q + 2) } }
  return { from: v.from, to: v.to }
}
export function shiftAnchor(a, delta) { const [y, m] = a.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
export function viewLabel(v, r) {
  const [y, m] = v.anchor.split('-').map(Number)
  if (v.mode === 'month') return `${MN[m - 1]} ${y}`
  if (v.mode === 'quarter') return `Q${Math.floor((m - 1) / 3) + 1} ${y}`
  return `${r.from} → ${r.to}`
}
export function isoWeek(d) { d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - n); const y = d.getUTCFullYear(); return [y, Math.ceil(((d - new Date(Date.UTC(y, 0, 1))) / 864e5 + 1) / 7)] }
export const weekLabel = ([y, w]) => `WEEK${w}/${y}`
export function randomPassword() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', r = new Uint32Array(14); crypto.getRandomValues(r); return [...r].map(x => a[x % a.length]).join('') }
