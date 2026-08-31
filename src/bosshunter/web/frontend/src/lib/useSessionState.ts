import { useEffect, useState } from 'react'

export function useSessionState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.sessionStorage.getItem(key)
      return stored === null ? initialValue : JSON.parse(stored) as T
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  }, [key, value])

  return [value, setValue] as const
}
