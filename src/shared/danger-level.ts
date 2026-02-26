import type { DangerLevel, DangerInfo } from './types';

/** 危険度レベルごとの表示情報 */
const DANGER_INFO_MAP: Record<DangerLevel, DangerInfo> = {
  SAFE: { level: 'SAFE', label: '安全', badgeColor: '#34C759', buttonColor: '#007AFF' },
  LOW: { level: 'LOW', label: '低', badgeColor: '#34C759', buttonColor: '#007AFF' },
  MEDIUM: { level: 'MEDIUM', label: '中', badgeColor: '#FFD60A', buttonColor: '#007AFF' },
  HIGH: { level: 'HIGH', label: '高', badgeColor: '#FF9500', buttonColor: '#FF9500' },
  CRITICAL: { level: 'CRITICAL', label: '危険', badgeColor: '#FF3B30', buttonColor: '#FF3B30' },
};

/** CRITICAL: システムに致命的な損害を与えうるパターン */
const CRITICAL_PATTERNS: RegExp[] = [
  /\bsudo\b/,
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\//,  // rm -rf /
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\//,  // rm -fr /
  /\bdd\b.*\bof=/,
  /\bmkfs\b/,
  /\bformat\b/,
  /\bchmod\s+(-R\s+)?777\s+\//,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,  // fork bomb
  />\s*\/dev\/sd[a-z]/,
  /\bsystemctl\s+(stop|disable|mask)/,
  /\blaunchctl\s+(unload|remove)/,
];

/** HIGH: データ損失やリモート操作を伴うパターン */
const HIGH_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*)/,    // rm -r (recursive delete)
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*)/,    // rm -f (force delete)
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
  /\bgit\s+checkout\s+\./,
  /\bcurl\b.*\|\s*(bash|sh|zsh)/,       // curl | bash
  /\bwget\b.*\|\s*(bash|sh|zsh)/,
  /\bcurl\b/,
  /\bwget\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bkill\b/,
  /\bpkill\b/,
  /\bkillall\b/,
  /\bdocker\s+(rm|rmi|prune|stop|kill)/,
  /\bnpm\s+publish\b/,
  /\bnpx\b/,
  /\bpip\s+install\b(?!.*--user)/,
  /\brew\s+install\b/,
];

/** MEDIUM: 環境を変更するが、比較的安全なパターン */
const MEDIUM_PATTERNS: RegExp[] = [
  /\bnpm\s+install\b/,
  /\bnpm\s+ci\b/,
  /\byarn\s+(add|install)\b/,
  /\bpnpm\s+(add|install)\b/,
  /\bgit\s+commit\b/,
  /\bgit\s+merge\b/,
  /\bgit\s+rebase\b/,
  /\bgit\s+stash\b/,
  /\bgit\s+branch\s+-[dD]/,
  /\bmkdir\b/,
  /\btouch\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\bnpm\s+run\b/,
  /\byarn\s+run\b/,
  /\bpython\b/,
  /\bnode\b(?!_modules)/,
  /\btsc\b/,
  /\bsed\b/,
  /\bawk\b/,
];

/** LOW: 読み取り系だが出力が多い可能性があるパターン */
const LOW_PATTERNS: RegExp[] = [
  /\bnpm\s+test\b/,
  /\bnpm\s+run\s+test/,
  /\byarn\s+test\b/,
  /\bpnpm\s+test\b/,
  /\bpytest\b/,
  /\bvitest\b/,
  /\bjest\b/,
  /\bnpm\s+run\s+build/,
  /\bnpm\s+run\s+lint/,
  /\bgit\s+add\b/,
  /\bgit\s+checkout\s+-b/,
  /\bgit\s+switch\b/,
  /\bfind\b/,
  /\bgrep\b/,
  /\brg\b/,
  /\btree\b/,
  /\bwc\b/,
  /\bdiff\b/,
];

/** SAFE: 読み取り専用・安全なコマンド */
const SAFE_PATTERNS: RegExp[] = [
  /^\s*ls\b/,
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*echo\b/,
  /^\s*pwd\b/,
  /^\s*which\b/,
  /^\s*whoami\b/,
  /^\s*date\b/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*git\s+status\b/,
  /^\s*git\s+log\b/,
  /^\s*git\s+diff\b/,
  /^\s*git\s+show\b/,
  /^\s*git\s+branch\b(?!\s+-[dD])/,
  /^\s*git\s+remote\b/,
  /^\s*npm\s+list\b/,
  /^\s*npm\s+ls\b/,
  /^\s*npm\s+view\b/,
  /^\s*npm\s+info\b/,
  /^\s*npm\s+outdated\b/,
];

/**
 * コマンド文字列から危険度レベルを判定する
 */
export function analyzeDangerLevel(command: string): DangerLevel {
  const trimmed = command.trim();

  // パイプやセミコロンで区切られた複数コマンドの場合、最も危険なレベルを採用
  const parts = splitCommands(trimmed);
  if (parts.length > 1) {
    const levels = parts.map(part => analyzeSingleCommand(part.trim()));
    return getHighestLevel(levels);
  }

  return analyzeSingleCommand(trimmed);
}

function analyzeSingleCommand(command: string): DangerLevel {
  // CRITICAL/HIGH are checked first (security takes priority)
  for (const pattern of CRITICAL_PATTERNS) {
    if (pattern.test(command)) return 'CRITICAL';
  }
  for (const pattern of HIGH_PATTERNS) {
    if (pattern.test(command)) return 'HIGH';
  }
  // SAFE patterns use ^ anchors, so they match specific known-safe commands
  for (const pattern of SAFE_PATTERNS) {
    if (pattern.test(command)) return 'SAFE';
  }
  // LOW patterns are more specific than MEDIUM (e.g., npm run test vs npm run)
  for (const pattern of LOW_PATTERNS) {
    if (pattern.test(command)) return 'LOW';
  }
  for (const pattern of MEDIUM_PATTERNS) {
    if (pattern.test(command)) return 'MEDIUM';
  }

  // 不明なコマンドは MEDIUM として扱う
  return 'MEDIUM';
}

/** コマンド文字列をパイプ、セミコロン、&& で分割 */
function splitCommands(command: string): string[] {
  // 簡易的な分割。クオート内は無視しない（完全なパーサーは過剰）
  return command.split(/\s*(?:\|(?!\|)|\|\||&&|;)\s*/);
}

const LEVEL_ORDER: DangerLevel[] = ['SAFE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function getHighestLevel(levels: DangerLevel[]): DangerLevel {
  let highest = 0;
  for (const level of levels) {
    const idx = LEVEL_ORDER.indexOf(level);
    if (idx > highest) highest = idx;
  }
  return LEVEL_ORDER[highest];
}

/**
 * 危険度レベルから表示情報を取得
 */
export function getDangerInfo(level: DangerLevel): DangerInfo {
  return DANGER_INFO_MAP[level];
}

/**
 * コマンドを解析して DangerInfo を返す便利関数
 */
export function analyzeCommand(command: string): DangerInfo {
  return getDangerInfo(analyzeDangerLevel(command));
}

/** ツール名から危険度レベルを取得 */
function getToolDangerLevel(toolName: string): DangerLevel {
  // 読み取り専用ツール
  if (['Read', 'Glob', 'Grep'].includes(toolName)) return 'SAFE';
  // サブエージェント起動
  if (toolName === 'Task') return 'LOW';
  // ファイル変更系
  if (['Edit', 'Write', 'NotebookEdit'].includes(toolName)) return 'MEDIUM';
  // 外部ネットワーク
  if (toolName === 'WebFetch') return 'HIGH';
  // MCP ツール・未知のツール
  return 'MEDIUM';
}

/**
 * 危険度を最低レベルまで引き上げる。
 * 現在の level が minLevel より低ければ minLevel の DangerInfo を返す。
 */
export function elevateToMinimum(info: DangerInfo, minLevel: DangerLevel): DangerInfo {
  const currentIdx = LEVEL_ORDER.indexOf(info.level);
  const minIdx = LEVEL_ORDER.indexOf(minLevel);
  if (currentIdx >= minIdx) return info;
  return getDangerInfo(minLevel);
}

/**
 * ツール種別に対応した危険度判定
 * Bash は既存の analyzeCommand に委譲、その他はツール名から判定
 */
export function analyzeToolDanger(
  toolName: string,
  toolInput: Record<string, unknown>,
): DangerInfo {
  if (toolName === 'Bash') {
    return analyzeCommand((toolInput.command as string) || '');
  }
  return getDangerInfo(getToolDangerLevel(toolName));
}
