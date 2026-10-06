import React, { useEffect, useState } from 'react'
import { api } from './util.js'

export default function CurrentWeekComments({ tid, week, revision }) {
  const [items, setItems] = useState([]), [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setItems([]); setError('')
    api('/trackers/' + tid + '/comments?week=' + week + '&limit=10').then(d => { if (active) setItems(Array.isArray(d.items) ? d.items : []) }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [tid, week, revision])
  if (error) return <p className="warn">Current-week comments unavailable: {error}</p>
  return <div className="current-week-comments" aria-label="Saved current week comments">{items.map(c => <div className="cm" key={c.id}><small>{c.author} · {c.created?.replace('T', ' ').slice(0, 16)}</small><div>{c.text}</div></div>)}</div>
}
