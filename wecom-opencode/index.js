#!/usr/bin/env node
/**
 * wecom-opencode - 企业微信 SDK ↔ OpenCode SDK 消息桥接服务
 *
 * 使用 @wecom/aibot-node-sdk (WebSocket) + @opencode-ai/sdk
 * 将企业微信消息转发到 OpenCode 会话处理，再将 AI 回复发回企业微信。
 *
 * 启动流程:
 *   1. 加载配置
 *   2. （可选）自动启动 OpenCode 4096 服务
 *   3. 创建 OpenCode 客户端 + 健康检查
 *   4. 创建会话管理器
 *   5. 创建 WeCom 客户端 + 消息处理器
 *
 * 导出:
 *   start() - 启动桥接服务
 *   stop()  - 优雅关闭
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

import { createOpencodeServer } from '@opencode-ai/sdk/v2/server';

import { loadConfig } from './src/config.js';
import { createLogger } from './src/logger.js';
import { createWeComClient } from './src/wecom-client.js';
import { createOpenCodeClient } from './src/opencode-client.js';
import { createSessionManager } from './src/session-manager.js';
import { createMessageHandler } from './src/message-handler.js';

// ── 模块级日志实例 ────────────────────────────────────────────
const logger = createLogger('bridge');

// ── 模块级引用（便于 stop() 优雅关闭） ────────────────────────
let wecomClient = null;
let sessionManager = null;
let opencodeClient = null;
let opencodeServer = null;

// ── 内部状态 ──────────────────────────────────────────────────
let running = false;

/**
 * 从 baseUrl 解析端口号
 * @param {string} baseUrl
 * @returns {number}
 */
function parsePortFromUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return parseInt(url.port, 10) || 4096;
  } catch {
    return 4096;
  }
}

/**
 * 读取项目的 .opencode/opencode.json 配置
 * @param {string} projectDir - 项目目录路径
 * @returns {object|null}
 */
function loadProjectOpencodeConfig(projectDir) {
  if (!projectDir) return null;
  const configPath = join(projectDir, '.opencode', 'opencode.json');
  if (!existsSync(configPath)) {
    logger.warn('project_config', '未找到项目 opencode 配置文件', { path: configPath });
    return null;
  }
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    logger.info('project_config_loaded', '已读取项目 opencode 配置', {
      path: configPath,
      mcpCount: Object.keys(config.mcp || {}).length,
    });
    return config;
  } catch (err) {
    logger.warn('project_config_error', '读取项目 opencode 配置失败', {
      path: configPath,
      error: err.message,
    });
    return null;
  }
}

/**
 * 启动桥接服务
 *
 * @returns {Promise<{ config: object }>} 启动成功后的配置对象
 * @throws {Error} 配置无效或 OpenCode 服务不可用时抛出
 */
export async function start() {
  if (running) {
    logger.warn('start', '桥接服务已在运行中，跳过重复启动');
    return;
  }

  logger.info('start', '桥接服务启动中...');

  // ── 1. 加载配置 ────────────────────────────────────────────
  const config = await loadConfig();
  logger.info('config_loaded', '配置加载完成', {
    botId: config.bot.botId,
    baseUrl: config.opencode.baseUrl,
  });

  // ── 2. （可选）启动 OpenCode 服务 ────────────────────────
  const serverConfig = config.opencodeServer || {};
  if (serverConfig.autoStart !== false) {
    const hostname = serverConfig.hostname || '127.0.0.1';
    const port = serverConfig.port || parsePortFromUrl(config.opencode.baseUrl);
    const startupTimeout = serverConfig.startupTimeout || 30000;

    // 读取项目 opencode 配置（含 MCP 服务定义）
    const projectDir = config.opencode.directory || process.cwd();
    const projectConfig = loadProjectOpencodeConfig(projectDir);

    logger.info('server_starting', '正在启动 OpenCode 服务...', { hostname, port });
    try {
      opencodeServer = await createOpencodeServer({
        hostname,
        port,
        timeout: startupTimeout,
        config: projectConfig || {},
      });
      logger.info('server_started', 'OpenCode 服务已启动', { url: opencodeServer.url });
    } catch (err) {
      logger.error('server_start_failed', 'OpenCode 服务启动失败', { error: err.message });
      throw new Error(`OpenCode 服务启动失败: ${err.message}`);
    }
  } else {
    logger.info('server_skip', '跳过自动启动 OpenCode 服务（autoStart=false）');
  }

  // ── 3. 创建 OpenCode 客户端 + 健康检查 ────────────────────
  opencodeClient = createOpenCodeClient(config.opencode, logger);

  const health = await opencodeClient.healthCheck();
  if (!health.healthy) {
    logger.error('start', 'OpenCode 服务不可用，启动中止', { error: health.error });
    throw new Error(`OpenCode 服务不可用: ${health.error}`);
  }

  // ── 4. 创建会话管理器 ──────────────────────────────────────
  sessionManager = createSessionManager(
    opencodeClient,
    {
      ...config.bridge,
      sessionTitle: config.opencode.sessionTitle,
    },
    logger,
  );

  // ── 5. 创建 WeCom 客户端 ───────────────────────────────────
  wecomClient = createWeComClient(
    {
      ...config.bot,
      maxResponseLength: config.bridge.maxResponseLength,
    },
    logger,
  );

  // ── 6. 创建消息处理器 ──────────────────────────────────────
  const messageHandler = createMessageHandler(
    opencodeClient,
    sessionManager,
    wecomClient,
    config,
    logger,
  );

  // ── 7. 注册消息回调 ────────────────────────────────────────
  wecomClient.onMessage((msgInfo, frame) => {
    messageHandler.handleTextMessage(msgInfo, frame).catch((err) => {
      logger.error('unhandled', '消息处理未捕获异常', {
        userid: msgInfo.userid,
        error: err.message,
      });
    });
  });

  running = true;
  logger.info('start', '桥接服务启动完成', {
    botId: config.bot.botId,
    opencodeUrl: opencodeServer ? opencodeServer.url : config.opencode.baseUrl,
  });

  return { config };
}

/**
 * 优雅关闭桥接服务
 *
 * 执行顺序:
 *   1. 停止会话管理器
 *   2. 断开 WeCom WebSocket
 *   3. 关闭 OpenCode 客户端
 *   4. 关闭 OpenCode 服务（如果由本进程启动）
 */
export async function stop() {
  if (!running) {
    logger.warn('stop', '桥接服务未运行，跳过关闭');
    return;
  }

  logger.info('stop', '桥接服务关闭中...');

  // 1. 停止会话管理器
  if (sessionManager) {
    sessionManager.stop();
    sessionManager = null;
  }

  // 2. 断开 WeCom WebSocket
  if (wecomClient) {
    wecomClient.disconnect();
    wecomClient = null;
  }

  // 3. 释放 OpenCode 客户端
  if (opencodeClient) {
    opencodeClient.close();
    opencodeClient = null;
  }

  // 4. 关闭 OpenCode 服务（如果由本进程启动）
  if (opencodeServer) {
    opencodeServer.close();
    opencodeServer = null;
    logger.info('server_stopped', 'OpenCode 服务已关闭');
  }

  running = false;
  logger.info('stop', '桥接服务已关闭');
}

// ── 直接运行时入口 ────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && (
  process.argv[1] === __filename ||
  process.argv[1].endsWith('index.js')
);

if (isMainModule) {
  start().catch((err) => {
    logger.error('fatal', '启动失败', { error: err.message });
    process.exit(1);
  });

  // 优雅退出 — 捕获系统信号
  process.on('SIGINT', async () => {
    logger.info('signal', '收到 SIGINT');
    await stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('signal', '收到 SIGTERM');
    await stop();
    process.exit(0);
  });

  // 未捕获异常处理
  process.on('uncaughtException', (err) => {
    logger.error('uncaught', '未捕获异常', { error: err.message, stack: err.stack });
    stop().finally(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled_rejection', '未捕获 Promise 拒绝', {
      error: reason?.message || String(reason),
    });
  });
}
