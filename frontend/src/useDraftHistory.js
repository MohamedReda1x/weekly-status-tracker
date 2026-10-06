import { useCallback, useRef, useState } from 'react'

// Local draft history only; saved data remains the server's responsibility.
export default function useDraftHistory() {
  const current = useRef({}), past = useRef([]), future = useRef([]), group = useRef(null)
  const [pending, render] = useState({})
  const publish = useCallback(next => { current.current = next; render(next) }, [])
  const endGroup = useCallback(() => { group.current = null }, [])
  const setPending = useCallback(value => {
    past.current = []; future.current = []; group.current = null
    publish(typeof value === 'function' ? value(current.current) : value)
  }, [publish])
  const changePending = useCallback((update, key = null) => {
    const next = update(current.current)
    if (JSON.stringify(next) === JSON.stringify(current.current)) return
    if (!key || group.current !== key) {
      past.current = [...past.current.slice(-99), current.current]
    }
    future.current = []; group.current = key
    publish(next)
  }, [publish])
  const undo = useCallback(() => {
    if (!past.current.length) return
    future.current.push(current.current); group.current = null
    publish(past.current.pop())
  }, [publish])
  const redo = useCallback(() => {
    if (!future.current.length) return
    past.current.push(current.current); group.current = null
    publish(future.current.pop())
  }, [publish])
  return { pending, setPending, changePending, endGroup, undo, redo,
    canUndo: past.current.length > 0, canRedo: future.current.length > 0 }
}
