/** 危険度レベル */
export type DangerLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** 危険度情報 */
export interface DangerInfo {
  level: DangerLevel;
  label: string;
  badgeColor: string;
  buttonColor: string;
}

/** 未許可コマンド情報 */
export interface UnmatchedCommandsInfo {
  commands: string[];
  hasUnresolvable: boolean;
}

/** パーミッション要求 (HTTP POST /permission) */
export interface PermissionRequest {
  tool_name: string;
  tool_input: {
    command?: string;
    description?: string;
    [key: string]: unknown;
  };
  session_cwd?: string;
  unmatched_commands?: UnmatchedCommandsInfo;
}

/** パーミッション応答 */
export interface PermissionResponse {
  decision: 'allow' | 'deny' | 'skip';
}

/** 通知要求 (HTTP POST /notification) */
export interface NotificationRequest {
  message: string;
  title?: string;
  type?: 'info' | 'stop' | 'question';
  session_cwd?: string;
}

/** キュー内のパーミッションアイテム */
export interface QueueItem {
  id: string;
  request: PermissionRequest;
  dangerInfo: DangerInfo;
  description: string;
  displayText: string;
  resolve: (response: PermissionResponse) => void;
  createdAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/** レンダラーに送信するポップアップデータ */
export interface PopupData {
  id: string;
  toolName: string;
  command: string;
  dangerInfo: DangerInfo;
  description: string;
  queueCount: number;
  projectName?: string;
  unmatchedCommands?: UnmatchedCommandsInfo;
}

/** 通知ポップアップデータ */
export interface NotificationPopupData {
  message: string;
  title: string;
  type: 'info' | 'stop' | 'question';
  projectName?: string;
  queueCount: number;
}

/** preload で公開する API */
export interface ClaudeWatchAPI {
  onPermission: (callback: (data: PopupData) => void) => void;
  onNotification: (callback: (data: NotificationPopupData) => void) => void;
  onQueueUpdate: (callback: (count: number) => void) => void;
  respond: (id: string, decision: 'allow' | 'deny' | 'skip') => void;
  dismissNotification: () => void;
}

declare global {
  interface Window {
    claudeWatchAPI: ClaudeWatchAPI;
  }
}
