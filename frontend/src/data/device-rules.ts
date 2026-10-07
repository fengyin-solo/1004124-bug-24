import type { EntryRow } from './types'

/**
 * 设备类模块共用的状态规则：地面电源的断电判定只有这一份结论，
 * 列表、详情、导出以及装卸设备清单都从这里取，不允许再各写一套。
 */

// 五个字段的规范写法：模块元数据、存量迁移、页面展示统一引用，不再出现第二种字面量。
export const DEVICE_CODE_FIELD = '设备编号'
export const DEVICE_STAND_FIELD = '所属机位'
export const DEVICE_VOLTAGE_FIELD = '输出电压'
export const DEVICE_CURRENT_FIELD = '额定电流'
export const DEVICE_STATUS_FIELD = '设备状态'

/** 参与统一写法的规范字段（设备类型不属于历史上两套写法的范围，留在各模块自用）。 */
export const CANONICAL_DEVICE_FIELDS = [
  DEVICE_CODE_FIELD,
  DEVICE_STAND_FIELD,
  DEVICE_VOLTAGE_FIELD,
  DEVICE_CURRENT_FIELD,
  DEVICE_STATUS_FIELD,
] as const

// 存量数据里出现过的旧写法 -> 规范字段，读取时按这里归一，避免老数据被判定成缺字段。
const FIELD_ALIASES: Record<string, readonly string[]> = {
  [DEVICE_CODE_FIELD]: ['设备编码', '设备ID', '编号'],
  [DEVICE_STAND_FIELD]: ['所在机位', '机位编号', '机位'],
  [DEVICE_VOLTAGE_FIELD]: ['输出电压(V)', '输出电压值', '额定电压', '电压'],
  [DEVICE_CURRENT_FIELD]: ['额定电流(A)', '额定电流值', '电流'],
  [DEVICE_STATUS_FIELD]: ['状态', '运行状态'],
}

export type DeviceVerdict = {
  /** 归一后的规范状态，列表/详情/导出展示的就是它 */
  status: string
  /** 是否处于断电结论 */
  poweredOff: boolean
  /** 是否处于故障/报修结论 */
  fault: boolean
  /** 是否终态：已断电、故障停用都不能再挂中间态 */
  terminal: boolean
}

export type DeviceRule = {
  key: string
  /** 该模块需要按规范字段统一写法的字段清单 */
  fields: readonly string[]
  statuses: readonly string[]
  standbyStatus: string
  /** 该模块的断电结论状态；装卸设备不断电，给空串 */
  offStatus: string
  faultStatus: string
  /** 是否跟踪输出电压（只有地面电源跟踪，缺电压迁移为空） */
  trackVoltage: boolean
  /** 历史故障记录里出现过的旧写法：保留原区间语义，只把结论归一到故障态 */
  faultAliases: ReadonlySet<string>
}

// 地面电源：待机 -> 供电中 -> 已断电，另有故障停用。
export const GROUND_POWER_RULE: DeviceRule = {
  key: 'ground_power',
  fields: CANONICAL_DEVICE_FIELDS,
  statuses: ['待机', '供电中', '已断电', '故障停用'],
  standbyStatus: '待机',
  offStatus: '已断电',
  faultStatus: '故障停用',
  trackVoltage: true,
  faultAliases: new Set(['故障', '设备故障', '故障停机', '报修停用', '停用报修', '停用']),
}

// 装卸设备：复用同一套判定与归一机制，只是状态词表不同、不跟踪电压。
export const LOAD_EQUIP_RULE: DeviceRule = {
  key: 'load_equip',
  fields: [DEVICE_CODE_FIELD, DEVICE_STATUS_FIELD],
  statuses: ['待机', '运行中', '维保中', '已报修'],
  standbyStatus: '待机',
  offStatus: '',
  faultStatus: '已报修',
  trackVoltage: false,
  faultAliases: new Set(['故障', '设备故障', '报修中', '停用报修', '故障停用']),
}

export const DEVICE_RULE_BY_KEY: Map<string, DeviceRule> = new Map([
  [GROUND_POWER_RULE.key, GROUND_POWER_RULE],
  [LOAD_EQUIP_RULE.key, LOAD_EQUIP_RULE],
])

/** 按规范字段读值，规范键缺失时回退旧写法；返回 [值, 是否命中]。 */
export function readField(
  row: EntryRow,
  field: string,
): [value: string | number | boolean | undefined, found: boolean] {
  if (field in row && row[field] !== undefined && row[field] !== null) {
    return [row[field], true]
  }
  for (const alias of FIELD_ALIASES[field] ?? []) {
    if (alias in row && row[alias] !== undefined && row[alias] !== null) {
      return [row[alias], true]
    }
  }
  return [undefined, false]
}

/** 存量缺电压数据迁移为空：null/undefined/缺键统一成空串，不臆造 0V、不误判断电。 */
export function migrateVoltage(value: string | number | boolean | undefined, found: boolean): string {
  if (!found || value === null || value === undefined) {
    return ''
  }
  return String(value)
}

function statusSource(row: EntryRow): string {
  const current = String(row.status ?? '').trim()
  if (current !== '') {
    return current
  }
  const [legacy, found] = readField(row, DEVICE_STATUS_FIELD)
  return found ? String(legacy).trim() : ''
}

/**
 * 同一份断电判定结论：
 * - row.status 与「设备状态」字段两处写法，以本函数归一后的结论为准；
 * - 历史故障记录（旧状态词）按原区间兼容，只把结论归一到故障态，不改动任何时间字段；
 * - 不认识的历史状态原样保留，不强行翻转结论。
 */
export function resolveVerdict(row: EntryRow, rule: DeviceRule): DeviceVerdict {
  const source = statusSource(row)
  let status = source
  if (source !== '' && !rule.statuses.includes(source)) {
    if (rule.faultAliases.has(source)) {
      status = rule.faultStatus
    }
  }
  if (status === '') {
    status = rule.standbyStatus
  }
  const poweredOff = rule.offStatus !== '' && status === rule.offStatus
  const fault = status === rule.faultStatus
  const terminal = poweredOff || fault
  return { status, poweredOff, fault, terminal }
}

/** 列表/详情/导出共用的唯一投影：规范字段单一写法，状态只写一份结论。 */
export function projectDeviceRow(row: EntryRow, rule: DeviceRule): EntryRow {
  const next: EntryRow = { ...row }
  for (const field of rule.fields) {
    const [value, found] = readField(row, field)
    if (field === DEVICE_VOLTAGE_FIELD && rule.trackVoltage) {
      next[field] = migrateVoltage(value, found)
    } else {
      next[field] = found ? value ?? '' : ''
    }
  }
  const verdict = resolveVerdict(row, rule)
  next.status = verdict.status
  next[DEVICE_STATUS_FIELD] = verdict.status
  // 终态（已断电 / 故障报修）必须清掉中间态标记，不依赖状态数组里的排列顺序。
  if (verdict.terminal) {
    next.pending = false
  }
  return next
}

/** 存量数据迁移：缺电压补空串、旧字段名与历史故障写法归一；无变化时返回原数组。 */
export function migrateDeviceRows(rows: EntryRow[], rule: DeviceRule): EntryRow[] {
  let changed = false
  const projected = rows.map((row) => {
    const next = projectDeviceRow(row, rule)
    if (JSON.stringify(row) !== JSON.stringify(next)) {
      changed = true
    }
    return next
  })
  return changed ? projected : rows
}
