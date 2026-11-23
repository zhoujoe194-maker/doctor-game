export const DEFAULT_UI_PORT = 4173;
export const UI_PORT_MIN = 1024;
export const UI_PORT_MAX = 65535;

export function resolveUiPort(env = process.env) {
  const raw = env?.DOCTORGAME_UI_PORT;
  if (raw === undefined) return DEFAULT_UI_PORT;
  if (typeof raw !== 'string' || raw !== raw.trim() || raw === '') {
    throw new Error('DOCTORGAME_UI_PORT 必须是 1024–65535 的整数；当前为空或含空白。');
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`DOCTORGAME_UI_PORT 必须是 1024–65535 的整数；当前值：${raw}`);
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < UI_PORT_MIN || port > UI_PORT_MAX) {
    throw new Error(`DOCTORGAME_UI_PORT 必须是 1024–65535 的整数；当前值：${raw}`);
  }
  return port;
}
