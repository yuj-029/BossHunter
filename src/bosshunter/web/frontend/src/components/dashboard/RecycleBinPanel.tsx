import { RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/async-state'
import type { Job } from '@/hooks/useDashboard'

interface RecycleBinPanelProps {
  jobs: Job[]
  selectedIds: string[]
  loading: boolean
  onToggleSelected: (id: string) => void
  onSelectAll: (ids: string[]) => void
  onRestore: (ids: string[]) => void
  onPermanentDelete: (ids: string[]) => void
}

export function RecycleBinPanel({
  jobs,
  selectedIds,
  loading,
  onToggleSelected,
  onSelectAll,
  onRestore,
  onPermanentDelete,
}: RecycleBinPanelProps) {
  const allSelected = jobs.length > 0 && jobs.every(job => selectedIds.includes(job.id))
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5 text-primary" />回收站岗位</CardTitle>
        <span className="text-xs text-muted">{jobs.length} 条记录</span>
      </CardHeader>
      <CardContent className="p-0">
      {loading ? <div className="px-5 pb-5"><EmptyState title="正在读取回收站..." /></div> : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-y border-card-border bg-surface-subtle px-4 py-3 text-xs">
            <Button variant="secondary" size="sm" disabled={!jobs.length} onClick={() => onSelectAll(allSelected ? [] : jobs.map(job => job.id))}>{allSelected ? '取消全选' : '全选回收站'}</Button>
            <span className="rounded-full bg-surface-accent px-3 py-2 font-bold text-primary">已选择 {selectedIds.length} 条</span>
            <Button variant="secondary" size="sm" disabled={!selectedIds.length} onClick={() => onRestore(selectedIds)}><RotateCcw className="mr-1 h-3 w-3" />批量恢复</Button>
            <Button variant="destructive" size="sm" disabled={!selectedIds.length} onClick={() => onPermanentDelete(selectedIds)}><Trash2 className="mr-1 h-3 w-3" />永久删除</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b border-card-border bg-surface-accent text-xs text-muted"><th className="w-10 px-3 py-3">选</th><th className="px-4 py-3 text-left">公司</th><th className="px-4 py-3 text-left">职位</th><th className="px-4 py-3 text-left">原状态</th><th className="px-4 py-3 text-left">删除时间</th><th className="px-4 py-3 text-right">操作</th></tr></thead>
              <tbody>
                {jobs.map(job => <tr key={job.id} className="border-b border-card-border bg-white"><td className="px-3 py-3 text-center"><input type="checkbox" checked={selectedIds.includes(job.id)} onChange={() => onToggleSelected(job.id)} className="h-4 w-4 accent-primary" /></td><td className="px-4 py-3 font-black">{job.company}</td><td className="px-4 py-3">{job.title}</td><td className="px-4 py-3 text-muted">{job.status}</td><td className="px-4 py-3 text-xs text-muted">{job.deleted_at || '-'}</td><td className="px-4 py-3 text-right"><Button variant="secondary" size="sm" onClick={() => onRestore([job.id])}>恢复</Button><Button className="ml-2" variant="destructive" size="sm" onClick={() => onPermanentDelete([job.id])}>永久删除</Button></td></tr>)}
                {!jobs.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted">回收站为空</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      </CardContent>
    </Card>
  )
}
