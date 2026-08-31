import { CheckCircle2, Download, FileText, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import type { Job } from '@/hooks/useDashboard'

interface ResumeTask {
  id: string
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'stopping'
  error?: string | null
  logs?: string[]
  progress?: { stage?: string }
}

interface TailoredResumePreviewDialogProps {
  job: Job | null
  onClose: () => void
  onGenerated: () => void
}

const previewSteps = [
  '读取配置页中的基础简历',
  '结合当前岗位 JD 调整重点与关键词',
  '生成可预览、下载的岗位定制版简历',
]

export function TailoredResumePreviewDialog({ job, onClose, onGenerated }: TailoredResumePreviewDialogProps) {
  const [task, setTask] = useState<ResumeTask | null>(null)
  const [starting, setStarting] = useState(false)
  const [requestError, setRequestError] = useState('')

  useEffect(() => {
    setTask(null)
    setRequestError('')
    if (!job) return

    let cancelled = false
    const loadTask = async () => {
      try {
        const result = await fetch(`/api/jobs/${job.id}/resume/task`)
        const payload = await result.json()
        if (!cancelled && payload.task) setTask(payload.task)
      } catch {
        // A temporary status-check failure should not hide a task that was already started.
      }
    }
    void loadTask()
    return () => { cancelled = true }
  }, [job?.id])

  useEffect(() => {
    if (!job || !task || !['running', 'stopping'].includes(task.status)) return
    const timer = window.setInterval(async () => {
      try {
        const result = await fetch(`/api/jobs/${job.id}/resume/task`)
        const payload = await result.json()
        if (!payload.task) return
        setTask(payload.task)
        if (payload.task.status === 'completed') onGenerated()
      } catch {
        // Keep polling; the next request may succeed.
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [job?.id, onGenerated, task])

  if (!job) return null

  const generating = starting || task?.status === 'running' || task?.status === 'stopping'
  const generated = task?.status === 'completed' || Boolean(job.resume_path)
  const lastLog = task?.logs?.[task.logs.length - 1]

  const startGeneration = async () => {
    setStarting(true)
    setRequestError('')
    try {
      const result = await fetch(`/api/jobs/${job.id}/resume/generate`, { method: 'POST' })
      const payload = await result.json()
      if (!result.ok) throw new Error(payload.error || '定制简历生成任务启动失败')
      setTask(payload)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : '定制简历生成任务启动失败')
    } finally {
      setStarting(false)
    }
  }

  return (
    <DialogShell className="max-w-2xl" label="AI 定制简历">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-black tracking-[0.16em] text-primary">
            <Sparkles className="h-4 w-4" />AI TAILORED RESUME
          </div>
          <h2 className="mt-1 text-2xl font-black text-foreground">为这个岗位生成定制简历</h2>
          <p className="mt-1 text-sm leading-6 text-muted">基于你的基础简历与当前 JD 生成岗位定制版；不会编造经历或项目数据。</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onClose}>关闭</Button>
      </div>

      <div className="mt-5 rounded-2xl border border-card-border bg-surface-subtle p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-muted">当前目标岗位</div>
            <div className="mt-1 text-lg font-black text-foreground">{job.company}｜{job.title}</div>
            <div className="mt-1 text-xs text-muted">{job.city || '城市未识别'} · {job.salary || '薪资未填写'} · 匹配分 {job.score || '未评分'}</div>
          </div>
          <span className="rounded-full bg-surface-accent px-3 py-1.5 text-xs font-black text-primary">单岗位生成</span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {previewSteps.map((step, index) => (
          <div key={step} className="rounded-2xl border border-card-border bg-white p-4 shadow-sm">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-accent text-sm font-black text-primary">{index + 1}</div>
            <p className="mt-3 text-sm font-bold leading-6 text-foreground">{step}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-card-border bg-surface-subtle p-4">
        <div className="flex items-center gap-2 text-sm font-black text-foreground"><FileText className="h-4 w-4 text-primary" />计划生成内容</div>
        <div className="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-2">
          {['岗位关键词对齐', '个人优势摘要', '经历重点排序', '生成结果预览与下载'].map(item => (
            <div key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" />{item}</div>
          ))}
        </div>
      </div>

      {(requestError || task?.status === 'failed') && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-danger">
          {requestError || task?.error || '定制简历生成失败，请稍后重试。'}
        </div>
      )}
      {generating && (
        <div className="mt-4 rounded-xl border border-blue-100 bg-surface-accent px-4 py-3 text-xs leading-5 text-primary">
          正在调用 AI 生成定制简历。{lastLog || '任务已启动，请保持此页面打开。'}
        </div>
      )}
      {generated && (
        <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs leading-5 text-success">
          定制简历已生成，可下载后人工检查并在 BOSS 直聘手动发送。
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-bold text-muted">将调用已配置的 AI 服务，可能产生模型费用。</span>
        <div className="flex gap-2">
          {generated && (
            <Button variant="secondary" onClick={() => window.open(`/api/jobs/${job.id}/resume/download`, '_blank')}>
              <Download className="mr-2 h-4 w-4" />下载简历
            </Button>
          )}
          <Button disabled={generating} onClick={() => void startGeneration()}>
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {generating ? '正在生成' : generated ? '重新生成' : '开始生成'}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
