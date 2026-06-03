const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] ?? 1;

export function createLogger(name) {
  const log = (level, event, message, data) => {
    if (LOG_LEVELS[level] < currentLevel) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      name,
      event,
      message,
      ...data,
    };
    process.stdout.write(JSON.stringify(entry) + '\n');
  };
  return {
    info: (event, message, data) => log('info', event, message, data),
    warn: (event, message, data) => log('warn', event, message, data),
    error: (event, message, data) => log('error', event, message, data),
    debug: (event, message, data) => log('debug', event, message, data),
  };
}
