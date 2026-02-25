/** 危険度レベル */
export type DangerLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** 危険度情報 */
export interface DangerInfo {
  level: DangerLevel;
  label: string;
  badgeColor: string;
  buttonColor: string;
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
}

/** キュー内のパーミッションアイテム */
export interface QueueItem {
  id: string;
  request: PermissionRequest;
  dangerInfo: DangerInfo;
  description: string;
  resolve: (response: PermissionResponse) => void;
  createdAt: number;
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
}

/** 通知ポップアップデータ */
export interface NotificationPopupData {
  message: string;
  title: string;
  type: 'info' | 'stop' | 'question';
}

/** preload で公開する API */
export interface NotifierAPI {
  onPermission: (callback: (data: PopupData) => void) => void;
  onNotification: (callback: (data: NotificationPopupData) => void) => void;
  respond: (id: string, decision: 'allow' | 'deny' | 'skip') => void;
  dismissNotification: () => void;
}

declare global {
  interface Window {
    notifierAPI: NotifierAPI;
  }
}
