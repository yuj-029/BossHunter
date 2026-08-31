import { useEffect, useState } from 'react'
import { CheckCircle2, Copy, MessageCircle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import type { Job } from '@/hooks/useDashboard'

interface CustomGreetingDialogProps {
  job: Job | null
  onClose: () => void
  onGenerated: () => void
}

export function CustomGreetingDialog({ job, onClose, onGenerated }: CustomGreetingDialogProps) {
  const [greeting, setGreeting] = useState('')
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setGreeting(job?.greeting || '')
    setMessage('')
  }, [job])

  if (!job) return null

  const generate = async () => {
    setGenerating(true)
    setMessage('')
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/greeting/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '生成定制招呼语失败')
      setGreeting(data.greeting || '')
      setMessage('已生成并保存草稿，未发送。')
      onGenerated()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成定制招呼语失败')
    } finally {
      setGenerating(false)
    }
  }

  const copyGreeting = async () => {
    if (!greeting) return
    try {
      await navigator.clipboard.writeText(greeting)
      setMessage('已复制，可到 BOSS 直聘手动粘贴发送。')
    } catch {
      setMessage('复制失败，请手动选中文本复制。')
    }
  }

  return (
    <DialogShell className="max-w-2xl" label="生成定制招呼语">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-black tracking-[0.16em] text-primary">
            <Sparkles className="h-4 w-4" />AI CUSTOM GREETING
          </div>
          <h2 className="mt-1 text-2xl font-black text-foreground">生成定制招呼语</h2>
          <p className="mt-1 text-sm leading-6 text-muted">根据基础简历、岗位 JD 和评分理由生成短语；只保存和复制，不会自动发送。</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onClose}>关闭</Button>
      </div>

      <div className="mt-5 rounded-2xl border border-card-border bg-surface-subtle p-4">
        <div className="flex items-start gap-3">
          <MessageCircle className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <div className="font-black text-foreground">{job.company}｜{job.title}</div>
            <div className="mt-1 text-xs text-muted">{job.city || '城市未识别'} · {job.salary || '薪资未填写'} · 匹配分 {job.score || '未评分'}</div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <label className="text-sm font-black text-foreground" htmlFor="custom-greeting-result">招呼语草稿</label>
        <textarea
          id="custom-greeting-result"
          readOnly
          value={greeting}
          placeholder="点击“生成招呼语”，AI 会在这里返回一条可复制的岗位定制短语。"
          className="mt-2 min-h-36 w-full resize-none rounded-2xl border border-card-border bg-white p-4 text-sm leading-7 text-foreground outline-none focus:border-primary"
        />
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
        自动发送保持关闭。生成后请核对事实，再复制到 BOSS 直聘手动发送。
      </div>

      {message && (
        <div className="mt-3 flex items-center gap-2 text-sm font-bold text-primary">
          {greeting && <CheckCircle2 className="h-4 w-4" />}{message}
        </div>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={!greeting || generating} onClick={copyGreeting}>
          <Copy className="mr-2 h-4 w-4" />复制招呼语
        </Button>
        <Button disabled={generating} onClick={generate}>
          <Sparkles className="mr-2 h-4 w-4" />{generating ? '生成中...' : greeting ? '重新生成' : '生成招呼语'}
        </Button>
      </div>
    </DialogShell>
  )
}
