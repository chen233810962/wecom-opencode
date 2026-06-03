/**
 * 会话管理器 - 管理企业微信用户与 OpenCode 会话的映射关系
 *
 * ⚠️ 会话永久保留，不做任何自动清理或驱逐。
 *
 * @param {object} opencodeClient - OpenCode API 客户端
 * @param {object} config - 配置项
 * @param {string} [config.sessionTitle='微信用户'] - 会话标题
 * @param {object} logger - 日志记录器（createLogger 创建）
 * @returns {{ getOrCreateSession, getStats, stop }}
 */
export function createSessionManager(opencodeClient, config, logger) {
  const {
    sessionTitle = '微信用户',
  } = config;

  /** @type {Map<string, { sessionId: string, lastActive: number, createdAt: number }>} */
  const sessions = new Map();

  /**
   * 获取或创建用户会话
   * @param {string} userId - 企业微信用户 ID
   * @returns {Promise<string>} sessionId
   */
  async function getOrCreateSession(userId) {
    // 1. 检查已有映射
    const existing = sessions.get(userId);
    if (existing) {
      existing.lastActive = Date.now();
      logger.debug('session_reused', '复用会话', { userId, sessionId: existing.sessionId });
      return existing.sessionId;
    }

    // 2. 创建新会话（不限上限，永不驱逐）
    const sessionId = await opencodeClient.findOrCreateSession(userId, sessionTitle);
    const now = Date.now();
    sessions.set(userId, { sessionId, lastActive: now, createdAt: now });

    logger.info('session_mapped', '映射用户会话', { userId, sessionId, total: sessions.size });
    return sessionId;
  }

  /**
   * 获取会话统计信息
   * @returns {{ totalSessions: number, oldestSession: string|null, newestSession: string|null }}
   */
  function getStats() {
    const now = Date.now();
    let oldest = Infinity;
    let newest = 0;

    for (const value of sessions.values()) {
      if (value.createdAt < oldest) oldest = value.createdAt;
      if (value.createdAt > newest) newest = value.createdAt;
    }

    return {
      totalSessions: sessions.size,
      oldestSession: oldest === Infinity ? null : new Date(oldest).toISOString(),
      newestSession: newest === 0 ? null : new Date(newest).toISOString(),
    };
  }

  /**
   * 停止会话管理器（保留会话，仅停止自身状态）
   */
  function stop() {
    logger.info('session_stopped', '会话管理器已停止（会话记录保留）');
  }

  return {
    getOrCreateSession,
    getStats,
    stop,
  };
}
