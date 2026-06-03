import AiBot from '@wecom/aibot-node-sdk';

const { WSClient, generateReqId } = AiBot;

/**
 * 已处理消息 ID 去重集合（模块级）
 * 防止 WebSocket 重连或重复推送导致同一消息被多次处理
 */
const processedMsgIds = new Set();

/**
 * 消息帧去重上限（防止内存泄漏）
 * 超过此数量时清理一半最旧的记录
 */
const DEDUP_MAX_SIZE = 10000;

/**
 * 从 SDK 消息帧中提取标准化消息对象（文本消息）
 *
 * @param {object} frame - SDK 原始消息帧
 * @returns {object|null} 标准化消息对象，无效帧返回 null
 */
function getFrameInfo(frame) {
  if (!frame || !frame.body) return null;
  const body = frame.body;
  return {
    type: 'text',
    raw: frame,
    userid: body.from?.userid || '',
    chatid: body.chatid || body.from?.userid || '',
    chattype: body.chattype || 'single',
    content: body.text?.content || '',
    msgid: body.msgid || '',
  };
}

/**
 * 从 SDK 语音消息帧中提取标准化消息对象
 *
 * 企业微信语音消息可能包含自动语音识别文本（recognition 字段）。
 * 如果存在识别文本，将其作为 content 返回，上级可当做文本消息处理。
 *
 * @param {object} frame - SDK 原始消息帧
 * @returns {object|null} 标准化消息对象（含 voice 标记），无效帧返回 null
 */
function getVoiceFrameInfo(frame) {
  if (!frame || !frame.body) return null;
  const body = frame.body;
  const voiceRecognition = body.voice?.content || '';
  return {
    type: 'voice',
    raw: frame,
    userid: body.from?.userid || '',
    chatid: body.chatid || body.from?.userid || '',
    chattype: body.chattype || 'single',
    content: voiceRecognition,
    msgid: body.msgid || '',
    mediaId: body.voice?.media_id || '',
    hasRecognition: !!voiceRecognition,
  };
}

/**
 * 管理已处理消息 ID 的去重集合
 * 在达到上限时自动清理旧记录
 *
 * @param {string} msgid - 消息 ID
 */
function trackProcessedMsgId(msgid) {
  processedMsgIds.add(msgid);
  if (processedMsgIds.size > DEDUP_MAX_SIZE) {
    // 清理一半最旧的记录
    const entries = [...processedMsgIds];
    const half = Math.floor(entries.length / 2);
    processedMsgIds.clear();
    for (let i = half; i < entries.length; i++) {
      processedMsgIds.add(entries[i]);
    }
  }
}

/**
 * 创建 WeCom 客户端实例
 *
 * @param {object}   botConfig           - 机器人配置
 * @param {string}   botConfig.botId     - 企业微信 Bot ID
 * @param {string}   botConfig.secret    - 机器人密钥
 * @param {number}   [botConfig.maxResponseLength=20480] - 最大响应长度（字符数）
 * @param {object}   logger              - 日志记录器（含 info/warn/error/debug 方法）
 * @returns {object} 客户端接口对象
 */
export function createWeComClient(botConfig, logger) {
  const { botId, secret, maxResponseLength = 20480 } = botConfig;

  // ── 创建 WSClient ─────────────────────────────────────
  const wsClient = new WSClient({ botId, secret });

  // ── 连接事件监听 ───────────────────────────────────────
  wsClient.on('connected', () => logger.info('connect', 'WebSocket 已连接'));
  wsClient.on('authenticated', () => logger.info('auth', 'WeCom 认证成功'));
  wsClient.on('disconnected', (reason) => logger.warn('disconnect', `连接断开: ${reason}`));
  wsClient.on('reconnecting', (attempt) => logger.warn('reconnect', `正在重连 (第${attempt}次)`));
  wsClient.on('error', (err) => logger.error('error', `连接错误: ${err.message}`));

  // ── 消息回调解引用（允许动态替换） ─────────────────────
  let messageHandler = null;

  wsClient.on('message.text', (frame) => {
    const info = getFrameInfo(frame);
    if (!info || !info.msgid) return;
    if (processedMsgIds.has(info.msgid)) return;

    trackProcessedMsgId(info.msgid);
    if (messageHandler) messageHandler(info);
  });

  // ── 语音消息处理 ───────────────────────────────────────
  wsClient.on('message.voice', (frame) => {
    const info = getVoiceFrameInfo(frame);
    if (!info || !info.msgid) return;
    if (processedMsgIds.has(info.msgid)) return;

    trackProcessedMsgId(info.msgid);

    if (info.hasRecognition) {
      // 有语音识别文本 → 当做文本消息处理
      logger.info('voice_recognition', '收到语音消息（含识别文本）', {
        userid: info.userid,
        textLength: info.content.length,
        preview: info.content.slice(0, 50),
      });
      if (messageHandler) messageHandler(info);
    } else {
      // 无识别文本 → 提示用户暂不支持
      logger.info('voice_no_recognition', '收到语音消息（无识别文本）', {
        userid: info.userid,
        mediaId: info.mediaId,
      });
      const streamId = generateReqId('stream');
      wsClient.replyStream(frame, streamId, '抱歉，我暂时无法处理语音消息，请发送文字消息。', true).catch((err) => {
        logger.error('voice_reply_error', '回复语音提示失败', { error: err.message });
      });
    }
  });

  // ── 建立连接 ───────────────────────────────────────────
  wsClient.connect();

  // ── 返回公开接口 ───────────────────────────────────────
  return {
    /** WSClient 原始实例（供高级场景直接访问） */
    wsClient,

    /** 当前是否已连接 */
    isConnected: () => wsClient.isConnected,

    /**
     * 注册文本消息回调
     * @param {Function} handler - 接收标准化消息对象的回调
     */
    onMessage: (handler) => {
      messageHandler = handler;
    },

    /**
     * 生成流式回复 ID
     * @returns {string} 流式回复 ID
     */
    generateStreamId: () => generateReqId('stream'),

    /**
     * 发送"思考中..."占位消息
     * @param {object} frame   - 原始消息帧
     * @param {string} streamId - 流式回复 ID
     */
    sendThinking: async (frame, streamId) => {
      await wsClient.replyStream(frame, streamId, '🤔 正在思考中，请稍候...', false);
    },

    /**
     * 发送最终回复（自动截断超长文本）
     * @param {object} frame   - 原始消息帧
     * @param {string} streamId - 流式回复 ID
     * @param {string} text    - 回复文本内容
     */
    sendReply: async (frame, streamId, text) => {
      let truncated = text;
      if (Buffer.byteLength(text, 'utf8') > maxResponseLength) {
        let buf = Buffer.from(text, 'utf8');
        buf = buf.slice(0, maxResponseLength - 30);
        truncated = buf.toString('utf8').replace(/[\uD800-\uDFFF]$/, '') + '...(内容已截断)';
      }
      await wsClient.replyStream(frame, streamId, truncated, true);
    },

    /**
     * 发送流式回复片段
     * @param {object}  frame   - 原始消息帧
     * @param {string}  streamId - 流式回复 ID
     * @param {string}  text    - 回复片段内容
     * @param {boolean} [finish=false] - 是否为最后一段
     */
    sendChunk: async (frame, streamId, text, finish = false) => {
      await wsClient.replyStream(frame, streamId, text, finish);
    },

    /** 断开 WebSocket 连接 */
    disconnect: () => {
      wsClient.disconnect();
    },

    /**
     * 从 SDK 消息帧提取标准化信息
     * @param {object} frame - SDK 原始消息帧
     * @returns {object|null} 标准化消息对象
     */
    getFrameInfo: (frame) => getFrameInfo(frame),
  };
}

