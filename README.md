# Muse Studio

一个面向 AI Agent 的开源工作区平台。

Muse Studio 将模型、Agent、Skill、MCP、实时事件流和项目工作区组合在一起：用户可以选择智能体描述需求，观察完整执行过程，并在同一个任务页面中预览生成结果、浏览和修改代码。它不仅适用于 H5，也适用于后台系统、工具页、原型和其他可运行项目。

![Muse Studio 项目展示](image.png)

## 能力概览

### 会话驱动的 Agent 工作流

- 在会话页面选择智能体、输入需求并发送。
- 每次请求自动创建任务并进入任务详情页。
- 任务使用 SDK session ID 支持刷新重连和后续续跑。
- 实时展示思考、文本回复、工具调用、命令输出、Skill、MCP、子 Agent 和运行状态。
- Ask User Question 支持 Agent 在执行过程中向用户提问，并在回答后继续运行。
- 任务过程和消息持久化到 SQLite，方便查看历史记录。

### 多模型接入与统一体验

平台通过 Provider Adapter 和统一事件协议屏蔽不同模型的 API 差异，当前可接入：

- DeepSeek
- GPT 及其他 OpenAI-compatible API
- 任何兼容 Chat Completions 接口、并支持工具调用的模型服务

模型可以通过环境变量切换，不需要修改前端交互。平台会将上游模型的 reasoning、文本、工具和子 Agent 信号归一化为 MuseEvent，前端按统一顺序展示。

> 当前 Agent 执行链路使用 Anthropic Agent SDK，并由平台的兼容代理将 SDK 请求转换到 OpenAI-compatible 上游。模型提供商不需要直接暴露给前端。

项目的模型适配层位于后端，后续接入新的 OpenAI-compatible 模型时，通常只需要调整 Provider Adapter 和环境变量。

### 智能体管理

智能体是可复用的执行入口，支持：

- 自定义名称、唯一 code、描述和系统提示词。
- 富文本提示词编辑。
- 类型选择：生码、其他。
- 绑定 Skill 分组。
- 绑定一个或多个 MCP。
- 新增、编辑、删除和按 code 查询。

智能体类型会影响任务详情页的工作区展示：生码智能体支持页面预览和代码预览，其他类型以代码工作区为主。

### Skill 与 Skill 分组

- 内置 Skill 和用户自定义 Skill 统一管理。
- Skill 内容支持富文本编辑，并以抽屉形式维护。
- Skill 支持启用、停用、修改和删除。
- 可创建 Skill 分组，并将已有 Skill 组合成可复用能力包。
- Agent 只需要绑定 Skill 分组，即可在任务运行时加载其中的 Skill。

项目内置了页面展示和后台页面生成相关 Skill，也可以按项目需要继续添加自己的规范、领域知识和工作流。

### MCP 工具生态

平台提供 MCP 的配置、安装、运行和绑定能力：

- 内置 MCP：工作区文件操作、预览服务等。
- 远程 Streamable HTTP MCP。
- npm MCP：安装 npm 包并解析其 `bin` 或 `main` 入口。
- MCP 的增删改查、启用/停用和安装状态管理。
- Agent 绑定 MCP 后，运行时自动注入工具。
- 工具调用结果在消息流中折叠展示，避免长命令和大段结果占满对话。

MCP 配置会经过名称、路径、版本和工作区边界校验。对于第三方 MCP，建议只接入可信来源，并按最小权限配置环境变量和请求头。

### 代码工作区与实时预览

每个任务都有独立的工作区，支持：

- Monaco Editor 查看和修改代码。
- 新增、修改、删除文件。
- 新增、删除文件夹。
- 文件树浏览和路径校验。
- Agent 通过工具修改代码后，代码区域自动刷新。
- 页面预览和代码预览切换。
- 桌面端和移动端预览切换。
- 使用开发服务器预览，支持代码修改后的热更新。
- 预览服务健康检查、端口分配和异常重启。

预览地址由主服务代理，不直接暴露沙箱端口；因此前端只需要访问任务对应的预览路径。

### 图片附件与多模态输入

- 会话支持上传图片。
- 图片保存到当前任务的工作区附件目录。
- 上传接口返回图片地址和附件元数据。
- 对话参数通过 `attachments` 传递附件，不把服务器路径写入用户消息文本。
- 对话中展示图片缩略图，点击可以查看大图。
- Agent 执行时可读取工作区内的图片，并将图片作为多模态输入提交给模型。

### 沙箱与安全边界

Agent SDK 运行在独立的 sandbox 服务中，主服务负责编排、持久化、代理和事件分发。默认边界包括：

- 每个任务使用独立工作区。
- 文件读写限制在当前工作区内。
- 外部绝对路径写入会被拦截或重写。
- 预览服务只通过主服务代理访问。
- 模型 API Key 只由后端和兼容代理使用，不下发到浏览器或沙箱。
- npm MCP 安装默认关闭生命周期脚本，降低安装第三方包时的风险。
- 子 Agent 可配置开关；测试环境默认关闭，以控制执行时间和 Token 消耗。

## 产品页面

| 页面 | 用途 |
| --- | --- |
| 会话 | 选择智能体、上传图片、输入需求并开始一次工作 |
| 任务 | 查看任务历史和完整执行过程 |
| 任务详情 | 查看消息、思考、工具、Ask User、预览和代码工作区 |
| 智能体 | 管理可复用的 Agent、提示词和能力绑定 |
| Skill | 管理内置及自定义 Skill |
| Skill 分组 | 将已有 Skill 组合成 Agent 可绑定的能力组 |
| MCP | 管理内置、远程 HTTP 和 npm MCP |

## 工作流

```text
选择智能体
    ↓
输入需求 / 上传图片
    ↓
创建任务并进入任务详情
    ↓
Agent SDK 执行
    ├─ 思考与回复
    ├─ 调用 Skill / MCP / 文件工具
    ├─ 修改任务工作区
    └─ 启动并验证开发预览
    ↓
实时查看执行过程、页面预览和代码
```

## 项目结构

```text
.
├── backend/       # NestJS 主服务：任务编排、数据库、代理、事件和管理 API
├── sandbox/       # 独立 Agent 执行沙箱、MCP 服务和预览服务
├── frontend/      # Next.js 用户界面、会话、任务、管理后台和工作区
├── skills/        # 内置 Skill
└── docs/          # 设计和开发说明
```

### 服务职责

```text
浏览器
  ↓ HTTP / SSE / Socket.IO
Backend (:3001)
  ├── 会话和任务持久化
  ├── Agent 运行编排
  ├── 模型兼容代理
  ├── 统一事件流
  └── 预览反向代理
      ↓ HTTP / SSE
Sandbox (:3002)
  ├── Claude Agent SDK
  ├── 工作区 MCP
  ├── 预览 MCP
  └── 独立项目 dev server
```

## 快速开始

### 环境要求

- Node.js 18 或更高版本
- 一个 OpenAI-compatible 模型服务及 API Key
- Agent SDK 运行所需的 Claude Code CLI 环境

### 安装依赖

```bash
cd backend && npm install --legacy-peer-deps
cd ../sandbox && npm install --legacy-peer-deps
cd ../frontend && npm install --legacy-peer-deps
```

### 配置模型

创建后端环境变量文件：

```bash
cd backend
touch .env
```

填写自己的模型服务配置：

```dotenv
AI_BASE_URL=https://api.example.com/v1
AI_MODEL=your-model-name
AI_API_KEY=your-api-key
AI_REASONING_EFFORT=medium
ENABLE_SUBAGENTS=false
MAX_TURNS=40
```

`AI_BASE_URL` 应指向 OpenAI-compatible API 的版本根路径，平台会请求其 `/chat/completions` 接口。不要把真实 API Key 提交到 Git 仓库。

### 启动

分别启动三个服务：

```bash
cd sandbox && npm run start
cd backend && npm run start:dev
cd frontend && npm run dev
```

或使用根目录启动脚本：

```bash
./start.sh
```

默认地址：

| 服务 | 地址 |
| --- | --- |
| 前端 | http://localhost:3000 |
| 主服务 | http://localhost:3001 |
| 沙箱 | http://localhost:3002 |

前端开发模式使用 Next.js Fast Refresh。任务预览使用项目自己的 dev server，以便代码更新后保持热更新。

## 开发者接口

平台的主要接口包括：

| 接口 | 说明 |
| --- | --- |
| `POST /agent/run` | 创建或续跑 Agent 任务，返回 SSE 事件流 |
| `GET /agent/status` | 查询任务运行状态 |
| `POST /agent/stop` | 停止任务 |
| `GET /chat/conversations` | 获取会话列表 |
| `GET /chat/conversations/:id` | 获取会话详情 |
| `GET/POST/PUT/DELETE /agents` | 智能体管理 |
| `GET/POST/PUT/DELETE /skills` | Skill 管理 |
| `GET/POST/PUT/DELETE /skill-groups` | Skill 分组管理 |
| `GET/POST/PUT/DELETE /mcps` | MCP 管理 |
| `GET/PUT/POST/DELETE /workspace/:conversationId/*` | 工作区文件和附件管理 |
| `POST /v1/messages` | Anthropic Messages 兼容代理 |

任务事件通过 SSE 推送；预览状态通过 Socket.IO 推送。前端不需要理解不同模型的原始返回格式，只消费平台统一后的事件。

## 统一事件协议

平台内部将不同来源的运行信息归一化为 `MuseEvent`，主要事件包括：

- `run.*`：任务开始、完成、失败、停止。
- `reasoning.*`：思考开始、增量和完成。
- `message.*`：回复文本增量和完成。
- `tool.*`：工具开始、更新、完成和失败。
- `subagent.*`：子 Agent 生命周期和进度。
- `mcp.*`、`skill.*`：MCP 与 Skill 状态。
- `ask_user.*`：Agent 提问和用户回答。
- `command.output`：命令输出。

这层协议让模型适配逻辑集中在后端，前端交互保持稳定，也便于未来接入更多模型或其他 Agent Runtime。

## 技术栈

- Next.js 15、React 19、Tailwind CSS 4、Ant Design 5
- NestJS 11、TypeORM、SQLite
- `@anthropic-ai/claude-agent-sdk`
- Model Context Protocol SDK
- Monaco Editor
- SSE、Socket.IO

## 开源说明

本项目目前处于持续迭代阶段，适合用于：

- 搭建自己的 AI Agent 工作台。
- 研究模型适配、统一事件流和 Agent 执行链路。
- 集成企业内部 Skill、MCP 和代码生成规范。
- 快速验证从自然语言到可运行项目的产品形态。

欢迎提交 Issue、改进建议和 Pull Request。涉及模型服务、MCP 或第三方依赖时，请先确认相关服务的许可、费用和安全策略。
