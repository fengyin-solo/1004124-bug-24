import { DEVICE_RULE_BY_KEY, projectDeviceRow, resolveVerdict } from '@/data/device-rules'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 同一设备的动作在途锁：同一台地面电源并发提交断电，只有第一个生效，其余直接按重复操作处理。
const inflight = new Set<string>()

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 设备类模块（地面电源、装卸设备）统一过状态规则：列表、详情、导出拿到的是同一份结论。
function project(key: string, row: EntryRow): EntryRow {
  const rule = DEVICE_RULE_BY_KEY.get(key)
  return rule ? projectDeviceRow(row, rule) : row
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const projected = listRows(key).map((row) => project(key, row))
  const matched = filterRows(projected, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 详情与列表同源：详情面板展示的状态结论就是列表、导出在用的结论。
export function getEntry(key: string, id: number): EntryRow | null {
  const row = listRows(key).find((item) => Number(item.id) === id)
  return row ? project(key, row) : null
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const lockKey = `${key}:${id}`
  if (inflight.has(lockKey)) {
    return { ok: false, message: `${meta.entity}正在处理上一次操作，请勿重复提交` }
  }
  inflight.add(lockKey)
  try {
    const target = meta.actionTargets[action]
    if (!target) {
      return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
    }
    const rows = listRows(key)
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
    }
    const current = String(rows[index].status)
    if (current === target) {
      return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
    }
    const rule = DEVICE_RULE_BY_KEY.get(key)
    let updated: EntryRow
    if (rule) {
      // 状态规则内归一：终态（已断电/故障报修）清中间态，异常标记跟故障结论走。
      updated = projectDeviceRow({ ...rows[index], status: target }, rule)
      const verdict = resolveVerdict(updated, rule)
      updated.pending = !verdict.terminal
      updated.abnormal = verdict.fault
    } else {
      const lastStatus = meta.statuses[meta.statuses.length - 1]
      updated = {
        ...rows[index],
        status: target,
        pending: target !== lastStatus,
        abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
      }
    }
    const next = [...rows]
    next[index] = updated
    saveRows(key, next)
    return { ok: true, message: `${meta.entity}已${action}，当前状态「${updated.status}」` }
  } finally {
    inflight.delete(lockKey)
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const rows = listRows(key).map((row) => project(key, row))
  // 设备类模块的字段里已含规范的「设备状态」，导出不再追加第二份「当前状态」列。
  const deviceModule = DEVICE_RULE_BY_KEY.has(key)
  const header = deviceModule
    ? ['编号', ...meta.fields]
    : ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of rows) {
    const cells = meta.fields.map((field) => row[field] ?? '')
    const line = deviceModule
      ? [row.id, ...cells].join(',')
      : [row.id, ...cells, row.status].join(',')
    lines.push(line)
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
