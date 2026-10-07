import { DEVICE_RULE_BY_KEY, migrateDeviceRows } from './device-rules'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-handling:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 存量迁移：设备类模块按统一规则归一（旧字段名、历史故障写法、缺电压补空），迁移后立即落库。
function migrateAll(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  let changed = false
  const next = { ...data }
  for (const [key, rule] of DEVICE_RULE_BY_KEY) {
    if (!(key in next)) {
      continue
    }
    const rows = migrateDeviceRows(next[key], rule)
    if (rows !== next[key]) {
      next[key] = rows
      changed = true
    }
  }
  return changed ? next : data
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = migrateAll(clone(SEED_ROWS))
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = migrateAll({ ...fallback, ...parsed })
    if (merged !== parsed) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    }
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
