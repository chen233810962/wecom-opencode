import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = Object.freeze({
  opencode: {
    baseUrl: 'http://127.0.0.1:4096',
    timeout: 120000,
    sessionTitle: '微信用户',
    fixedSessionId: '',
    directory: '',
    /** 机器人显示名称，用于从群聊消息中移除 @机器人名 前缀 */
    botName: '',
  },
  bridge: {
    messageTimeoutMs: 120000,
    maxResponseLength: 20480,
    logLevel: 'info',
  },
  opencodeServer: {
    /** 是否自动启动 OpenCode 服务（设为 false 则使用外部已启动的服务） */
    autoStart: true,
    /** 监听主机地址 */
    hostname: '127.0.0.1',
    /** 监听端口（为空时从 opencode.baseUrl 自动推导） */
    port: 0,
    /** 服务启动超时（毫秒） */
    startupTimeout: 30000,
  },
});

/**
 * 递归冻结对象（深层不可变）
 */
function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = obj[name];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      deepFreeze(value);
    }
  }
  return Object.freeze(obj);
}

/**
 * 深度合并两个对象（仅普通对象合并，数组直接替换）
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
        && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key] !== undefined ? source[key] : target[key];
    }
  }
  return result;
}

/**
 * 加载并合并配置，优先级（高 → 低）：
 *   1. 环境变量
 *   2. config.json（项目根目录）
 *   3. 默认配置
 *   4. 机器人凭据 —> config.json 中提供 bot.botId/bot.secret 则直接使用
 *                      否则回退到 ~/.wecom-aibot-mcp/robot-default.json
 *
 * @returns {object} 冻结的配置对象
 */
export async function loadConfig() {
  // ── 1. 读取桥接配置 ────────────────────────────────────
  const configPath = join(__dirname, '..', 'config.json');
  let fileConfig = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (err) {
      throw new Error(`读取 config.json 失败: ${configPath} — ${err.message}`);
    }
  }

  // ── 2. 合并配置（默认 + 文件） ──────────────────────────
  const config = deepMerge(DEFAULT_CONFIG, fileConfig);

  // ── 3. 确定机器人凭据（仅从 config.json 读取） ──────────
  if (!config.bot?.botId || !config.bot?.secret) {
    throw new Error(
      'config.json 缺少 bot 凭据。请添加 bot.botId 和 bot.secret 字段。'
    );
  }

  // ── 4. 环境变量覆盖 ────────────────────────────────────
  if (process.env.OPENCODE_BASE_URL) {
    config.opencode.baseUrl = process.env.OPENCODE_BASE_URL;
  }
  if (process.env.BRIDGE_LOG_LEVEL) {
    config.bridge.logLevel = process.env.BRIDGE_LOG_LEVEL;
  }

  // ── 5. 验证 ─────────────────────────────────────────────
  const { baseUrl } = config.opencode;
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    throw new Error(`无效的 OpenCode baseUrl: "${baseUrl}" — 必须以 http:// 或 https:// 开头`);
  }

  // ── 6. 冻结返回 ─────────────────────────────────────────
  return deepFreeze(config);
}
