import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';

/**
 * 创建 OpenCode 客户端，提供健康检查、会话管理、消息发送等功能。
 *
 * @param {object} config
 * @param {string} config.baseUrl - OpenCode 服务地址
 * @param {number} [config.timeout=120000] - AI 回复超时时间（毫秒）
 * @param {string} [config.sessionTitle='微信用户'] - 会话标题前缀
 * @param {string} [config.fixedSessionId=''] - 固定会话 ID，不为空时始终使用此会话
 * @param {string} [config.directory=''] - 项目目录路径，用于创建项目绑定的会话
 * @param {object} logger - createLogger 创建的日志对象
 * @returns {object} 客户端方法集合
 */
export function createOpenCodeClient(config, logger) {
  const {
    baseUrl,
    timeout = 120000,
    sessionTitle = '微信用户',
    fixedSessionId = '',
    directory = '',
  } = config;

  // 创建 SDK 客户端时绑定项目目录，确保所有 API 调用作用于本项目
  const sdkConfig = { baseUrl };
  if (directory) {
    sdkConfig.directory = directory;
  }
  const client = createOpencodeClient(sdkConfig);

  // 固定会话 ID 模式 — 不按用户创建独立会话
  const isFixedMode = !!fixedSessionId;

  /**
   * 健康检查 — 使用 v2 SDK 的 client.global.health()
   */
  async function healthCheck() {
    try {
      const health = await client.global.health();
      const version = health.data?.version || 'unknown';
      logger.info('health', 'OpenCode 健康检查通过', { version });
      return { healthy: true, version };
    } catch (err) {
      logger.error('health', 'OpenCode 服务不可用', { error: err.message });
      return { healthy: false, error: err.message };
    }
  }

  /**
   * 获取会话 ID。
   *
   * - 如果配置了 fixedSessionId，始终使用该固定会话（所有用户共享同一上下文）
   * - 否则按 `${title}-${userId}` 查找或创建新会话（带 directory 绑定）
   *
   * @param {string} userId - 用户标识（微信 ID）
   * @param {string} [title] - 会话标题，默认使用 config.sessionTitle
   * @returns {Promise<string>} 会话 ID
   */
  async function findOrCreateSession(userId, title) {
    // ── 固定会话模式 ────────────────────────────────────────
    if (isFixedMode) {
      logger.debug('session_fixed', '使用固定会话', { userId, sessionId: fixedSessionId });
      return fixedSessionId;
    }

    // ── 自动创建模式 ──────────────────────────────────────────
    title = title || sessionTitle;
    const sessionLabel = `${title}-${userId}`;

    try {
      // 查找已有会话（client 已绑定 directory，列表会自动过滤到本项目）
      const sessionsResp = await client.session.list();
      const sessions = sessionsResp.data || [];
      const existing = sessions.find(s => s.title === sessionLabel);
      if (existing) {
        logger.debug('session_found', '找到已有会话', { userId, sessionId: existing.id });
        return existing.id;
      }

      // 创建新会话，传入 directory 确保会话绑定到项目目录（MCP 工具可用）
      const createParams = { title: sessionLabel };
      if (directory) {
        createParams.directory = directory;
      }
      const created = await client.session.create(createParams);
      const sessionId = created.data?.id;
      logger.info('session_created', '创建新会话', { userId, sessionId, directory });
      return sessionId;
    } catch (err) {
      logger.error('session_error', '会话操作失败', { userId, error: err.message });
      throw err;
    }
  }

  /**
   * 删除指定会话。
   *
   * 在固定会话模式下，不会删除固定的会话。
   *
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<boolean>} 是否成功删除
   */
  async function deleteSession(sessionId) {
    // 保护固定会话不被删除
    if (isFixedMode && sessionId === fixedSessionId) {
      logger.debug('session_delete_skip', '跳过删除固定会话', { sessionId });
      return false;
    }

    try {
      await client.session.delete({ sessionID: sessionId });
      logger.info('session_deleted', '已删除会话', { sessionId });
      return true;
    } catch (err) {
      logger.warn('session_delete_error', '删除会话失败', { sessionId, error: err.message });
      return false;
    }
  }

  /**
   * 向会话发送消息并提取 AI 回复文本。
   *
   * @param {string} sessionId - 会话 ID
   * @param {string} text - 消息文本
   * @returns {Promise<string>} AI 回复文本
   * @throws {Error} 超时时抛出 TimeoutError
   */
  async function promptSession(sessionId, text) {
    // 超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const result = await client.session.prompt(
        { sessionID: sessionId, parts: [{ type: 'text', text }] },
        { signal: controller.signal }
      );

      const parts = result?.data?.parts || [];
      const reply = parts
        .filter(p => p.type === 'text')
        .map(p => p.text)
        .join('\n')
        .trim();

      return reply || '(AI 未返回文本回复)';
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`AI 处理超时 (${timeout}ms)`);
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 释放客户端资源。
   */
  function close() {
    logger.info('close', 'OpenCode 客户端关闭');
  }

  return {
    healthCheck,
    findOrCreateSession,
    deleteSession,
    promptSession,
    close,
  };
}
