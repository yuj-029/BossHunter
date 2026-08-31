# AI 评分故障排查与恢复

本文用于排查 BossHunter 2.3.1 在 Windows 桌面环境中的 AI 评分故障，覆盖连接检测、协议配置、批量任务、失败恢复和多进程冲突。

## 适用现象

- 页面提示 Invalid port: ':1]:15721'
- 所有岗位在数秒内同时出现“评分任务异常: TypeError”
- AI 诊断显示正常，但真实评分返回 401、403、404 或模型权限错误
- 批量任务显示 completed，但 ai_failed 等于总岗位数
- 评分弹窗长期显示“评分中”，关闭并重新打开后状态才变化
- 同一地址有时正常、有时报旧错误

## 先判断是否真的可用

以下条件必须同时成立：

1. /api/health 返回预期版本。
2. /api/diagnostics/ai 通过真实消息接口验证，而不只是访问模型列表。
3. 单岗位评分任务为 completed。
4. 任务指标中 ai_failed=0。
5. 对应岗位具有正常分数和评分理由，理由不是“AI评分失败:”前缀。
6. 确认成功后才允许扩大批量范围。

模型列表接口返回 200 不能单独证明评分可用；部分兼容服务不提供模型列表，也可能允许访问列表但拒绝指定模型的消息请求。

## 标准排查顺序

### 1. 检查服务版本和重复监听

    Invoke-RestMethod http://127.0.0.1:8686/api/health
    netstat -ano | Select-String ':8686'

预期只有一条 127.0.0.1:8686 LISTENING。存在多个 PID 时，先确认工作台没有活动任务，再停止旧实例，只保留一个当前版本服务。

多个 Python 进程同时监听同一端口时，请求可能随机落到不同版本，表现为同一操作时好时坏。不要只根据一次健康检查判断已经切换成功。

### 2. 检查 Windows 代理环境

    [pscustomobject]@{
      process_no_proxy = $env:NO_PROXY
      user_no_proxy = [Environment]::GetEnvironmentVariable('NO_PROXY', 'User')
    }

部分旧版 HTTP 库无法正确解析带端口的 IPv6 NO_PROXY 项，例如 [::1]:15721，典型错误为 Invalid port: ':1]:15721'。

AI 外部请求应显式使用 trust_env=False，不继承桌面工具注入的代理变量。本地浏览器运行时可继续使用自身的本地连接配置。

### 3. 检查协议、地址、模型和密钥是否属于同一服务

OpenAI Chat Completions 兼容配置：

    ai:
      provider: openai_compatible
      service: custom
      model: <服务商支持的模型 ID>
      base_url: <服务商提供的 API 根地址>

Anthropic Messages 兼容配置：

    ai:
      provider: anthropic
      service: anthropic
      model: <服务商支持的模型 ID>
      base_url: <服务商提供的 Anthropic 兼容根地址>

必须同时核对：

- 协议是否与 Base URL 对应
- 模型 ID 是否由该地址提供
- API Key 是否属于同一服务、区域、工作空间和套餐
- Key 是否过期、被撤销或没有目标模型权限

切换服务商时不能只改模型和地址而保留旧服务的密钥。排查日志只能记录密钥来源或脱敏前缀，禁止输出完整密钥。

### 4. 运行真实连接诊断

    Invoke-RestMethod http://127.0.0.1:8686/api/diagnostics/ai

预期 ok=true、status=pass、message=AI 接口连接正常。

诊断会发送一次极小真实消息请求。瞬时网络错误允许重试一次；鉴权、模型权限和额度错误不能降级为警告。

### 5. 预览并只评分一个岗位

先调用评分预览，确认目标数量和最大请求次数，再选择一个本地预筛通过的岗位启动评分。不要用整批任务测试配置。

验收指标：

    task_status = completed
    run_status = completed
    ai_completed = 1
    ai_failed = 0
    remaining = 0

岗位被评分为低分并进入 filtered 属于正常业务结果，不代表评分失败。

## 批量任务安全规则

- 鉴权、额度、限流、网络或系统异常应暂停任务，并保留当前及未开始的岗位。
- 未知异常不能转换成普通单岗位失败后继续整批执行。
- 基础简历为空或无法读取时必须立即失败，不能留下永久 running 的评分记录。
- 任务暂停后必须保留 remaining_job_ids，并在前端提供继续或结束入口。
- 前端应持续轮询任务状态，并明确显示 failed、paused 和 completed_with_errors。
- 失败日志应保留脱敏后的异常类型和简短原因，不得包含 API Key、完整请求头或私人简历内容。

## 常见错误对照

| 现象 | 主要原因 | 处理 |
|---|---|---|
| Invalid port ':1]:15721' | HTTP 库误解析 IPv6 NO_PROXY | AI 请求关闭环境代理继承；清理重复旧进程 |
| HTTP 401 / InvalidApiKey | Key 与地址、套餐或区域不匹配 | 更换为对应服务的 Key，不要尝试不同请求头绕过 |
| HTTP 404 | 协议路径不匹配，或服务没有模型列表接口 | 核对 OpenAI/Anthropic 协议；用真实消息接口判断 |
| 任务瞬间全部 TypeError | 公共客户端初始化失败或运行环境异常 | 首个未知异常立即暂停整批并保留剩余岗位 |
| 页面显示完成但全部失败 | 任务状态只看线程结束，没有看评分指标 | 同时检查 run 状态、ai_failed 和岗位落库结果 |
| 一直显示评分中 | 前端没有轮询，或评分记录卡在 running | 开启状态轮询；空简历和启动异常必须将 run 标为 failed |
| 同一接口时好时坏 | 多个新旧服务同时监听同一端口 | 清理全部旧监听，只启动一个当前版本实例 |

## 回归验证

修改评分链路后至少运行：

    .\.venv\Scripts\python.exe -m pytest tests\test_scoring_recovery.py tests\test_scoring_config.py tests\test_ai_token_resilience.py tests\test_ai_services.py tests\test_ai_credentials.py tests\test_web_preflight.py tests\test_web_api_routes.py -q

前端修改后运行：

    cd src\bosshunter\web\frontend
    npm run build

必须补充或保留以下回归场景：

- 模型列表 404 时，通过真实消息接口继续验证
- 真实消息接口鉴权失败时，诊断返回 error
- 瞬时网络失败只重试一次
- Worker 未知异常暂停整批并保留全部岗位
- 空简历使评分任务明确失败
- 前端自动刷新评分状态并展示失败记录

## 2026-08-28 事故记录

本次故障由多个问题叠加：

1. Windows 桌面环境注入的 IPv6 NO_PROXY 触发旧 HTTP 库解析错误。
2. AI 服务地址、协议和密钥在切换服务后不匹配，真实消息请求被拒绝。
3. 模型列表 404 被诊断逻辑误判为可继续，造成假绿灯。
4. 未知 Worker 异常被吞成单岗位失败，整批任务继续执行并显示假完成。
5. 同一端口存在多个新旧服务，导致请求随机命中不同实现。
6. 前端不持续刷新评分运行状态，错误反馈滞后。

修复后的验收结果：

- 主端口只保留一个 2.3.1 服务实例
- 真实 AI 消息连接连续通过
- 主端口单岗位评分完成，ai_failed=0
- 评分相关回归测试 145 项通过
- 前端生产构建通过

事故处理中未自动重跑剩余批量岗位，避免额外 Token 消耗。自动打招呼功能保持关闭，AI 评分与消息发送继续保持独立。

## 相关代码

- src/bosshunter/ai/credentials.py：协议分流、HTTP 客户端和错误归一化
- src/bosshunter/ai/scorer.py：评分、预筛、熔断和进度检查点
- src/bosshunter/web/preflight.py：真实 AI 连接诊断
- src/bosshunter/web/server.py：评分任务 API 和运行状态
- src/bosshunter/web/frontend/src/components/dashboard/ScoreJobsDialog.tsx：评分预览、进度和恢复入口
