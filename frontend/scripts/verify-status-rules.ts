// 行为验证：模拟 localStorage，跑状态规则的关键结论。
import assert from 'node:assert'

// 模拟浏览器 localStorage（local-store 在调用时才读 window，先装好再调函数即可）
const store = new Map<string, string>()
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
}

import { exportEntries, listEntries, runAction } from '../src/api/local-service'
import { invalidateCache, storageKey } from '../src/data/local-store'
import { isPowerOff, summarizeStatuses } from '../src/data/status-rules'

function main() {
  // ---- 1. 存量缺电压数据迁移为空 + 历史故障记录按原区间兼容 ----
  store.set(
    storageKey(),
    JSON.stringify({
      ground_power: [
        {
          id: 1,
          status: '供电中',
          pending: true,
          abnormal: false,
          设备编号: 'GROU-0001',
          设备类型: '静变电源',
          所属机位: '101',
          // 缺 输出电压、额定电流、设备状态
          供电开始: '2026-09-01 08:00',
          供电结束: '',
        },
        {
          id: 2,
          status: '故障停用',
          pending: false,
          abnormal: true,
          设备编号: 'GROU-0002',
          设备类型: '静变电源',
          所属机位: '102',
          输出电压: '400Hz/115V',
          额定电流: '90kVA',
          供电开始: '2026-08-01 09:00',
          供电结束: '2026-08-01 11:30',
          设备状态: '故障停用',
        },
      ],
    }),
  )
  invalidateCache()

  let items = listEntries('ground_power').items
  assert.strictEqual(items[0]['输出电压'], '', '缺电压应迁移为空串')
  assert.strictEqual(items[0]['额定电流'], '', '缺额定电流应迁移为空串')
  assert.strictEqual(items[0]['设备状态'], '', '缺设备状态应迁移为空串')
  assert.strictEqual(items[0]['供电开始'], '2026-09-01 08:00', '已有供电开始不动')
  assert.strictEqual(items[1]['供电开始'], '2026-08-01 09:00', '历史故障记录的供电开始按原区间兼容')
  assert.strictEqual(items[1]['供电结束'], '2026-08-01 11:30', '历史故障记录的供电结束按原区间兼容')

  // 迁移结果要落库
  const persisted = JSON.parse(store.get(storageKey())!)
  assert.strictEqual(persisted.ground_power[0]['输出电压'], '', '迁移结果要写回存储')
  assert.strictEqual(persisted.ground_power[1]['供电结束'], '2026-08-01 11:30', '落库不动历史区间')

  // ---- 2. 停用报修要清除中间态 ----
  const repair = runAction('ground_power', 1, '停用报修')
  assert.strictEqual(repair.ok, true, repair.message)
  items = listEntries('ground_power').items
  assert.strictEqual(items[0].status, '故障停用')
  assert.strictEqual(items[0]['供电开始'], '', '停用报修要清掉供电开始')
  assert.strictEqual(items[0]['供电结束'], '', '停用报修要清掉供电结束')
  assert.strictEqual(items[0].pending, false, '停用报修后不再是待处理中间态')
  assert.strictEqual(items[0].abnormal, true, '停用报修标记异常')

  // ---- 3. 同一设备并发提交断电只生效一次 ----
  store.set(
    storageKey(),
    JSON.stringify({
      ground_power: [
        {
          id: 7,
          status: '供电中',
          pending: true,
          abnormal: false,
          设备编号: 'GROU-0007',
          设备类型: '静变电源',
          所属机位: '107',
          输出电压: '400Hz/115V',
          额定电流: '90kVA',
          供电开始: '2026-10-07 08:00',
          供电结束: '',
          设备状态: '供电中',
        },
      ],
    }),
  )
  invalidateCache()
  const first = runAction('ground_power', 7, '结束供电')
  const second = runAction('ground_power', 7, '结束供电')
  assert.strictEqual(first.ok, true, '第一次断电生效')
  assert.strictEqual(second.ok, false, '并发的第二次断电不再生效')
  assert.match(second.message, /不用重复操作/)
  assert.strictEqual(listEntries('ground_power').items.filter((r) => r.status === '已断电').length, 1)

  // ---- 4. 断电判定与列表/导出共用结论 ----
  assert.strictEqual(isPowerOff('已断电'), true)
  assert.strictEqual(isPowerOff('故障停用'), true)
  assert.strictEqual(isPowerOff('待机'), true)
  assert.strictEqual(isPowerOff('供电中'), false)

  const summary = summarizeStatuses(listEntries('ground_power').items, ['待机', '供电中', '已断电', '故障停用'])
  assert.deepStrictEqual(
    summary.map((s) => [s.status, s.count]),
    [['待机', 0], ['供电中', 0], ['已断电', 1], ['故障停用', 0]],
  )

  const csv = exportEntries('ground_power').content
  const lines = csv.replace(/^\uFEFF/, '').split('\n')
  assert.strictEqual(lines[0], '编号,设备编号,设备类型,所属机位,输出电压,额定电流,供电开始,供电结束,设备状态,当前状态')
  assert.strictEqual(lines[1], '7,GROU-0007,静变电源,107,400Hz/115V,90kVA,2026-10-07 08:00,,供电中,已断电')

  // 导出与列表对缺字段结论一致：再灌一条缺电压的，导出应输出空而不是 undefined
  store.set(
    storageKey(),
    JSON.stringify({
      ground_power: [
        { id: 9, status: '待机', pending: true, abnormal: false, 设备编号: 'GROU-0009', 所属机位: '109' },
      ],
    }),
  )
  invalidateCache()
  const csv2 = exportEntries('ground_power').content.replace(/^\uFEFF/, '')
  assert.ok(!csv2.includes('undefined'), '导出不能出现 undefined')
  assert.strictEqual(csv2.split('\n')[1], '9,GROU-0009,,109,,,,,,待机')

  // 装卸设备清单共用结论：缺字段同样补空，状态汇总同一套
  store.set(
    storageKey(),
    JSON.stringify({
      load_equip: [
        { id: 1, status: '运行中', pending: true, abnormal: false, 设备编号: 'LOAD-0001' },
        { id: 2, status: '已报修', pending: false, abnormal: true, 设备编号: 'LOAD-0002' },
      ],
    }),
  )
  invalidateCache()
  const loadItems = listEntries('load_equip').items
  assert.strictEqual(loadItems[0]['设备状态'], '', '装卸设备缺设备状态也按空迁移')
  const loadSummary = summarizeStatuses(loadItems, ['待机', '运行中', '维保中', '已报修'])
  assert.deepStrictEqual(
    loadSummary.map((s) => [s.status, s.count]),
    [['待机', 0], ['运行中', 1], ['维保中', 0], ['已报修', 1]],
  )

  console.log('全部行为验证通过')
}

main()
