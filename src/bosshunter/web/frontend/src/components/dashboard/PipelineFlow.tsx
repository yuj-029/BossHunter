import { Search, Bot, FileText, CheckCircle, MessageSquare, Eye } from 'lucide-react'
import { Card } from '@/components/ui/card'

const steps = [
  { icon: Search, label: '采集', desc: '搜索岗位' },
  { icon: Bot, label: 'AI评分', desc: '匹配打分' },
  { icon: CheckCircle, label: '人工确认', desc: '审核通过' },
  { icon: FileText, label: '定制简历', desc: '按需生成' },
  { icon: MessageSquare, label: '手动沟通', desc: '人工发送' },
  { icon: Eye, label: '监控', desc: '跟进回复' },
]

export function PipelineFlow() {
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-base font-black text-foreground">BossHunter 求职流程</h3>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {steps.map((step, i) => (
          <div key={step.label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl border border-card-border bg-surface-subtle transition-colors hover:border-primary/50">
                <step.icon className="w-5 h-5 text-primary" />
              </div>
              <span className="text-xs font-bold text-foreground">{step.label}</span>
              <span className="mt-0.5 text-[10px] text-muted">{step.desc}</span>
            </div>
            {i < steps.length - 1 && (
              <div className="mx-2 mb-6 hidden h-px w-8 bg-card-border sm:block" />
            )}
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">
        采集与 AI 评分可批量执行；岗位确认、定制简历和沟通由你手动推进。
      </p>
    </Card>
  )
}
