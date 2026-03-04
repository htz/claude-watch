import type { NotificationPopupData } from './types';

/** 2つの通知が同一内容かを判定する */
export function isSameNotification(a: NotificationPopupData, b: NotificationPopupData): boolean {
  return a.message === b.message && a.type === b.type && a.projectName === b.projectName;
}

/** 最近表示した通知の記録 */
interface RecentEntry {
  message: string;
  type: string;
  projectName: string | undefined;
  shownAt: number;
}

/** 時間ベース重複排除の冷却期間 (ミリ秒) */
const DEDUP_COOLDOWN_MS = 30_000;

/** 最近表示した通知の履歴 (時間ベース重複排除用) */
const recentNotifications: RecentEntry[] = [];

/** 最大履歴サイズ */
const MAX_RECENT_SIZE = 50;

/**
 * 通知を表示履歴に記録する。
 * displayNotification() から呼び出すこと。
 */
export function recordNotificationShown(data: NotificationPopupData): void {
  recentNotifications.push({
    message: data.message,
    type: data.type,
    projectName: data.projectName,
    shownAt: Date.now(),
  });
  // 古いエントリを削除
  if (recentNotifications.length > MAX_RECENT_SIZE) {
    recentNotifications.splice(0, recentNotifications.length - MAX_RECENT_SIZE);
  }
}

/** 冷却期間内に同一通知が表示済みか判定する */
function isRecentlyShown(data: NotificationPopupData, now: number): boolean {
  const cutoff = now - DEDUP_COOLDOWN_MS;
  return recentNotifications.some(
    (entry) =>
      entry.shownAt > cutoff &&
      entry.message === data.message &&
      entry.type === data.type &&
      entry.projectName === data.projectName,
  );
}

/**
 * ノンブロッキング通知の重複チェック（キュー内 + 現在表示中 + 時間ベース）
 *
 * question タイプはユーザーの明示的な応答が必要なのでスキップしない。
 * info / stop タイプで同一内容（message + type + projectName）が
 * 現在表示中、キュー内、または冷却期間内に表示済みの場合は重複と判定する。
 */
export function isNotificationDuplicate(
  data: NotificationPopupData,
  currentNotification: NotificationPopupData | null,
  isNotificationVisible: boolean,
  queue: readonly NotificationPopupData[],
): boolean {
  // question タイプはユーザーの明示的な応答が必要なのでスキップしない
  if (data.type === 'question') return false;

  // 現在表示中の通知と重複
  if (currentNotification && isNotificationVisible && isSameNotification(currentNotification, data)) {
    return true;
  }

  // キュー内に重複
  if (queue.some((queued) => isSameNotification(queued, data))) {
    return true;
  }

  // 冷却期間内に同一通知を表示済み
  if (isRecentlyShown(data, Date.now())) {
    return true;
  }

  return false;
}

/** テスト用: 履歴をクリアする */
export function clearRecentNotifications(): void {
  recentNotifications.length = 0;
}
