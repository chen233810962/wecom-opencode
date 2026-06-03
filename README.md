# WeCom OpenCode Bridge

企业微信 ↔ OpenCode AI 双向消息桥接服务。

将企业微信机器人收到的消息转发到 OpenCode AI 会话中处理，再将 AI 回复实时发送回企业微信。支持加载项目内的 MCP 服务、Skills 等插件能力，在企微中直接调用 AI 操作项目。

---

## 功能特性

- **双向桥接**：企业微信消息 → OpenCode AI 处理 → 回复发送到企业微信
- **项目集成**：自动加载项目 `.opencode/opencode.json` 中的 MCP 服务配置
- **Skills 兼容**：支持 OpenCode 项目内安装的所有 Skills 和插件
- **多会话管理**：每个企业微信用户自动分配独立 AI 会话，上下文隔离
- **固定会话模式**：可配置为所有用户共享同一会话
- **语音消息支持**：自动识别语音消息中的文字内容（需企业微信客户端支持）
- **消息去重**：内置 WebSocket 消息 ID 去重，防止重复处理
- **自动启动 OpenCode 服务**：无需手动启动 AI 后端，桥接服务自动管理
- **超长回复截断**：自动截断超长回复，符合企业微信消息长度限制
- **优雅关闭**：支持信号捕获，优雅释放资源
- **后台运行**：提供 Windows 后台启动/停止脚本

---

## 系统架构

```
┌──────────────────┐      WebSocket       ┌──────────────────────┐
│  企业微信客户端   │ ◄──────────────────► │   WeCom SDK 机器人    │
│  (用户发送消息)   │                      │  (消息收发/流式回复)  │
└──────────────────┘                      └──────────┬───────────┘
                                                      │
                                                      ▼
┌──────────────────┐      HTTP API        ┌──────────────────────┐
│  OpenCode AI 服务 │ ◄──────────────────► │   OpenCode SDK 客户端  │
│  (推理/插件/MCP)  │                      │  (会话管理/消息发送)  │
└──────────────────┘                      └──────────┬───────────┘
                                                      │
                                                      ▼
                                          ┌──────────────────────┐
                                          │   会话管理器           │
                                          │  (用户 ↔ 会话 映射)   │
                                          └──────────────────────┘
```

### 数据流

1. 用户在企微中发送消息
2. WeCom SDK WebSocket 接收消息 → 标准化处理
3. 会话管理器查找/创建该用户的 OpenCode 会话
4. OpenCode SDK 客户端将会话 ID + 消息内容发送到 OpenCode 服务
5. OpenCode 加载项目 MCP/Skills 处理请求，返回 AI 回复
6. 回复通过 WeCom SDK 流式发送回企业微信

---

## 目录结构

```
wecom-opencode/
├── index.js                  # 入口文件（启动/关闭桥接服务）
├── config.json               # 配置文件（直接编辑）
├── package.json              # 项目依赖
├── start.bat                 # Windows 前台启动脚本
├── start-background.vbs      # Windows 后台启动脚本（无窗口）
├── stop-background.bat       # Windows 后台停止脚本
├── stop-background.vbs       # Windows 后台停止脚本（无窗口）
├── stop-bridge.ps1           # PowerShell 停止脚本
└── src/
    ├── config.js             # 配置加载与合并
    ├── logger.js             # 结构化 JSON 日志
    ├── wecom-client.js       # 企业微信 WebSocket 客户端
    ├── opencode-client.js    # OpenCode API 客户端
    ├── session-manager.js    # 会话管理器
    └── message-handler.js    # 消息处理编排
```

---

## 快速开始

### 前置条件

- **Node.js** >= 18.0.0
- **OpenCode** 已安装并可用（如使用自动启动模式则无需手动启动）
- **企业微信机器人** 已创建并获取 Bot ID 和 Secret

### 安装

```bash
# 将 wecom-opencode 复制到目标项目根目录
cp -r wecom-opencode /项目目录/

# 进入项目目录
cd /项目目录/wecom-opencode

# 安装依赖
npm install
```

### 配置

直接编辑项目根目录下的 `config.json`，完整配置项如下：

```jsonc
{
  "bot": {
    "botId": "your_bot_id",       // 企业微信机器人 Bot ID（必填）
    "secret": "your_bot_secret"    // 企业微信机器人密钥（必填）
  },
  "opencode": {
    "baseUrl": "http://127.0.0.1:4096",   // OpenCode 服务地址
    "timeout": 120000,                      // AI 回复超时时间（毫秒）
    "sessionTitle": "微信用户",             // 会话标题前缀
    "fixedSessionId": "",                   // 固定会话 ID（为空则为每个用户创建独立会话）
    "directory": "D:\\path\\to\\project",   // 项目目录（用于绑定 MCP/Skills）
    "botName": "订单数据Ai"                  // 机器人显示名称（自动移除群聊 @前缀）
  },
  "bridge": {
    "messageTimeoutMs": 120000,             // 消息处理超时（毫秒）
    "maxResponseLength": 20480,             // 最大回复长度（字符数）
    "logLevel": "info"                      // 日志级别：debug / info / warn / error
  },
  "opencodeServer": {
    "autoStart": true,                      // 是否自动启动 OpenCode 服务
    "hostname": "127.0.0.1",                // 监听地址
    "port": 0,                              // 监听端口（0 = 从 baseUrl 自动推导）
    "startupTimeout": 30000                 // 启动超时（毫秒）
  }
}
```

> **注意**：`opencode.directory` 指向你的项目目录。桥接服务会自动读取该项目下的 `.opencode/opencode.json` 配置，加载其中的 MCP 服务，使 AI 在企微中也能操作项目数据。

### 启动

#### Linux 部署（生产用）

在 Linux 服务器上运行桥接服务，开放 OpenCode 端口 `4096`：

```bash
cd /项目目录/wecom-opencode

# 常驻后台运行（使用 nohup）
nohup node index.js > bridge.log 2>&1 &
```

推荐使用 `systemd` 或 `pm2` 管理进程以实现自动重启：

```bash
# 使用 pm2
npm install -g pm2
pm2 start index.js --name wecom-opencode
pm2 save
pm2 startup
```

#### Windows 前台启动（调试用）

双击 `start.bat` 或在命令行运行：

```bash
cd /项目目录/wecom-opencode
node index.js
```

#### Windows 后台启动（生产用）

双击 `start-background.vbs`，启动后无控制台窗口。

#### 停止服务

- 前台模式：按 `Ctrl + C`
- 后台模式：双击 `stop-background.vbs` 或运行 `stop-bridge.ps1`

---

## 配置详解

### 机器人凭据（`bot`）

在企业微信管理后台创建机器人应用后获取 Bot ID 和 Secret。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `botId` | string | 是 | 企业微信机器人 Bot ID |
| `secret` | string | 是 | 企业微信机器人密钥 |

### OpenCode 配置（`opencode`）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseUrl` | string | `http://127.0.0.1:4096` | OpenCode 服务地址 |
| `timeout` | number | `120000` | AI 回复超时（毫秒） |
| `sessionTitle` | string | `"微信用户"` | 会话标题前缀，最终标题为 `{title}-{userId}` |
| `fixedSessionId` | string | `""` | 固定会话 ID，不为空时所有用户共享同一会话 |
| `directory` | string | `""` | 项目目录路径，绑定 MCP 和 Skills |
| `botName` | string | `""` | 机器人名称，自动移除群聊消息中的 `@机器人名` |

### 桥接配置（`bridge`）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `messageTimeoutMs` | number | `120000` | 单条消息处理超时 |
| `maxResponseLength` | number | `20480` | 最大回复长度（超过自动截断） |
| `logLevel` | string | `"info"` | 日志级别 |

### OpenCode 服务配置（`opencodeServer`）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `autoStart` | boolean | `true` | 是否由桥接服务自动启动 OpenCode |
| `hostname` | string | `"127.0.0.1"` | 监听地址 |
| `port` | number | `0` | 监听端口（0=自动推导） |
| `startupTimeout` | number | `30000` | 启动超时（毫秒） |

---

## 使用场景

### 场景一：通过企微查询项目数据

配置 `opencode.directory` 指向项目目录后，在企微中发送消息即可通过项目的 MCP 工具操作数据库：

```
用户: 查询今天有多少新订单
  AI: 正在查询数据库...
      今日新增订单 15 单，总金额 ¥3,280.00
```

### 场景二：AI 编程辅助

结合 OpenCode 的 AI 能力，在企微中编写代码、重构、排查问题：

```
用户: 帮我看看 index.js 第 50 行的逻辑是否有问题
  AI: 第 50 行的错误处理逻辑存在风险——空 catch 块...
```

### 场景三：群聊协作

将机器人加入企微群聊，群内所有成员均可@机器人提问，共享 AI 上下文（固定会话模式）。

---

## 日志

日志以 JSON 格式输出到标准输出，每条日志包含：

```json
{"timestamp":"2025-06-03T10:30:00.000Z","level":"INFO","name":"bridge","event":"start","message":"桥接服务启动完成"}
```

| 字段 | 说明 |
|------|------|
| `timestamp` | ISO 8601 时间戳 |
| `level` | 日志级别（DEBUG/INFO/WARN/ERROR） |
| `name` | 模块名称 |
| `event` | 事件标识 |
| `message` | 描述信息 |
| 其他字段 | 事件相关的业务数据 |

---

## 常见问题

### Q: 启动报错 "config.json 缺少 bot 凭据"

`config.json` 中缺少 `bot.botId` 和 `bot.secret` 字段。检查配置文件中是否包含完整的 `bot` 对象。

### Q: 启动报错 "OpenCode 服务不可用"

- 检查 `opencode.baseUrl` 配置是否正确
- 如果 `autoStart` 为 `false`，请先手动启动 OpenCode 服务
- 检查端口是否被占用

### Q: 企微消息无回复

- 检查日志输出，确认消息是否被成功接收
- 确认 `bot.botId` 和 `bot.secret` 是否正确
- 检查企业微信机器人是否已添加到对应群聊或联系人

### Q: 如何重置某个用户的会话？

删除 `fixedSessionId` 配置（使用独立会话模式），然后重启服务即可。

---

## 开发

```bash
# 克隆项目
git clone <repo-url>

# 复制到目标项目根目录
cp -r wecom-opencode /项目目录/
cd /项目目录/wecom-opencode

# 安装依赖
npm install

# 编辑 config.json 填入凭据
# 启动
node index.js
```

### 依赖

- `@wecom/aibot-node-sdk` — 企业微信机器人 WebSocket SDK
- `@opencode-ai/sdk` — OpenCode AI SDK（v2）

---


