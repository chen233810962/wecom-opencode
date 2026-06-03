/**
 * 消息处理器 - 编排 WeCom 消息接收 → 会话管理 → OpenCode 处理 → 回复发送
 *
 * 接收 wecom-client 分发的标准文本消息对象，串联完整处理流程。
 * 错误时自动发送"请稍后重试"等友好提示，不崩溃。
 *
 * @param {object}   opencodeClient  - OpenCode API 客户端（含 promptSession 方法）
 * @param {object}   sessionManager  - 会话管理器（含 getOrCreateSession 方法）
 * @param {object}   wecomClient     - WeCom 客户端（含 generateStreamId / sendThinking / sendReply 方法）
 * @param {object}   [config]        - 配置对象
 * @param {object}   [logger]        - 日志记录器，默认使用 createLogger('message-handler')
 * @returns {{ handleTextMessage }}
 */
import { createLogger } from './logger.js';

/**
 * 转义正则表达式中的特殊字符
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createMessageHandler(opencodeClient, sessionManager, wecomClient, config, logger) {
  const log = logger || createLogger('message-handler');

  /**
   * 处理文本消息的完整流程
   *
   * @param {object}  msgInfo           - 标准化消息对象
   * @param {string}  msgInfo.userid    - 企业微信用户 ID
   * @param {string}  msgInfo.content   - 消息文本内容
   * @param {object}  msgInfo.raw       - 原始 SDK 消息帧（用于回复）
   * @param {object}  [frame]           - 可选：原始 SDK 帧（优先级高于 msgInfo.raw）
   * @returns {Promise<string>} AI 回复文本
   */
  async function handleTextMessage(msgInfo, frame) {
    const { userid } = msgInfo;
    let { content } = msgInfo;
    const startTime = Date.now();

    // ── 全文移除 @机器人名（无论出现在文本的什么位置） ──
    const botName = config?.opencode?.botName;
    if (botName) {
      const cleanContent = content
        .replace(new RegExp(`@${escapeRegex(botName)}\\s*`, 'g'), '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (cleanContent !== content) {
        log.debug('botname_stripped', '已移除 @机器人名', { botName, original: content, cleaned: cleanContent });
        content = cleanContent;
      }
    }

    log.info('msg_received', '收到文本消息', {
      userid,
      contentLength: content.length,
      preview: content.slice(0, 50),
    });

    try {
      // 1. 发送"思考中..."占位消息
      const streamId = wecomClient.generateStreamId();
      const targetFrame = frame || msgInfo.raw;
      await wecomClient.sendThinking(targetFrame, streamId);

      // 2. 获取或创建会话
      const sessionId = await sessionManager.getOrCreateSession(userid);
      log.debug('session_ready', '会话已就绪', { userid, sessionId });

      // 3. 调用 OpenCode AI 处理
      const reply = await opencodeClient.promptSession(sessionId, content);

      // 4. 发送最终回复（覆盖占位消息）
      await wecomClient.sendReply(targetFrame, streamId, reply);

      
      log.info('msg_handled', '消息处理完成', { userid, replyLength: reply.length, latencyMs: Date.now() - startTime });

      return reply;
    } catch (err) {
      log.error('msg_error', '消息处理失败', { userid, error: err.message });

      // 尝试发送错误提示（不阻断上层异常传播）
      try {
        const errorStreamId = wecomClient.generateStreamId();
        const targetFrame = frame || msgInfo.raw;
        await wecomClient.sendThinking(targetFrame, errorStreamId);

        const errorMsg = err.name === 'TimeoutError'
          ? '抱歉，AI 处理超时了，请简化问题后重试。'
          : '抱歉，处理您的消息时出现错误，请稍后重试。';

        await wecomClient.sendReply(targetFrame, errorStreamId, errorMsg);
      } catch (sendErr) {
        log.error('send_error', '发送错误提示失败', { userid, error: sendErr.message });
      }

      throw err; // 向上层传播，让入口捕获做最终处理
    }
  }

  return { handleTextMessage };
}


