import React, { useState } from 'react'
export const Err = ({ children, onRetry }) => children ? <div className="err" role="alert">{children}{onRetry && <> <button onClick={onRetry}>Retry</button></>}</div> : null
export const Ok = ({ children }) => children ? <div className="okm" role="status">{children}</div> : null
export function PwInput({ label, value, onChange, onEnter, autoComplete = 'new-password' }) {
  const [show, setShow] = useState(false)
  return <span className="pw"><input aria-label={label} type={show ? 'text' : 'password'} value={value} autoComplete={autoComplete} onChange={e => onChange(e.target.value)} onKeyDown={e => e.key === 'Enter' && onEnter && onEnter()} />
    <button type="button" className="ghost" aria-label={`${show ? 'Hide' : 'Show'} ${label}`} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button></span>
}
export function Pager({ total, limit, offset, onChange }) {
  const from = total ? offset + 1 : 0, to = Math.min(offset + limit, total)
  return <div className="pager"><span>{from}–{to} of {total}</span><button disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</button><button disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Next</button></div>
}
