import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import { normalizeEntry } from './status-rules'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-handling:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 存量数据迁移：缺字段（如输出电压）按空串补齐。
// 历史故障记录只补缺失字段，已有的供电区间保持原样，按原区间兼容。
function migrateRows(key: string, rows: EntryRow[]): { rows: EntryRow[]; changed: boolean } {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    return { rows, changed: false }
  }
  let changed = false
  const migrated = rows.map((row) => {
    const next = normalizeEntry(row, meta.fields)
    if (Object.keys(next).length !== Object.keys(row).length) {
      changed = true
    }
    return next
  })
  return { rows: migrated, changed }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
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
    const merged: Record<string, EntryRow[]> = { ...fallback, ...parsed }
    let migratedAny = false
    for (const [key, rows] of Object.entries(merged)) {
      const result = migrateRows(key, rows)
      merged[key] = result.rows
      migratedAny = migratedAny || result.changed
    }
    if (migratedAny) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    }
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

function persist(next: Record<string, EntryRow[]>): void {
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

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
  persist({ ...allRows(), [key]: rows })
}

// 丢掉内存缓存，下次读取重新过一遍持久化和迁移：外部改动过存储时调用。
export function invalidateCache(): void {
  cache = null
}

export type MutateResult = {
  found: boolean
  applied: boolean
  row?: EntryRow
}

// 状态流转的 check-and-set：以持久化为准重新读、判断、写回，中间不穿插别的读写。
// 同一设备并发提交同一个动作时，后到的请求看到的是已生效的状态，mutate 返回 null 不再重复写。
export function mutateEntry(
  key: string,
  id: number,
  mutate: (row: EntryRow) => EntryRow | null,
): MutateResult {
  const snapshot = readStorage()
  const rows = snapshot[key] ?? []
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { found: false, applied: false }
  }
  const updated = mutate(clone(rows[index]))
  if (updated === null) {
    return { found: true, applied: false }
  }
  const nextRows = [...rows]
  nextRows[index] = updated
  persist({ ...snapshot, [key]: nextRows })
  return { found: true, applied: true, row: updated }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
