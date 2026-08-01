# H5 页面生成平台

使用 `@anthropic-ai/claude-agent-sdk` + DeepSeek 模型实现的 H5 页面生成平台。核心创新是通过一个 **OpenAI 兼容代理层**，让 Anthropic SDK 透明地使用 DeepSeek 模型。

## 架构

```
h5-platform/
├── backend/                          # Nest.js
│   ├── src/
│   │   ├── main.ts                   # 启动入口，CORS
│   │   ├── app.module.ts             # 根模块
│   │   ├── proxy/
│   │   │   ├── proxy.controller.ts   # POST /v1/messages (Anthropic 兼容接口)
│   │   │   └── proxy.service.ts      # Anthropic ↔ OpenAI/DeepSeek 格式转换
│   │   ├── chat/
│   │   │   ├── chat.controller.ts    # POST /chat/send (SSE), GET /chat/conversations
│   │   │   ├── chat.service.ts       # 业务编排 + DB 持久化
│   │   │   └── deepseek.service.ts   # DeepSeek 直接调用
│   │   ├── agent-sdk/
│   │   │   ├── agent-run.service.ts     # 运行协调：续跑/重连/全量 snapshot
│   │   │   ├── agent-sdk.controller.ts  # POST /agent/run, GET /agent/status
│   │   │   ├── agent-sdk.module.ts
│   │   │   ├── agent-sdk.service.ts     # 封装 @anthropic-ai/claude-agent-sdk query()
│   │   │   └── game-system-prompt.ts    # 网页小游戏专精系统提示词
│   │   ├── conversation/
│   │   │   ├── conversation.service.ts
│   │   │   └── entities/
│   │   │       ├── conversation.entity.ts
│   │   │       └── message.entity.ts
│   │   ├── output-dir.ts                # 统一 h5-output 路径解析
│   │   └── database/
│   │       └── database.module.ts    # TypeORM + SQLite
│   ├── .env                          # DeepSeek API Key
│   └── data/h5-platform.db           # SQLite 数据库
├── frontend/                         # Next.js
│   └── app/
│       ├── page.tsx                  # 左右分栏布局
│       ├── components/
│       │   ├── ChatPanel.tsx         # 左侧：对话区
│       │   ├── ChatMessage.tsx       # 消息组件 (Markdown + 思考/工具事件流)
│       │   └── PreviewPanel.tsx      # 右侧：iframe 预览区
│       └── hooks/
│           └── useChatSSE.ts         # SSE 流式接收 hook
└── .gitignore
```

## 核心创新：OpenAI 兼容代理层

`@anthropic-ai/claude-agent-sdk` 目前仅支持 Anthropic 系列模型。为了让 SDK 能使用 DeepSeek，我们实现了一个透明的格式转换代理层：

```
Anthropic Request                    OpenAI/DeepSeek Request
┌──────────────────────┐             ┌──────────────────────┐
│ POST /v1/messages    │    proxy    │ POST /v1/chat/       │
│ model: claude-...    │ ──────────→ │   completions         │
│ messages: [...]      │             │ model: deepseek-...   │
│ thinking: enabled    │   convert   │ messages: [...]       │
│ stream: true         │             │ extra_body: {         │
└──────────────────────┘             │   thinking_mode }     │
       ↕                             └──────────────────────┘
       │  convert back
       ↕
Anthropic SSE (message_start → thinking_delta → signature → text_delta → message_stop)
```

通过设置环境变量 `ANTHROPIC_BASE_URL=http://localhost:3001`，SDK 内部的所有 API 调用都会被重定向到我们的代理层，SDK 完全无感知。

转换层已覆盖以下兼容点：

- `toolu_xxx` ↔ `call_xxx` 工具调用 ID 全量往返，不截断，保证 tool_result 能对应到 assistant tool_use。
- 并行工具调用按 OpenAI stream index 分别累积参数，避免多个工具参数互相串线。
- `tool_result` 中的普通文本会保留为独立 user 消息，满足 OpenAI 消息顺序要求。
- 流式结束前会补全所有 thinking/text/tool 的 `content_block_stop`，避免悬挂 block。

## 完整数据流

```
Frontend (Next.js)
    ↓ POST /agent/run
AgentSdkService.query()
    ↓ env: ANTHROPIC_BASE_URL=http://localhost:3001
@anthropic-ai/claude-agent-sdk
    ↓ spawns Claude CLI subprocess
Claude CLI (with ANTHROPIC_BASE_URL)
    ↓ POST http://localhost:3001/v1/messages
ProxyService (Anthropic → OpenAI 转换)
    ↓ POST https://api.deepseek.com/v1/chat/completions
DeepSeek API (streaming)
    ↓ reasoning_content + content
ProxyService (OpenAI → Anthropic 转换)
    ↓ SSE events (thinking_delta, text_delta, ...)
Claude CLI subprocess
    ↓ yields SDKMessages
@anthropic-ai/claude-agent-sdk
    ↓ Query async iterable
AgentSdkService → AgentRunService
    ↓ 增量落库 + 广播（支持刷新后重新 attach）
AgentRunService → AgentSdkController
    ↓ snapshot + SSE events (thinking, tool_start, text, done)
Frontend (ChatPanel + PreviewPanel)
```

## API 端点

| 端点 | 说明 | 格式 |
|---|---|---|
| `POST /v1/messages` | Anthropic 兼容代理（供 SDK 调用） | Anthropic SSE 协议 |
| `POST /agent/run` | **SDK 全链路** query() → 代理 → DeepSeek | 自定义 SSE |
| `GET /agent/status` | 查询任务是否正在运行 | JSON |
| `POST /chat/send` | 直接对话（直接调 DeepSeek） | 自定义 SSE |
| `GET /chat/conversations` | 对话列表 | JSON |
| `GET /chat/conversations/:id` | 对话详情 | JSON |

### SSE 事件格式

`POST /agent/run` 使用以下事件格式；页面刷新重连时会先收到 `snapshot` 全量消息，再继续接收增量事件：

```
event: snapshot
data: {"messages":[...],"runStatus":"running"}

event: meta
data: {"conversationId":"...","messageId":"...","sdkSessionId":"..."}

event: thinking
data: {"content":"推理过程..."}

event: tool_start
data: {"toolName":"Write","toolId":"...","toolInput":{}}

event: tool_update
data: {"toolName":"Write","toolId":"...","toolInput":{"file_path":"h5-output/game.html"}}

event: text
data: {"content":"回复文本..."}

event: done
data: {"messageId":"...","usage":{"input_tokens":179,"output_tokens":30}}
```

`POST /agent/run` 支持两种模式：

```json
// 新建/继续一轮任务
{ "prompt": "做一个飞机大战游戏", "conversationId": "..." }

// 页面刷新后重连正在运行的任务
{ "conversationId": "...", "resumeSessionId": "...", "reattach": true }
```

### 刷新续跑

- 后端任务由 `AgentRunService` 持有，不依赖单个 SSE 连接；页面刷新后任务继续执行。
- 任务运行时，thinking/text/tool 事件会增量写入 SQLite，连续 thinking/text 自动合并。
- 前端进入任务页先读取 `runStatus`；如果为 `running`，自动调用 `reattach` 重新连接。
- 后端进程重启后，可通过 `sdkSessionId` 使用 Claude SDK 的 resume 继续任务。

## 数据库模型

### Conversation
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| title | string | 对话标题 |
| sdkSessionId | string | Claude SDK 会话 ID，用于 resume |
| status | string | active / archived |
| runStatus | string | idle / running / completed / error |
| outputFiles | text | 生成的输出文件路径 JSON |
| createdAt | datetime | 创建时间 |
| updatedAt | datetime | 更新时间 |

### Message
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| role | 'user' \| 'assistant' | 消息角色 |
| content | text | 消息内容 |
| thinkingChain | text | DeepSeek 思考链（reasoning_content） |
| events | text | 按时间顺序保存的 thinking/tool/text 事件 JSON |
| conversationId | UUID | 外键 |
| createdAt | datetime | 创建时间 |

## 小游戏专精提示词

`backend/src/agent-sdk/game-system-prompt.ts` 内置了一套网页小游戏专精提示词，会追加到 Claude Code 默认系统提示词之后：

- 输出为单个自包含 HTML 文件，不使用外部 CDN、框架、字体或图片。
- 文件必须生成到 `backend/h5-output`，不能写外部绝对路径。
- 游戏必须包含完整核心循环：开始、游玩、结束/胜利、重开。
- 支持键盘、鼠标、触屏，并使用 `requestAnimationFrame` + `deltaTime`。
- 优先包含分数/进度、生命/时间、关卡/难度、音效、动效、暂停/重开。
- 完成后用中文总结游戏名称、文件路径、操作方式和核心特色。

## 输出目录约束

- `backend/src/output-dir.ts` 统一解析 `backend/h5-output`。
- `AgentSdkService` 通过 `PreToolUse` hook 把 `Write` / `Edit` 的外部路径重写到 `h5-output`。
- Bash 中明显写到 `h5-output` 之外的重定向、`mkdir`、`touch` 等操作会被拒绝。
- 任务结束时如果发现仍有外部 HTML，会复制一份到 `h5-output`，前端预览统一从 `/output/<文件名>` 读取。

## 快速开始

### 前提

- Node.js >= 18
- DeepSeek API Key（从 [platform.deepseek.com](https://platform.deepseek.com) 获取）
- Claude CLI：`npm install -g @anthropic-ai/claude-code`（SDK 全链路需要）

### 安装与运行

```bash
# 1. 安装后端依赖
cd backend
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 DEEPSEEK_API_KEY

# 3. 启动后端（端口 3001）
npm run start:dev

# 4. 新终端，安装前端依赖
cd frontend
npm install

# 5. 启动前端（端口 3000）
npm run dev

# 6. 浏览器打开 http://localhost:3000
```

## 技术栈

- **后端框架**: Nest.js 11
- **AI SDK**: @anthropic-ai/claude-agent-sdk
- **AI 模型**: DeepSeek（通过 OpenAI 兼容 API 调用）
- **数据库**: SQLite + TypeORM
- **前端框架**: Next.js 15 + React 19
- **样式**: Tailwind CSS 4
- **Markdown**: react-markdown + remark-gfm
