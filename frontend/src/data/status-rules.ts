import type { EntryRow } from './types'

// 设备状态规则：地面电源的断电判定只在这里定义一次。
// 列表、详情、导出以及装卸设备清单都共用这份结论，不再各写一遍。

// 断电判定：命中这些状态即视为「已断电」（当前不在供电）。
const POWER_OFF_STATUSES = new Set(['待机', '已断电', '故障停用'])

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 停用报修要清除的中间态字段：进行中的供电区间不再保留。
// 历史故障记录（迁移前已在故障停用）的区间不在清除范围，按原区间兼容。
const INTERMEDIATE_FIELDS = ['供电开始', '供电结束']

export function isPowerOff(status: unknown): boolean {
  return POWER_OFF_STATUSES.has(String(status))
}

export function isNegativeAction(action: string): boolean {
  return NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
}

// 缺字段统一补空串：存量缺电压的数据按空迁移，列表、详情、导出看到同一份结论。
export function normalizeEntry(row: EntryRow, fields: string[]): EntryRow {
  const next = { ...row }
  for (const field of fields) {
    if (next[field] === undefined || next[field] === null) {
      next[field] = ''
    }
  }
  return next
}

// 停用报修时清除中间态：进行中的供电区间清空，状态流转本身由 local-service 负责。
export function clearIntermediateState(row: EntryRow): EntryRow {
  const next = { ...row }
  for (const field of INTERMEDIATE_FIELDS) {
    next[field] = ''
  }
  return next
}

export function countStatus(rows: EntryRow[], status: string): number {
  return rows.filter((row) => String(row.status) === status).length
}

// 列表状态汇总：地面电源与装卸设备清单共用同一份计数结论。
export function summarizeStatuses(
  rows: EntryRow[],
  statuses: string[],
): { status: string; count: number }[] {
  return statuses.map((status) => ({ status, count: countStatus(rows, status) }))
}
