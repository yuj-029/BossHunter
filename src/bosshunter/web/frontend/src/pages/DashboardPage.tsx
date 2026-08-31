import { useEffect, useMemo, useState } from 'react'
import { useDashboard, type CollectionProgress, type HistoryItem, type Job, type WorkbenchTask } from '@/hooks/useDashboard'
import { useJobSearch, type JobSortKey, type JobSortOrder } from '@/hooks/useJobSearch'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { DialogShell } from '@/components/ui/dialog-shell'
import { EmptyState, PageSkeleton } from '@/components/ui/async-state'
import { PageHeader } from '@/components/layout/PageHeader'
import { JobsTable } from '@/components/dashboard/JobsTable'
import { RecycleBinPanel } from '@/components/dashboard/RecycleBinPanel'
import { ScoreJobsDialog } from '@/components/dashboard/ScoreJobsDialog'
import { TailoredResumePreviewDialog } from '@/components/dashboard/TailoredResumePreviewDialog'
import { CustomGreetingDialog } from '@/components/dashboard/CustomGreetingDialog'
import { CollectJobsDialog } from '@/components/dashboard/CollectJobsDialog'
import { JobFilterBar } from '@/components/jobs/JobFilterBar'
import { parseHistoryDetail } from '@/lib/historyDetail'
import {
  EMPTY_JOB_FILTERS,
  filterJobs,
  hasInvalidSalaryRange,
  useDebouncedValue,
  type JobFilters,
} from '@/lib/jobFilters'
import { getActionLabel, getStatusLabel } from '@/lib/status'
import { cn } from '@/lib/utils'
import { useSessionState } from '@/lib/useSessionState'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  BriefcaseBusiness,
  Download,
  ExternalLink,
  Eye,
  MessageCircle,
  Play,
  RefreshCw,
  Send,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react'

type WorkbenchMode = 'full' | 'collect' | 'rescore' | 'monitor'
type StatsScope = 'today' | 'total'

const TASK_STAGE_LABELS = [
  '开始采集岗位',
  '开始 AI 评分',
  '开始重新评分',
  'AI 评分进度',
  '等待前端确认投递',
  '发送失败待处理',
  '执行一轮监测',
  '本轮监测完成，30 分钟后再次检查',
]

function currentTaskStage(logs: string[] = []) {
  for (const log of logs.slice().reverse()) {
    if (log.includes('AI 评分进度')) return log
    if (log.includes('招呼语发送结果')) return log
    if (log.includes('发送招呼语')) return '发送招呼语'
    if (log.includes('生成招呼语')) return '生成招呼语'
    const stage = TASK_STAGE_LABELS.find(label => log.includes(label))
    if (stage) return stage
  }
  return '等待后端返回阶段'
}

function taskStatusText(status: string) {
  if (status === 'failed') return '运行失败'
  if (status === 'completed') return '已结束'
  if (status === 'stopped') return '已停止'
  if (status === 'stopping') return '停止中'
  return '运行中'
}

function taskStatusClass(status: string) {
  if (status === 'failed') return 'border-red-100 bg-red-50'
  if (status === 'completed' || status === 'stopped') return 'border-card-border bg-white'
  return 'border-primary/20 bg-surface-accent'
}

function taskStatusTitle(status: string) {
  if (status === 'completed' || status === 'stopped') return '最近任务状态'
  return '当前阶段'
}

function taskStopReasonLabel(reason?: string) {
  if (reason === 'daily_limit') return '今日发送额度已用完，岗位已保留在“待发送招呼语”；明日额度恢复后再重试。'
  if (reason === 'outside_window') return '当前不在发送时间窗口内，岗位已保留在“待发送招呼语”。'
  if (reason === 'day_off') return '今日触发防检测休息策略，岗位已保留在“待发送招呼语”。'
  if (reason === 'stopped') return '任务已按你的要求停止，尚未处理的岗位仍保留在队列中。'
  return reason
}

function taskErrorFeedback(error: string) {
  const normalized = error.toLowerCase()
  if (
    normalized.includes('api key')
    || normalized.includes('authentication')
    || normalized.includes('unauthorized')
    || normalized.includes('401')
    || normalized.includes('403')
  ) {
    return {
      title: 'AI 接口认证失败',
      detail: '请到“配置 → AI 设置”检查 API Key、Base URL 和模型名称，保存后点击“测试连接”。',
    }
  }
  if (
    normalized.includes('chrome')
    || normalized.includes('cdp')
    || normalized.includes('websocket')
    || normalized.includes('browser runtime')
    || normalized.includes('not connected')
  ) {
    return {
      title: 'Google Chrome 连接中断',
      detail: '请确认 Google Chrome 正在运行且已开启远程调试，再点击上方“重新检查”。',
    }
  }
  if (normalized.includes('zhipin') || normalized.includes('登录') || normalized.includes('login')) {
    return {
      title: '招聘平台页面或登录状态异常',
      detail: '请在已连接的 Google Chrome 中打开 BOSS 直聘并确认账号仍处于登录状态。',
    }
  }
  return {
    title: '任务运行失败',
    detail: '请查看原始错误；修复配置或连接问题后，重新运行启动检查。',
  }
}

interface PreflightCheck {
  id: string
  title: string
  status: 'pass' | 'warning' | 'error'
  message: string
  detail: string
  action?: 'config' | 'browser' | ''
}

const modes: Array<{ mode: WorkbenchMode; title: string; description: string }> = [
  {
    mode: 'full',
    title: '采集并评分',
    description: '采集 → API AI评分 → 进入待确认；不自动生成或发送招呼语。',
  },
  {
    mode: 'collect',
    title: '单独采集',
    description: '打开岗位采集窗口，选择 BOSS/智联/51job、最大页数、排序和执行顺序；默认只采集不评分。',
  },
  {
    mode: 'monitor',
    title: '单独监测',
    description: '只监测过往已投递项目；发现 HR 要简历或问题后进入对应处理。',
  },
]

const statItems = [
  { key: '采集总数', todayLabel: '今日新增岗位', totalLabel: '累计采集岗位' },
  { key: '初筛通过', todayLabel: '今日初筛通过', totalLabel: '累计初筛通过', highlight: true },
  { key: 'AI评分', todayLabel: '今日 AI 评分', totalLabel: '累计 AI 评分' },
  { key: 'pending', todayLabel: '当前待确认', totalLabel: '当前待确认', highlight: true, current: true },
  { key: '发送', todayLabel: '今日已投递', totalLabel: '累计已投递', highlight: true },
]

const taskMetricItems = [
  { key: 'collect_seen', label: '本轮扫描' },
  { key: 'collect_new', label: '本轮新增' },
  { key: 'collect_duplicate', label: '重复岗位' },
  { key: 'collect_filtered', label: '过滤' },
  { key: 'collect_parse_failed', label: '解析失败' },
  { key: 'collect_save_failed', label: '保存失败' },
  { key: 'ai_passed', label: 'AI通过' },
  { key: 'ai_filtered', label: 'AI过滤' },
  { key: 'ai_failed', label: 'AI失败' },
  { key: 'send_success', label: '发送成功' },
  { key: 'send_deferred', label: '待下次发送' },
  { key: 'send_remaining_quota', label: '今日剩余额度' },
]

function jobSubtitle(job: Job) {
  return [job.score ? `匹配 ${job.score}` : '', job.salary, job.hr_active || '活跃度未知', getStatusLabel(job.status)].filter(Boolean).join(' · ')
}

async function parsePreflightResponse(res: Response) {
  const rawText = await res.text()
  let data: { ok?: boolean; messages?: unknown; checks?: unknown; error?: string } = {}
  try {
    data = rawText ? JSON.parse(rawText) : {}
  } catch {
    const message = `无法解析预检响应：预检接口返回 ${res.status}`
    return {
      ok: false,
      messages: [message],
      checks: [{ id: 'preflight_api', title: '启动检查', status: 'error', message, detail: '请重启 BossHunter 后重试。' }] as PreflightCheck[],
    }
  }
  const messages = Array.isArray(data.messages) ? data.messages.map(String).filter(Boolean) : []
  const checks = Array.isArray(data.checks)
    ? data.checks.filter((item): item is PreflightCheck => Boolean(
      item
      && typeof item === 'object'
      && 'id' in item
      && 'status' in item
      && 'message' in item
    ))
    : []
  if (data.error) messages.push(String(data.error))
  if (!res.ok) messages.push(`预检接口返回 ${res.status}`)
  if (!data.ok && messages.length === 0) messages.push('后端未返回具体原因')
  if (checks.length === 0 && messages.length > 0) {
    checks.push(...messages.map((message, index) => ({
      id: `legacy-${index}`,
      title: '启动检查',
      status: 'error' as const,
      message,
      detail: '请按提示修复后重新检测。',
    })))
  }
  return { ok: Boolean(res.ok && data.ok), messages, checks }
}

function PreflightPanel({
  checks,
  checking,
  onRetry,
}: {
  checks: PreflightCheck[]
  checking: boolean
  onRetry: () => void
}) {
  const navigate = useNavigate()
  const actionableChecks = checks.filter(check => check.status !== 'pass')
  if (actionableChecks.length === 0) return null

  const errors = actionableChecks.filter(check => check.status === 'error').length
  const warnings = actionableChecks.filter(check => check.status === 'warning').length
  const needsConfig = actionableChecks.some(check => check.action === 'config')
  const heading = errors ? `启动检查发现 ${errors} 个问题` : `启动检查有 ${warnings} 项提醒`

  return (
    <div className={`mt-3 rounded-2xl border p-4 ${
      errors ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
    }`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {errors
            ? <XCircle className="h-5 w-5 text-danger" />
            : <AlertTriangle className="h-5 w-5 text-amber-600" />}
          <div className="text-sm font-black text-foreground">{heading}</div>
        </div>
        <div className="flex items-center gap-2">
          {needsConfig && (
            <Button variant="secondary" size="sm" onClick={() => navigate('/config')}>
              打开配置
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onRetry} disabled={checking}>
            <RefreshCw className={`mr-2 h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? '检查中' : '重新检查'}
          </Button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {actionableChecks.map(check => {
          const isError = check.status === 'error'
          return (
            <div
              key={`${check.id}-${check.title}`}
              className={`rounded-2xl border bg-white px-3 py-3 ${isError ? 'border-red-200' : 'border-amber-200'}`}
            >
              <div className="flex items-start gap-2">
                {isError
                  ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                <div>
                  <div className="text-xs font-black text-muted">{check.title}</div>
                  <div className="mt-0.5 text-sm font-black text-foreground">{check.message}</div>
                  <p className="mt-1 text-xs leading-5 text-muted">{check.detail}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const {
    workbench,
    loading,
    error,
    refreshing,
    lastRefreshedAt,
    refresh,
    startTask,
    stopTask,
  } = useDashboard('workbench')
  const [selected, setSelected] = useSessionState<string[]>('bosshunter.workbench.selected', [])
  const [notice, setNotice] = useState('')
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[]>([])
  const [preflightMode, setPreflightMode] = useState<WorkbenchMode>('full')
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [modePending, setModePending] = useState<WorkbenchMode | null>(null)
  const [confirmedDeliveryIds, setConfirmedDeliveryIds] = useState<Set<string>>(new Set())
  const [todayFilters, setTodayFilters] = useSessionState<JobFilters>('bosshunter.workbench.filters', { ...EMPTY_JOB_FILTERS })
  const [statsScope, setStatsScope] = useSessionState<StatsScope>('bosshunter.workbench.statsScope', 'today')
  const [collectDialogOpen, setCollectDialogOpen] = useState(false)
  const [collectDialogMode, setCollectDialogMode] = useState<'collect' | 'full'>('collect')
  const [greetingJob, setGreetingJob] = useState<Job | null>(null)

  const todayJobs = useMemo(
    () => workbench.pending_confirmation.filter(job => !confirmedDeliveryIds.has(job.id)),
    [workbench.pending_confirmation, confirmedDeliveryIds]
  )
  const debouncedTodayQuery = useDebouncedValue(todayFilters.query, 250)
  const effectiveTodayFilters = useMemo(
    () => ({ ...todayFilters, query: debouncedTodayQuery }),
    [todayFilters, debouncedTodayQuery]
  )
  const filteredTodayJobs = useMemo(
    () => filterJobs(todayJobs, effectiveTodayFilters),
    [todayJobs, effectiveTodayFilters]
  )
  const visibleJobIds = useMemo(() => new Set(filteredTodayJobs.map(job => job.id)), [filteredTodayJobs])
  const actionableSelected = useMemo(() => selected.filter(id => visibleJobIds.has(id)), [selected, visibleJobIds])

  useEffect(() => {
    setSelected(previous => {
      const next = previous.filter(id => visibleJobIds.has(id))
      return next.length === previous.length ? previous : next
    })
  }, [visibleJobIds])

  useEffect(() => {
    const handleConfigSaved = () => { void refresh() }
    window.addEventListener('bosshunter-config-saved', handleConfigSaved)
    return () => window.removeEventListener('bosshunter-config-saved', handleConfigSaved)
  }, [refresh])

  const pendingGreetingJobs = workbench.pending_greetings
  const automatedGreetingEnabled = workbench.automated_greeting_enabled
  const activeTask = workbench.task
  const visibleTask = activeTask || workbench.last_task
  const visibleTaskError = visibleTask?.error ? taskErrorFeedback(visibleTask.error) : null
  const todayPendingScoreCount = Math.max(
    0,
    (workbench.funnel_today['初筛通过'] || 0) - (workbench.funnel_today['AI评分'] || 0)
  )

  const toggleJob = (id: string) => {
    setSelected(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]))
  }

  const runPreflight = async (mode: WorkbenchMode, options?: Record<string, unknown>) => {
    setPreflightMode(mode)
    const res = options
      ? await fetch('/api/workbench/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, options }),
      })
      : await fetch(`/api/workbench/preflight?mode=${mode}`)
    const data = await parsePreflightResponse(res)
    setPreflightChecks(data.checks)
    if (!data.ok) {
      setNotice('请按提示处理后再启动')
      return false
    }
    return true
  }

  const handleModeClick = async (mode: WorkbenchMode) => {
    try {
      if (activeTask?.mode === mode) {
        if (window.confirm(`是否停止当前${activeTask.label}任务？已入库岗位会保留。`)) {
          setModePending(mode)
          setNotice(`正在停止${activeTask.label}...`)
          await stopTask(activeTask.id)
          setNotice(`${activeTask.label}已请求停止。`)
        }
        return
      }
      if (modePending) return
      if (activeTask) {
        setNotice(
          activeTask.status === 'stopping'
            ? `当前${activeTask.label}正在停止，请等待后台完全结束后再启动其他模式。`
            : `当前正在运行${activeTask.label}，请先点击橙色卡片停止后再启动其他模式。`
        )
        return
      }
      if (mode === 'full') {
        setCollectDialogMode('full')
        setCollectDialogOpen(true)
        return
      }
      const target = modes.find(item => item.mode === mode)
      setModePending(mode)
      setNotice(`${target?.title || '任务'}启动前预检中...`)
      if (!(await runPreflight(mode))) return
      setNotice(`${target?.title || '任务'}启动中，请稍候...`)
      await startTask(mode)
      setNotice(`${target?.title || '任务'}已启动，日志会在下方更新。`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '操作失败')
    } finally {
      setModePending(null)
    }
  }

  const retryPreflight = async () => {
    if (modePending) return
    try {
      setModePending(preflightMode)
      setNotice('正在重新检查运行环境...')
      const ok = await runPreflight(preflightMode)
      setNotice(ok ? '' : '仍有问题需要处理，请查看检查结果。')
    } catch {
      setNotice('重新检查失败，请确认 BossHunter 后端仍在运行。')
    } finally {
      setModePending(null)
    }
  }

  const startCollection = async (options: Record<string, unknown>) => {
    const mode = collectDialogMode
    setModePending(mode)
    setNotice(mode === 'full' ? '全流程启动前预检中...' : '岗位采集启动前预检中...')
    try {
      if (!(await runPreflight(mode, options))) return
      await startTask(mode, options)
      setCollectDialogOpen(false)
      setNotice(mode === 'full' ? '全流程已启动，进度会在下方更新。' : '岗位采集已启动，进度会在下方更新。')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '岗位采集启动失败')
    } finally {
      setModePending(null)
    }
  }

  const confirmDeliver = async (ids: string[]) => {
    if (!ids.length) return
    const count = ids.length
    const manualOnly = !automatedGreetingEnabled
    const confirmation = manualOnly
      ? `是否确认投递以下 ${count} 个岗位？系统不会自动生成或发送招呼语，确认后请在 BOSS 手动沟通。`
      : `是否投递以下 ${count} 个岗位？确认后将进入投递/打招呼流程。`
    if (!window.confirm(confirmation)) return
    try {
      const res = await fetch('/api/workbench/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids: ids, manual_only: manualOnly }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '投递失败')
      }
      const data = await res.json().catch(() => ({}))
      if (!ids.some(id => workbench.send_errors.some(job => job.id === id))) {
        setConfirmedDeliveryIds(prev => new Set([...prev, ...ids]))
      }
      await refresh()
      if (data.manual_only) {
        setNotice(`已确认投递 ${data.approved_count ?? count} 个岗位；自动打招呼保持关闭，请打开岗位链接手动完成沟通。`)
        setSelected(prev => prev.filter(id => !new Set(ids).has(id)))
        return
      }
      setNotice(
        data.already_queued_count === count
          ? `所选 ${count} 个岗位已在当前发送队列中。`
          : data.queued_count
            ? `已将 ${data.queued_count} 个岗位追加到当前发送队列。`
            : `已确认投递 ${count} 个岗位，后端会按队列推进。`
      )
      setSelected(prev => prev.filter(id => !new Set(ids).has(id)))
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '投递失败')
    }
  }

  const rejectSelectedJobs = async (ids: string[]) => {
    if (!ids.length) return
    const count = ids.length
    if (!window.confirm(`确定放弃这 ${count} 个岗位吗？放弃后不会进入投递，可在岗位池中查看已拒绝状态。`)) return
    try {
      const res = await fetch('/api/workbench/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids: ids }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '放弃失败')
      }
      const rejectedIds = new Set(ids)
      setSelected(prev => prev.filter(id => !rejectedIds.has(id)))
      setConfirmedDeliveryIds(prev => new Set([...prev, ...ids]))
      await refresh()
      setNotice(`已放弃 ${count} 个岗位。`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '放弃失败')
    }
  }

  const sendReadyGreetings = async (ids: string[]) => {
    if (!ids.length) return
    const count = ids.length
    try {
      const res = await fetch('/api/workbench/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids: ids, direct_send: true }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '发送失败')
      }
      const data = await res.json().catch(() => ({}))
      await refresh()
      setNotice(
        data.already_queued_count === count
          ? `所选 ${count} 个岗位已在当前发送队列中，请等待依次发送。`
          : data.queued_count
            ? `已将 ${data.queued_count} 个岗位追加到当前发送队列。`
            : `已直接进入发送流程 ${count} 个岗位。`
      )
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '发送失败')
    }
  }

  const openJobDetail = async (job: Job) => {
    try {
      const res = await fetch(`/api/jobs/${job.id}`)
      if (!res.ok) throw new Error('读取岗位详情失败')
      setSelectedJob(await res.json())
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '读取岗位详情失败')
    }
  }

  const downloadResume = (job: Job) => {
    window.open(`/api/jobs/${job.id}/resume/download`, '_blank')
  }

  const markResumeSent = async (job: Job) => {
    try {
      const res = await fetch(`/api/jobs/${job.id}/mark-resume-sent`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '标记失败')
      }
      await refresh()
      setNotice(`已标记 ${job.company}｜${job.title} 的定制简历已发送。`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '标记失败')
    }
  }

  if (loading) {
    return <PageSkeleton label="正在读取今日求职行动..." />
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="TODAY WORKBENCH"
        title="今日求职行动"
        description="集中处理岗位采集、AI 评分、人工确认和后续跟进。"
        actions={(
          <>
            <div className="text-right">
              <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing}>
                <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
                {refreshing ? '刷新中' : '刷新'}
              </Button>
              {lastRefreshedAt && (
                <div className="mt-1 text-[10px] text-muted">
                  最后刷新：{lastRefreshedAt.toLocaleTimeString('zh-CN', { hour12: false })}
                </div>
              )}
            </div>
            <span className="rounded-full bg-surface-accent px-3 py-2 text-xs font-black text-primary">
              {activeTask ? `${activeTask.label}中` : '当前空闲'}
            </span>
          </>
        )}
      />
      <section id="today-workbench" className="scroll-mt-6 rounded-2xl border border-card-border bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {modes.map(item => {
            const isActive = activeTask?.mode === item.mode
            const disabled = Boolean(activeTask && !isActive)
            return (
              <button
                key={item.mode}
                onClick={() => {
                  if (isActive) {
                    void handleModeClick(item.mode)
                    return
                  }
                  if (disabled) {
                    setNotice(`当前正在运行${activeTask?.label || '其他任务'}，请先停止后再启动岗位采集。`)
                    return
                  }
                  if (item.mode === 'collect' || item.mode === 'full') {
                    setCollectDialogMode(item.mode)
                    setCollectDialogOpen(true)
                  }
                  else void handleModeClick(item.mode)
                }}
                aria-disabled={disabled}
                className={`min-h-[126px] rounded-2xl p-5 text-left transition ${
                  isActive
                    ? 'border-2 border-primary bg-primary text-white shadow-xl shadow-primary/20'
                    : disabled
                      ? 'cursor-not-allowed border border-card-border bg-white text-muted opacity-45'
                      : 'border border-card-border bg-surface-subtle text-foreground hover:border-primary/60 hover:shadow-md'
                }`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-lg font-black">
                    {modePending === item.mode
                      ? isActive ? '任务停止中' : '任务启动中'
                      : isActive ? `${item.title}中` : item.title}
                  </div>
                  {isActive ? <Square className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5" />}
                </div>
                <p className={`text-xs leading-6 ${isActive ? 'text-white/85' : 'text-muted'}`}>{item.description}</p>
              </button>
            )
          })}
        </div>
        {notice && <div className="mt-3 rounded-2xl bg-surface-accent px-4 py-3 text-sm text-primary">{notice}</div>}
        {preflightChecks.some(check => check.status !== 'pass') && (
          <PreflightPanel checks={preflightChecks} checking={Boolean(modePending)} onRetry={retryPreflight} />
        )}
        {error && <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-danger">{error}</div>}
        {visibleTask && (
          <div className="mt-3 rounded-2xl border border-card-border bg-surface-subtle p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-black">任务运行状态</div>
                <p className="mt-1 text-xs leading-5 text-muted">如果点击后浏览器没有反应，请先打开 BOSS 直聘并确认已登录；常见失败原因是 BOSS 未登录或 Chrome 调试连接不可用。</p>
              </div>
              <span className="rounded-full bg-surface-accent px-3 py-1 text-xs font-black text-primary">
                {visibleTask.label}
              </span>
            </div>
            <div className={`mt-3 rounded-2xl border px-4 py-3 ${taskStatusClass(visibleTask.status)}`}>
              <div className="text-xs font-black text-primary">{taskStatusTitle(visibleTask.status)}</div>
              <div className="mt-1 text-lg font-black text-foreground">{currentTaskStage(visibleTask.logs)}</div>
              <div className="mt-1 text-xs font-bold text-muted">任务状态：{taskStatusText(visibleTask.status)}</div>
              {visibleTask.deadline_at && (
                <div className="mt-1 text-xs font-bold text-muted">
                  自动截止：{new Date(visibleTask.deadline_at).toLocaleString('zh-CN', { hour12: false })}
                </div>
              )}
              {visibleTask.metrics && taskMetricItems.some(item => item.key in visibleTask.metrics!) && (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {taskMetricItems.map(item => (
                    <div key={item.key} className="rounded-xl border border-card-border bg-white px-3 py-2">
                      <div className="text-[10px] font-bold text-muted">{item.label}</div>
                      <div className="mt-0.5 text-lg font-black text-foreground">{visibleTask.metrics?.[item.key] ?? 0}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {visibleTask.progress?.platforms && <CollectionProgressPanel progress={visibleTask.progress} />}
            {visibleTask.error && visibleTaskError && (
              <div className="mt-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-danger">
                <div className="font-black">{visibleTaskError.title}</div>
                <p className="mt-1 text-xs leading-5">{visibleTaskError.detail}</p>
                <details className="mt-2 text-xs text-muted">
                  <summary className="cursor-pointer font-bold">查看原始错误</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-white p-2">{visibleTask.error}</pre>
                </details>
              </div>
            )}
            {visibleTask.stop_reason && (
              <div className={`mt-3 rounded-2xl px-3 py-3 text-sm ${visibleTask.stop_reason === 'daily_limit' ? 'border border-amber-200 bg-amber-50 text-amber-800' : 'bg-surface-accent text-primary'}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-black">{visibleTask.stop_reason === 'daily_limit' ? '本次未发送' : '任务说明'}</div>
                    <div className="mt-1">{taskStopReasonLabel(visibleTask.stop_reason)}</div>
                  </div>
                  {visibleTask.stop_reason === 'daily_limit' && (
                    <Button size="sm" variant="secondary" onClick={() => navigate('/config?section=throttle')}>
                      去设置发送额度
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {automatedGreetingEnabled && workbench.send_quota?.exhausted && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black">今日发送额度已用完</h3>
              <p className="mt-1 text-sm leading-6">
                今日已发送 {workbench.send_quota.sent}/{workbench.send_quota.daily_limit} 条，未发送岗位已保留在“待发送招呼语”；明日额度恢复后再重试。
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/config?section=throttle')}>
              去设置发送额度
            </Button>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">求职数据</h3>
            <p className="mt-0.5 text-xs text-muted">今日看行动节奏，累计看岗位池沉淀。</p>
          </div>
          <div className="inline-flex rounded-full border border-card-border bg-white p-1">
            {([
              { value: 'today' as const, label: '今日数据' },
              { value: 'total' as const, label: '累计数据' },
            ]).map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatsScope(option.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-black transition ${
                  statsScope === option.value ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-primary'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {statItems.map(item => {
            const currentValue = workbench.pending_confirmation.length
            const selectedFunnel = statsScope === 'today' ? workbench.funnel_today : workbench.funnel
            const alternateFunnel = statsScope === 'today' ? workbench.funnel : workbench.funnel_today
            const value = item.current ? currentValue : (selectedFunnel[item.key] || 0)
            const supportingText = item.current
              ? '实时待处理数量'
              : `${statsScope === 'today' ? '累计' : '今日'} ${alternateFunnel[item.key] || 0}`
            return (
              <div key={item.key} className="rounded-2xl border border-card-border bg-white p-4">
                <div className="text-xs text-muted">{statsScope === 'today' ? item.todayLabel : item.totalLabel}</div>
                <div className={`mt-1 text-2xl font-black ${item.highlight ? 'text-primary' : 'text-foreground'}`}>
                  {value}
                </div>
                <div className="mt-1 text-[10px] font-bold text-muted">{supportingText}</div>
              </div>
            )
          })}
        </div>
        {todayPendingScoreCount > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div>
              <div className="text-sm font-black text-amber-900">今天还有 {todayPendingScoreCount} 条岗位待 AI 评分</div>
              <p className="mt-1 text-xs leading-5 text-amber-800">评分通过后才会进入“今日待确认”；点击后先展示请求数量和费用风险，不会直接开始评分。</p>
            </div>
            <Button size="sm" onClick={() => navigate('/jobs?score=pending')}>
              评分待处理 {todayPendingScoreCount} 条
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-card-border bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-black">优先处理：HR 要简历 / 定制简历下载</h3>
            <p className="mt-1 text-xs text-muted">首页只展示需要你手动下载并自行发给 HR 的定制简历事项。</p>
          </div>
          <Button variant="secondary" size="sm">查看全部简历事项</Button>
        </div>
        {workbench.needs_resume.length ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {workbench.needs_resume.slice(0, 4).map(job => (
              <div key={job.id} className="rounded-2xl border border-card-border bg-surface-subtle p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-black">{job.company}｜{job.title}</div>
                  <span className="rounded-full bg-surface-accent px-2 py-1 text-[11px] font-black text-primary">待发简历</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted">HR 已请求简历，系统已准备定制化简历下载入口。</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => downloadResume(job)}><Download className="mr-2 h-4 w-4" />下载定制简历</Button>
                  <Button variant="secondary" size="sm" onClick={() => markResumeSent(job)}>标记已发送</Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="当前没有 HR 要简历事项" />
        )}
      </section>

      {automatedGreetingEnabled && workbench.send_errors.length > 0 && (
        <section className="rounded-2xl border border-red-100 bg-red-50 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-danger">发送失败待处理</h3>
              <p className="mt-1 text-xs text-danger/80">这些岗位已生成招呼语，但没有成功发送。你可以重试，或放弃已失效岗位。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => confirmDeliver(workbench.send_errors.map(job => job.id))}>重新发送全部 {workbench.send_errors.length} 个</Button>
              <Button variant="secondary" size="sm" onClick={() => rejectSelectedJobs(workbench.send_errors.map(job => job.id))}>放弃全部</Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {workbench.send_errors.map(job => (
              <div key={job.id} className="rounded-2xl border border-red-100 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black">{job.company}｜{job.title}</div>
                    <div className="mt-1 text-xs text-danger">最近失败原因：{job.last_error || '发送失败，等待重试'}</div>
                  </div>
                  <span className="rounded-full bg-red-50 px-2 py-1 text-[11px] font-black text-danger">发送失败</span>
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted">{job.greeting || '招呼语已生成，等待重新发送。'}</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => sendReadyGreetings([job.id])}>重新发送</Button>
                  <Button variant="secondary" size="sm" onClick={() => rejectSelectedJobs([job.id])}>放弃</Button>
                  <Button variant="secondary" size="sm" onClick={() => openJobDetail(job)}><Eye className="mr-2 h-4 w-4" />查看详情</Button>
                  <Button variant="secondary" size="sm" disabled={!job.url} onClick={() => window.open(job.url, '_blank', 'noopener,noreferrer')}><ExternalLink className="mr-2 h-4 w-4" />跳转岗位链接</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {automatedGreetingEnabled && pendingGreetingJobs.length > 0 && (
        <section className="rounded-2xl border border-primary/20 bg-surface-accent p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-black">待发送招呼语</h3>
              <p className="mt-1 text-xs text-muted">这些岗位已确认并生成招呼语，点击后会直接进入发送流程。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => sendReadyGreetings(pendingGreetingJobs.map(job => job.id))}>发送全部 {pendingGreetingJobs.length} 个</Button>
              <Button variant="secondary" size="sm" onClick={() => rejectSelectedJobs(pendingGreetingJobs.map(job => job.id))}>放弃全部</Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {pendingGreetingJobs.map(job => (
              <div key={job.id} className="rounded-2xl border border-primary/20 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black">{job.company}｜{job.title}</div>
                    <div className="mt-1 text-xs text-primary">已生成招呼语，等待发送</div>
                  </div>
                  <span className="rounded-full bg-surface-accent px-2 py-1 text-[11px] font-black text-primary">待发送</span>
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted">{job.greeting || '招呼语已生成，等待发送。'}</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => sendReadyGreetings([job.id])}>发送招呼语</Button>
                  <Button variant="secondary" size="sm" onClick={() => rejectSelectedJobs([job.id])}>放弃</Button>
                  <Button variant="secondary" size="sm" onClick={() => openJobDetail(job)}><Eye className="mr-2 h-4 w-4" />查看详情</Button>
                  <Button variant="secondary" size="sm" disabled={!job.url} onClick={() => window.open(job.url, '_blank', 'noopener,noreferrer')}><ExternalLink className="mr-2 h-4 w-4" />跳转岗位链接</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-card-border bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-black">今日待确认</h3>
            <p className="mt-1 text-xs text-muted">评估结果供人工筛选；可生成并复制定制招呼语，系统不会自动发送。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSelected(filteredTodayJobs.map(job => job.id))}>全选</Button>
            <Button variant="secondary" size="sm" onClick={() => setSelected([])}>清空</Button>
            <Button variant="secondary" size="sm" onClick={() => rejectSelectedJobs(actionableSelected)}>放弃已选 {actionableSelected.length} 个</Button>
            <Button
              size="sm"
              disabled={actionableSelected.length !== 1}
              onClick={() => setGreetingJob(filteredTodayJobs.find(job => job.id === actionableSelected[0]) || null)}
            >
              <MessageCircle className="mr-1 h-4 w-4" />{actionableSelected.length === 1 ? '生成定制招呼语' : '生成招呼语（先选1个）'}
            </Button>
            <Button variant="secondary" size="sm" disabled={!actionableSelected.length} onClick={() => confirmDeliver(actionableSelected)}>一键投递已选 {actionableSelected.length} 个</Button>
          </div>
        </div>
        <JobFilterBar
          filters={todayFilters}
          onChange={setTodayFilters}
          onReset={() => setTodayFilters({ ...EMPTY_JOB_FILTERS })}
          resultCount={filteredTodayJobs.length}
          totalCount={todayJobs.length}
          invalidSalary={hasInvalidSalaryRange(todayFilters)}
        />
        {filteredTodayJobs.length ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {filteredTodayJobs.map(job => (
              <JobActionCard
                key={job.id}
                job={job}
                selected={selected.includes(job.id)}
                onToggle={() => toggleJob(job.id)}
                onDetail={() => openJobDetail(job)}
                onGreeting={() => setGreetingJob(job)}
                onDeliver={() => confirmDeliver([job.id])}
                onReject={() => rejectSelectedJobs([job.id])}
              />
            ))}
          </div>
        ) : todayJobs.length ? (
          <EmptyState title="没有符合当前条件的岗位" action={<Button variant="secondary" size="sm" onClick={() => setTodayFilters({ ...EMPTY_JOB_FILTERS })}>重置筛选</Button>} />
        ) : (
          <EmptyState title="今天暂时没有待确认岗位" description="采集并评分后，合适岗位会进入这里等待人工确认。" />
        )}
      </section>

      {selectedJob && <JobDetailModal job={selectedJob} onClose={() => setSelectedJob(null)} />}
      <CustomGreetingDialog job={greetingJob} onClose={() => setGreetingJob(null)} onGenerated={() => void refresh()} />
      <CollectJobsDialog
        open={collectDialogOpen}
        mode={collectDialogMode}
        activeTask={activeTask && (activeTask.mode === 'collect' || activeTask.mode === 'full') ? activeTask : null}
        onClose={() => setCollectDialogOpen(false)}
        onStart={options => void startCollection(options)}
      />
    </div>
  )
}

function CollectionProgressPanel({ progress }: { progress: CollectionProgress }) {
  return (
    <div className="mt-3 rounded-2xl border border-primary/20 bg-surface-accent p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-black text-primary">多平台采集进度</div>
        <div className="text-xs font-bold text-muted">{progress.outcome === 'running' ? '执行中' : progress.outcome || '已结束'}</div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {Object.entries(progress.platforms || {}).map(([platform, state]) => (
          <div key={platform} className="rounded-xl border border-card-border bg-white p-3">
            <div className="flex items-center justify-between text-sm font-black">
              <span>{platform === 'boss' ? 'BOSS 直聘' : platform === 'zhilian' ? '智联招聘' : '前程无忧'}</span>
              <span>新增 {state.new}</span>
            </div>
            <div className="mt-1 text-xs text-muted">
              {state.status === 'queued' ? '等待前序平台完成' : `${state.city || '城市未开始'} · ${state.keyword || '关键词未开始'} · 第 ${state.page || 0}/${state.max_pages || 0} 页`}
            </div>
            <div className="mt-1 text-xs text-muted">扫描 {state.seen || 0} · 重复 {state.duplicate || 0} · 过滤 {state.filtered || 0} · 解析失败 {state.parse_failed || 0} · 保存失败 {state.save_failed || 0}</div>
            {(state.message || state.reason_code) && <div className="mt-1 text-xs font-bold text-primary">{state.message || state.reason_code}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function bossPlatformUrl(job: Job) {
  const fallback = 'https://www.zhipin.com/'
  if (!job.url?.trim()) return fallback
  try {
    const parsed = new URL(job.url)
    if (
      parsed.protocol === 'https:'
      && (parsed.hostname === 'zhipin.com' || parsed.hostname.endsWith('.zhipin.com'))
    ) {
      return parsed.toString()
    }
  } catch {
    return fallback
  }
  return fallback
}

function JobActionCard({ job, selected, onToggle, onDetail, onGreeting, onDeliver, onReject }: { job: Job; selected: boolean; onToggle: () => void; onDetail: () => void; onGreeting: () => void; onDeliver: () => void; onReject: () => void }) {
  return (
    <div className={`rounded-2xl border p-4 ${selected ? 'border-primary bg-surface-subtle' : 'border-card-border bg-surface-subtle'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-black">{job.company}｜{job.title}</div>
          <div className="mt-1 text-xs text-muted">{jobSubtitle(job)}</div>
        </div>
        <input type="checkbox" checked={selected} onChange={onToggle} className="mt-1 h-4 w-4 accent-primary" />
      </div>
      <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted">{job.score_reason || job.greeting || '等待继续推进。'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onGreeting}><MessageCircle className="mr-2 h-4 w-4" />{job.greeting ? '查看招呼语' : '生成定制招呼语'}</Button>
        <Button variant="secondary" size="sm" onClick={onDeliver}><Send className="mr-2 h-4 w-4" />一键投递</Button>
        <Button variant="secondary" size="sm" onClick={onDetail}><Eye className="mr-2 h-4 w-4" />查看详情</Button>
        <Button variant="secondary" size="sm" onClick={() => window.open(bossPlatformUrl(job), '_blank', 'noopener,noreferrer')}><ExternalLink className="mr-2 h-4 w-4" />打开平台</Button>
        <Button variant="secondary" size="sm" onClick={onReject}><XCircle className="mr-2 h-4 w-4" />放弃岗位</Button>
      </div>
    </div>
  )
}

function JobDetailModal({ job, onClose }: { job: Job; onClose: () => void }) {
  return (
    <DialogShell className="max-w-3xl" label="岗位详情">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black tracking-[0.18em] text-primary">岗位详情</div>
            <h3 className="mt-1 text-2xl font-black">{job.company}｜{job.title}</h3>
            <p className="mt-1 text-sm text-muted">{job.salary || '薪资未填'} · {job.city || '城市未填'} · {getStatusLabel(job.status)}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>关闭</Button>
        </div>
        <div className="grid gap-3 text-sm lg:grid-cols-2">
          <InfoBlock label="HR" value={[job.hr_name, job.hr_title].filter(Boolean).join(' · ') || '-'} />
          <InfoBlock label="招聘者活跃" value={job.hr_active || '活跃度未知'} />
          <InfoBlock label="公司" value={[job.company_size, job.company_industry].filter(Boolean).join(' · ') || '-'} />
          <InfoBlock label="来源平台" value={job.source_platform === 'zhilian' ? '智联招聘｜当前只开放采集' : job.source_platform === '51job' ? '前程无忧｜当前只开放采集' : 'BOSS 直聘'} />
          <InfoBlock label="匹配分" value={String(job.score || '-')} />
          <InfoBlock label="定制简历" value={job.resume_path || '未生成'} />
        </div>
        <div className="mt-4 rounded-2xl border border-card-border bg-surface-subtle p-4">
          <div className="text-sm font-black">评分理由</div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{job.score_reason || '-'}</p>
        </div>
        <div className="mt-4 rounded-2xl border border-card-border bg-surface-subtle p-4">
          <div className="text-sm font-black">招呼语</div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{job.greeting || '未生成'}</p>
        </div>
        <div className="mt-4 rounded-2xl border border-card-border bg-surface-subtle p-4">
          <div className="text-sm font-black">JD</div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{job.jd || '-'}</p>
        </div>
    </DialogShell>
  )
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-card-border bg-surface-subtle p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-bold text-foreground">{value}</div>
    </div>
  )
}

export function JobsPage() {
  return <JobsPoolView />
}

export function MonitorPage() {
  const { history, loading, error, refresh } = useDashboard('monitor')
  if (loading) return <PageSkeleton label="正在读取监测记录..." />

  return (
    <div className="space-y-4">
      <PageHeader
        title="监测执行"
        description="这里不启动监测，只处理监测发现的 HR 问题、回复建议和结果。"
      />
      {error && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-danger">{error}</div>}
      <MonitorExecutionView history={history} refresh={refresh} />
    </div>
  )
}

function filtersFromSearchParams(params: URLSearchParams): JobFilters {
  return {
    query: params.get('q') || '',
    minScore: params.get('minScore') || '',
    salaryMin: params.get('salaryMin') || '',
    salaryMax: params.get('salaryMax') || '',
    status: params.get('status') || '',
    createdWithin: params.get('createdWithin') || '',
    sourcePlatform: params.get('sourcePlatform') || '',
    education: params.get('education') || '',
    recruitmentType: params.get('recruitmentType') || '',
  }
}

const jobFilterParams: Record<keyof JobFilters, string> = {
  query: 'q',
  minScore: 'minScore',
  salaryMin: 'salaryMin',
  salaryMax: 'salaryMax',
  status: 'status',
  createdWithin: 'createdWithin',
  sourcePlatform: 'sourcePlatform',
  education: 'education',
  recruitmentType: 'recruitmentType',
}

const jobSortKeys: JobSortKey[] = ['salary', 'education', 'score', 'status', 'hr_active', 'created_at']

function JobsPoolView() {
  const pageSize = 15
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])
  const page = Math.max((Number(searchParams.get('page')) || 1) - 1, 0)
  const requestedSort = searchParams.get('sortBy') as JobSortKey | null
  const sortBy = requestedSort && jobSortKeys.includes(requestedSort) ? requestedSort : 'created_at'
  const sortOrder: JobSortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc'
  const showRecycleBin = searchParams.get('view') === 'recycle'
  const showScoreDialog = searchParams.get('score') === 'pending'
  const [selectedIds, setSelectedIds] = useSessionState<string[]>('bosshunter.jobs.selected', [])
  const [resumePreviewJob, setResumePreviewJob] = useState<Job | null>(null)
  const [customGreetingJob, setCustomGreetingJob] = useState<Job | null>(null)
  const [notice, setNotice] = useState('')
  const [recycleJobs, setRecycleJobs] = useState<Job[]>([])
  const [recycleSelectedIds, setRecycleSelectedIds] = useState<string[]>([])
  const [recycleLoading, setRecycleLoading] = useState(false)
  const [permanentDeleteIds, setPermanentDeleteIds] = useState<string[]>([])
  const [permanentDeleteAcknowledged, setPermanentDeleteAcknowledged] = useState(false)
  const { items, total, allTotal, loading, error, refresh: refreshJobs } = useJobSearch(filters, page, pageSize, sortBy, sortOrder)
  const { workbench: deliveryWorkbench } = useDashboard('workbench')
  const deliveryTask = deliveryWorkbench.task?.mode === 'deliver'
    ? deliveryWorkbench.task
    : deliveryWorkbench.last_task?.mode === 'deliver' ? deliveryWorkbench.last_task : null
  const automatedGreetingEnabled = deliveryWorkbench.automated_greeting_enabled

  const updateSearch = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams)
    mutate(next)
    setSearchParams(next, { replace: true })
  }

  const setFilters = (nextFilters: JobFilters) => {
    updateSearch(next => {
      Object.entries(jobFilterParams).forEach(([key, param]) => {
        const value = nextFilters[key as keyof JobFilters]
        if (value) next.set(param, value)
        else next.delete(param)
      })
      next.delete('page')
    })
  }

  const setPage = (nextPage: number) => {
    updateSearch(next => {
      if (nextPage > 0) next.set('page', String(nextPage + 1))
      else next.delete('page')
    })
  }

  const setShowRecycleBin = (open: boolean) => {
    updateSearch(next => {
      if (open) next.set('view', 'recycle')
      else next.delete('view')
    })
  }

  const setShowScoreDialog = (open: boolean) => {
    updateSearch(next => {
      if (open) next.set('score', 'pending')
      else next.delete('score')
    })
  }

  const toggleSelected = (jobId: string) => {
    setSelectedIds(previous => previous.includes(jobId) ? previous.filter(id => id !== jobId) : [...previous, jobId])
  }

  const allPageSelected = items.length > 0 && items.every(job => selectedIds.includes(job.id))
  const toggleCurrentPage = () => {
    const pageIds = new Set(items.map(job => job.id))
    setSelectedIds(previous => allPageSelected
      ? previous.filter(id => !pageIds.has(id))
      : [...new Set([...previous, ...pageIds])])
  }

  const changeSort = (nextSortBy: JobSortKey) => {
    updateSearch(next => {
      const nextOrder = nextSortBy === sortBy
        ? (sortOrder === 'asc' ? 'desc' : 'asc')
        : (nextSortBy === 'score' || nextSortBy === 'created_at' ? 'desc' : 'asc')
      next.set('sortBy', nextSortBy)
      next.set('sortOrder', nextOrder)
      next.delete('page')
    })
  }

  const loadRecycleBin = async () => {
    setRecycleLoading(true)
    try {
      const collected: Job[] = []
      let offset = 0
      const limit = 200
      while (true) {
        const res = await fetch(`/api/jobs?deleted=only&limit=${limit}&offset=${offset}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`回收站接口返回 ${res.status}`)
        const pageItems = await res.json()
        if (!Array.isArray(pageItems)) throw new Error('回收站响应格式无效')
        collected.push(...pageItems)
        const totalCount = Number(res.headers.get('X-Total-Count'))
        if (!pageItems.length || pageItems.length < limit || (Number.isFinite(totalCount) && collected.length >= totalCount)) break
        offset += pageItems.length
      }
      const unique = new Map(collected.map(job => [String(job.id), job]))
      setRecycleJobs([...unique.values()])
      setRecycleSelectedIds(previous => previous.filter(id => unique.has(id)))
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '读取回收站失败')
    } finally {
      setRecycleLoading(false)
    }
  }

  useEffect(() => {
    void loadRecycleBin()
  }, [])

  const postJobAction = async (path: string, payload: Record<string, unknown>) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const blocked = Array.isArray(data.blocked)
        ? data.blocked.map((item: { job_id?: string; reasons?: string[] }) => `${item.job_id || '岗位'}：${(item.reasons || []).join('、')}`).join('；')
        : ''
      throw new Error([data.error || '岗位操作失败', blocked].filter(Boolean).join('；'))
    }
    return res.json()
  }

  const softDelete = async (jobIds: string[]) => {
    if (!jobIds.length || !window.confirm(`确认将 ${jobIds.length} 个岗位移入回收站吗？岗位不会永久删除。`)) return
    try {
      const result = await postJobAction('/api/jobs/soft-delete', { job_ids: jobIds, confirmed: true })
      setSelectedIds(previous => previous.filter(id => !jobIds.includes(id)))
      refreshJobs()
      await loadRecycleBin()
      setNotice(`已移入回收站 ${result.affected_count || 0} 条岗位。`)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '移入回收站失败')
    }
  }

  const markManuallySent = async (job: Job) => {
    if (job.source_platform !== 'zhilian' && job.source_platform !== '51job') return
    const platformLabel = job.source_platform === 'zhilian' ? '智联招聘' : '前程无忧'
    if (!window.confirm(`请确认：你已经在${platformLabel}完成了这个岗位的投递。此操作只更新 BossHunter 本地记录，不会向平台发送任何内容。`)) return
    try {
      const result = await postJobAction('/api/jobs/manual-sent', {
        job_ids: [job.id],
        confirmed: true,
      })
      refreshJobs()
      setNotice(
        result.affected_count
          ? `已将 ${platformLabel} 岗位标记为“已发送”。`
          : `该岗位此前已经标记为“已发送”。`
      )
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '标记已发送失败')
    }
  }

  const deliverSelectedJobs = async () => {
    if (!selectedIds.length) return
    const count = selectedIds.length
    if (!window.confirm(`确认投递已选择的 ${count} 个岗位吗？仅 BOSS 岗位可进入发送队列，且仍受发送时间窗口和每日额度限制。`)) return
    try {
      const result = await postJobAction('/api/workbench/deliver', { job_ids: selectedIds })
      setSelectedIds([])
      refreshJobs()
      setNotice(
        result.already_queued_count === count
          ? `所选 ${count} 个岗位已在当前发送队列中。`
          : result.queued_count
            ? `已将 ${result.queued_count} 个岗位追加到当前发送队列。`
            : `已确认投递 ${count} 个岗位，后端会按安全队列推进。`
      )
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '一键投递失败')
    }
  }

  const restoreJobs = async (jobIds: string[]) => {
    if (!jobIds.length || !window.confirm(`确认恢复 ${jobIds.length} 个岗位吗？恢复后不会自动评分或投递。`)) return
    try {
      const result = await postJobAction('/api/jobs/restore', { job_ids: jobIds, confirmed: true })
      setRecycleSelectedIds(previous => previous.filter(id => !jobIds.includes(id)))
      refreshJobs()
      await loadRecycleBin()
      setNotice(`已恢复 ${result.affected_count || 0} 条岗位。`)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '恢复失败')
    }
  }

  const requestPermanentDelete = (jobIds: string[]) => {
    if (!jobIds.length) return
    setPermanentDeleteIds(jobIds)
    setPermanentDeleteAcknowledged(false)
  }

  const confirmPermanentDelete = async () => {
    if (!permanentDeleteIds.length || !permanentDeleteAcknowledged) return
    try {
      const result = await postJobAction('/api/jobs/permanent-delete', {
        job_ids: permanentDeleteIds,
        confirmed: true,
        confirmation: 'PERMANENT_DELETE',
      })
      setRecycleSelectedIds(previous => previous.filter(id => !permanentDeleteIds.includes(id)))
      setPermanentDeleteIds([])
      setPermanentDeleteAcknowledged(false)
      await loadRecycleBin()
      setNotice(`已永久删除 ${result.affected_count || 0} 条岗位。`)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '永久删除失败')
    }
  }

  const exportJobs = async (format: 'xlsx' | 'csv', scope: 'all' | 'filtered' | 'selected') => {
    try {
      const res = await fetch('/api/jobs/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          scope,
          job_ids: scope === 'selected' ? selectedIds : [],
          filters: scope === 'filtered' ? {
            q: filters.query.trim(),
            min_score: filters.minScore,
            salary_min: filters.salaryMin,
            salary_max: filters.salaryMax,
            status: filters.status,
            created_within: filters.createdWithin,
            source_platform: filters.sourcePlatform,
          } : {},
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '导出失败')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') || ''
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `bosshunter-jobs.${format}`
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      window.URL.revokeObjectURL(url)
      const exportedCount = Number(res.headers.get('X-Exported-Count'))
      setNotice(`已导出 ${Number.isFinite(exportedCount) ? exportedCount : 0} 条岗位。`)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '导出失败')
    }
  }

  const startScoring = async (options: {
    scope: 'pending' | 'failed' | 'selected' | 'all_scored'
    limit: number | null
    job_ids: string[]
    force_rescore: boolean
  }) => {
    const res = await fetch('/api/scoring/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const checks = Array.isArray(data.messages) ? data.messages.join('；') : ''
      throw new Error([data.error || '启动评分失败', checks].filter(Boolean).join('：'))
    }
    setNotice(`独立评分已启动，共 ${data.run?.remaining_job_ids?.length || 0} 个岗位。`)
  }

  if (showRecycleBin) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="回收站"
          description="保留岗位状态、评分、招呼语和历史；恢复后不会自动启动评分或投递。"
          actions={(
            <>
              <Button variant="ghost" size="sm" onClick={() => setShowRecycleBin(false)}>返回岗位池</Button>
              <Button variant="secondary" size="sm" onClick={() => void loadRecycleBin()} disabled={recycleLoading}>刷新回收站</Button>
            </>
          )}
        />
        {notice && <div className="rounded-xl bg-surface-accent px-4 py-3 text-sm text-primary">{notice}</div>}
        <RecycleBinPanel
          jobs={recycleJobs}
          selectedIds={recycleSelectedIds}
          loading={recycleLoading}
          onToggleSelected={id => setRecycleSelectedIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])}
          onSelectAll={setRecycleSelectedIds}
          onRestore={ids => void restoreJobs(ids)}
          onPermanentDelete={requestPermanentDelete}
        />
        {permanentDeleteIds.length > 0 && (
          <DialogShell className="max-w-lg border-red-200" label="确认永久删除">
              <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-danger" /><div><h3 className="text-xl font-black">确认永久删除</h3><p className="mt-2 text-sm leading-6 text-muted">将永久删除 {permanentDeleteIds.length} 条岗位及其历史，无法恢复。存在发送或回复证据的岗位会被后端拒绝删除。</p></div></div>
              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-red-100 bg-red-50 p-3 text-sm font-bold"><input type="checkbox" checked={permanentDeleteAcknowledged} onChange={event => setPermanentDeleteAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 accent-danger" /><span>我确认永久删除，并了解此操作无法撤销。</span></label>
              <div className="mt-6 flex justify-end gap-3"><Button variant="secondary" size="sm" onClick={() => setPermanentDeleteIds([])}>取消</Button><Button variant="destructive" size="sm" disabled={!permanentDeleteAcknowledged} onClick={() => void confirmPermanentDelete()}>永久删除</Button></div>
          </DialogShell>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="岗位池"
        description="集中查看已采集岗位、AI 分数、状态和详情入口。筛选、分页和排序会保留在当前地址中。"
        actions={(
          <>
          <Button variant="secondary" size="sm" onClick={() => { setShowRecycleBin(true); void loadRecycleBin() }}><Trash2 className="mr-1 h-4 w-4" />回收站 ({recycleJobs.length})</Button>
          <BriefcaseBusiness className="h-6 w-6 text-primary" />
          </>
        )}
      />
      <JobFilterBar
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters({ ...EMPTY_JOB_FILTERS })}
        resultCount={total}
        totalCount={allTotal}
        invalidSalary={hasInvalidSalaryRange(filters)}
        showStatus
        showSource
      />
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-card-border bg-white p-3 text-xs shadow-sm">
        <Button variant="secondary" size="sm" disabled={!items.length} onClick={toggleCurrentPage}>
          {allPageSelected ? '取消选择本页' : '选择本页'}
        </Button>
        <span className="rounded-full bg-surface-accent px-3 py-2 font-bold text-primary">已选择 {selectedIds.length} 条</span>
        {selectedIds.length > 0 && <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>清空选择</Button>}
        <Button variant="destructive" size="sm" disabled={!selectedIds.length} onClick={() => void softDelete(selectedIds)}>移入回收站</Button>
        {automatedGreetingEnabled && <Button size="sm" disabled={!selectedIds.length} onClick={() => void deliverSelectedJobs()}>
          <Send className="mr-1 h-4 w-4" />BOSS 一键投递已选
        </Button>}
        <Button size="sm" onClick={() => setShowScoreDialog(true)} disabled={!total}>评分全部待评分岗位</Button>
        <Button variant="secondary" size="sm" onClick={() => setShowScoreDialog(true)}>自定义评分</Button>
        <ExportMenu onExport={exportJobs} hasSelection={selectedIds.length > 0} hasFiltered={total > 0} />
      </div>
      {notice && <div className="rounded-xl bg-surface-accent px-4 py-3 text-sm text-primary">{notice}</div>}
      {automatedGreetingEnabled && deliveryTask && (
        <div className="rounded-2xl border border-card-border bg-surface-subtle p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-black">投递队列</div>
              <p className="mt-1 text-xs text-muted">只展示已人工确认的 BOSS 发送任务；智联和 51job 不会进入此队列。</p>
            </div>
            <span className="rounded-full bg-surface-accent px-3 py-1 text-xs font-black text-primary">
              {deliveryTask.status === 'running' ? '处理中' : deliveryTask.status === 'completed' ? '已完成' : deliveryTask.status === 'failed' ? '失败' : deliveryTask.status}
            </span>
          </div>
          <div className="mt-3 rounded-xl border border-card-border bg-white px-3 py-2 text-sm">
            <div className="font-bold">{deliveryTask.logs?.[deliveryTask.logs.length - 1] || '队列已创建，等待执行'}</div>
            <div className="mt-1 text-xs text-muted">任务 ID：{deliveryTask.id}</div>
          </div>
        </div>
      )}
      {error && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-danger">{error}</div>}
      <JobsTable
        jobs={items}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        selectedIds={selectedIds}
        onToggleSelected={toggleSelected}
        onSoftDelete={job => void softDelete([job.id])}
        onMarkManuallySent={job => void markManuallySent(job)}
        onDownloadResume={job => window.open(`/api/jobs/${job.id}/resume/download`, '_blank')}
        onTailorResume={setResumePreviewJob}
        onCustomGreeting={setCustomGreetingJob}
        loading={loading}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={changeSort}
      />
      <ScoreJobsDialog
        open={showScoreDialog}
        selectedJobIds={selectedIds}
        onClose={() => setShowScoreDialog(false)}
        onStart={startScoring}
      />
      <TailoredResumePreviewDialog job={resumePreviewJob} onClose={() => setResumePreviewJob(null)} onGenerated={refreshJobs} />
      <CustomGreetingDialog job={customGreetingJob} onClose={() => setCustomGreetingJob(null)} onGenerated={refreshJobs} />
    </div>
  )
}

function ExportMenu({
  onExport,
  hasSelection,
  hasFiltered,
}: {
  onExport: (format: 'xlsx' | 'csv', scope: 'all' | 'filtered' | 'selected') => void
  hasSelection: boolean
  hasFiltered: boolean
}) {
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx')
  return (
    <div className="ml-auto flex flex-wrap items-center gap-2">
      <Select
        value={format}
        onChange={event => setFormat(event.target.value as 'xlsx' | 'csv')}
        className="w-auto min-w-20 text-xs"
      >
        <option value="xlsx">XLSX</option>
        <option value="csv">CSV</option>
      </Select>
      <Button variant="secondary" size="sm" disabled={!hasFiltered} onClick={() => onExport(format, 'filtered')}>导出筛选结果</Button>
      <Button variant="secondary" size="sm" disabled={!hasSelection} onClick={() => onExport(format, 'selected')}>导出所选岗位</Button>
      <Button variant="secondary" size="sm" onClick={() => onExport(format, 'all')}>导出全部岗位</Button>
    </div>
  )
}

type MonitorFilter = 'pending' | 'resume' | 'follow_up' | 'replied'
const REPLY_RESOLUTION_ACTIONS = ['reply_dismissed', 'replied', 'auto_replied']

function uniqueLatestByJob(items: HistoryItem[]) {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = item.job_id || `${item.company}-${item.title}-${item.action}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sameHistoryJob(left: HistoryItem, right: HistoryItem) {
  if (left.job_id && right.job_id) return left.job_id === right.job_id
  return left.company === right.company && left.title === right.title
}

function isReplyPendingResolved(item: HistoryItem, history: HistoryItem[]) {
  return history.some(candidate =>
    candidate.id !== item.id
    && sameHistoryJob(item, candidate)
    && REPLY_RESOLUTION_ACTIONS.includes(candidate.action)
    && candidate.created_at >= item.created_at
  )
}

function isResumeFailureResolved(item: HistoryItem, history: HistoryItem[]) {
  return Boolean(item.resolved || item.resume_path) || history.some(candidate =>
    candidate.id > item.id
    && sameHistoryJob(item, candidate)
    && (candidate.action === 'needs_resume' || candidate.action === 'resume_sent')
  )
}

function latestHrText(item: HistoryItem) {
  const parsed = parseHistoryDetail(item)
  const latestHr = [...parsed.conversationTail].reverse().find(message => message.sender === 'hr' && message.text.trim())
  return parsed.hrQuestion || latestHr?.text || ''
}

function MonitorExecutionView({ history, refresh }: { history: HistoryItem[]; refresh: () => Promise<void> }) {
  const pendingReplies = uniqueLatestByJob(history.filter(item =>
    item.action === 'reply_pending' && !isReplyPendingResolved(item, history)
  ))
  const resumeFailures = uniqueLatestByJob(history.filter(item =>
    item.action === 'resume_failed' && !isResumeFailureResolved(item, history)
  ))
  const pendingItems = uniqueLatestByJob(
    [...pendingReplies, ...resumeFailures].sort((left, right) => right.id - left.id)
  )
  const resumeRequests = uniqueLatestByJob(history.filter(item =>
    item.action === 'needs_resume' || item.action === 'resume_sent' || item.action === 'resume_failed'
  ))
  const resumeRequestJobIds = new Set(resumeRequests.map(item => item.job_id).filter(Boolean))
  const followUpRecords = uniqueLatestByJob(history.filter(item => item.action === 'follow_up_sent'))
  const repliedRecords = uniqueLatestByJob(history.filter(item =>
    (item.action === 'replied' || item.action === 'auto_replied')
      && !resumeRequestJobIds.has(item.job_id)
  ))
  const [activeMonitorFilter, setActiveMonitorFilter] = useState<MonitorFilter>('pending')
  const visibleHistory = activeMonitorFilter === 'resume'
    ? resumeRequests
    : activeMonitorFilter === 'follow_up'
      ? followUpRecords
      : activeMonitorFilter === 'replied'
        ? repliedRecords
        : pendingItems
  const displayedHistory = activeMonitorFilter === 'pending' || activeMonitorFilter === 'resume'
    ? visibleHistory
    : visibleHistory.slice(0, 8)
  const emptyState = {
    pending: ['暂无待处理事项', '监测发现需要人工处理的 HR 问题后，会显示在这里。'],
    resume: ['暂无简历请求', '收到 HR 简历请求后，会显示定制简历的生成与发送状态。'],
    follow_up: ['暂无自动跟进记录', '符合跟进条件的历史记录会显示在这里。'],
    replied: ['暂无已回复记录', 'HR 回复或人工处理完成后，会归档在这里。'],
  }[activeMonitorFilter]
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({})
  const [notice, setNotice] = useState('')

  const draftFor = (item: HistoryItem) => {
    const parsed = parseHistoryDetail(item)
    return replyDrafts[item.id] ?? parsed.aiReply ?? item.detail ?? ''
  }

  const sendManualReply = async (item: HistoryItem) => {
    try {
      const res = await fetch(`/api/history/${item.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: draftFor(item) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '回复失败')
      }
      await refresh()
      setNotice('回复已记录，请在招聘平台手动发送。')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '回复失败')
    }
  }

  const dismissPendingReply = async (item: HistoryItem) => {
    if (!window.confirm('确定放弃这条待回复建议吗？放弃后不会发送消息，也不会把岗位标记为拒绝。')) return
    try {
      const res = await fetch(`/api/history/${item.id}/dismiss`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '放弃失败')
      }
      await refresh()
      setNotice('已放弃这条待回复建议。')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '放弃失败')
    }
  }

  return (
    <div className="rounded-2xl border border-card-border bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { key: 'pending' as const, label: '待处理', count: pendingItems.length },
          { key: 'resume' as const, label: '简历请求', count: resumeRequests.length },
          { key: 'follow_up' as const, label: '自动跟进', count: followUpRecords.length },
          { key: 'replied' as const, label: '已回复', count: repliedRecords.length },
        ].map(item => {
          const active = activeMonitorFilter === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveMonitorFilter(item.key)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${active ? 'bg-primary text-white' : 'border border-card-border text-muted hover:border-primary/60 hover:text-primary'}`}
            >
              {item.label} {item.count}
            </button>
          )
        })}
      </div>
      {notice && <div className="mb-3 rounded-2xl bg-surface-accent px-4 py-3 text-sm text-primary">{notice}</div>}
      <div className="space-y-3">
        {displayedHistory.map((item, index) => {
          const canReply = item.action === 'reply_pending'
          const isFollowUp = item.action === 'follow_up_sent'
          const isResumeFailure = item.action === 'resume_failed'
          const isResumeRequest = item.action === 'needs_resume' || item.action === 'resume_sent' || isResumeFailure
          const isReplied = item.action === 'replied' || item.action === 'auto_replied'
          const parsed = parseHistoryDetail(item)
          const hrText = latestHrText(item)
          const isLegacyReplied = item.action === 'replied' && parsed.schema === 'legacy_text'
          const hasGeneratedReply = Boolean(parsed.aiReply) && !isLegacyReplied
          const showReplyContent = canReply || Boolean(parsed.hrQuestion) || hasGeneratedReply || isResumeRequest || isReplied
          const aiReplyText = parsed.aiReply || item.detail || getActionLabel(item.action)
          const systemFailureReason = parsed.systemReason || (isResumeFailure ? '未获得更具体的错误信息，请查看运行日志。' : '')
          return (
            <div key={`${item.created_at}-${index}`} className="grid gap-3 rounded-2xl border border-card-border bg-surface-subtle p-4 lg:grid-cols-[130px_1fr_160px]">
              <div className="text-xs text-muted">
                <div>{item.created_at}</div>
                <div className="mt-2 rounded-full bg-white px-2 py-1 text-center font-bold text-primary">{getActionLabel(item.action)}</div>
              </div>
              <div>
                <div className="font-black">{item.company || '岗位'}｜{item.title || '监测记录'}</div>
                {showReplyContent ? (
                  <div className="mt-3 space-y-3">
                    {(isFollowUp || hrText) && (
                      <div>
                        <div className="text-xs font-black text-primary">{isFollowUp ? '自动跟进说明' : '对方问题 / HR'}</div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted">
                          {isFollowUp ? 'HR 超过设定时间未回复，系统已自动执行一次跟进。' : hrText}
                        </p>
                      </div>
                    )}
                    {isResumeFailure && (
                      <div className="rounded-2xl border border-danger/30 bg-red-50 p-3">
                        <div className="text-xs font-black text-danger">系统失败原因</div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-danger">{systemFailureReason}</p>
                      </div>
                    )}
                    {canReply ? (
                      <div>
                        <div className="mb-1 text-xs font-black text-primary">AI 建议回复</div>
                        <textarea
                          value={draftFor(item)}
                          onChange={event => setReplyDrafts(prev => ({ ...prev, [item.id]: event.target.value }))}
                          className="min-h-[92px] w-full rounded-2xl border border-card-border bg-white p-3 text-sm leading-6 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                    ) : isResumeRequest || !hasGeneratedReply ? null : (
                      <div className="rounded-2xl border border-card-border bg-white p-3">
                        <div className="text-xs font-black text-primary">AI 回复</div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted">{aiReplyText}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-muted">{item.detail || getActionLabel(item.action)}</p>
                )}
                {canReply ? (
                  <p className="mt-2 text-xs text-primary">AI 建议：需要人工确认后再回复。</p>
                ) : item.action === 'needs_resume' ? (
                  <p className="mt-2 text-xs text-primary">简历请求：监测发现 HR 要简历，已生成定制简历，等待手动发送。</p>
                ) : item.action === 'resume_sent' ? (
                  <p className="mt-2 text-xs text-primary">简历生成：定制简历已生成，并已标记发送。</p>
                ) : isResumeFailure ? (
                  <p className="mt-2 text-xs text-danger">待处理：定制简历生成失败，尚无可下载文件，请手动处理或稍后重试生成。</p>
                ) : isReplied ? (
                  <p className="mt-2 text-xs text-primary">已回复：HR 已有反馈或系统已完成回复处理。</p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Button size="sm" disabled={!canReply} onClick={() => sendManualReply(item)}><MessageCircle className="mr-2 h-4 w-4" />确认回复</Button>
                <Button variant="secondary" size="sm" disabled={!canReply} onClick={() => setReplyDrafts(prev => ({ ...prev, [item.id]: draftFor(item) }))}>编辑回复</Button>
                <Button variant="secondary" size="sm" disabled={!canReply} onClick={() => dismissPendingReply(item)}>放弃</Button>
              </div>
            </div>
          )
        })}
        {!visibleHistory.length && <EmptyState title={emptyState[0]} description={emptyState[1]} />}
      </div>
    </div>
  )
}
