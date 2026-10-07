<template>
  <section class="page" data-module="ground_power">
    <header class="page-head">
      <div>
        <h2>地面电源管理</h2>
        <p class="page-desc">维护地面电源，围绕设备编号、设备类型、所属机位、输出电压做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记地面电源</button>
        <button class="btn" type="button" @click="exportRows">导出地面电源清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <button v-if="column === codeField" class="link" type="button" @click="openDetail(row)">
              {{ row[column] || '—' }}
            </button>
            <template v-else>{{ row[column] === '' || row[column] == null ? '—' : row[column] }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无地面电源数据，可先登记地面电源</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条地面电源记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detail" class="detail-mask" @click.self="closeDetail">
      <div class="detail-panel" role="dialog" aria-modal="true" aria-label="地面电源详情">
        <header class="detail-head">
          <h3>地面电源详情</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <table class="data-table">
          <tbody>
            <tr v-for="field in meta.fields" :key="field">
              <th>{{ field }}</th>
              <td>{{ detail[field] === '' || detail[field] == null ? '—' : detail[field] }}</td>
            </tr>
            <tr>
              <th>当前状态</th>
              <td>{{ detail.status }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { DEVICE_CODE_FIELD, DEVICE_STATUS_FIELD } from '@/data/device-rules'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('ground_power')
// 字段、状态、动作只认模块元数据这一份，页面不再硬编码第二套字面量。
const codeField = DEVICE_CODE_FIELD
const columns = meta.fields.filter((field) => field !== DEVICE_STATUS_FIELD)
const actions = meta.actions
const statuses = meta.statuses
const stats = meta.metrics.map((label) => ({ label, value: 0 }))

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const detail = ref<EntryRow | null>(null)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '地面电源登记入口尚未接入审批流'
}

// 详情与列表、导出走同一投影：这里拿到的状态就是共享规则给出的结论。
function openDetail(row: EntryRow) {
  detail.value = getEntry(meta.key, Number(row.id))
}

function closeDetail() {
  detail.value = null
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  if (detail.value && Number(detail.value.id) === Number(row.id)) {
    openDetail(row)
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '地面电源列表读取失败'
  }
}

onMounted(reload)
</script>
