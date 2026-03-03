import type { NotificationPopupData } from './types';

/** 2つの通知が同一内容かを判定する */
export function isSameNotification(a: NotificationPopupData, b: NotificationPopupData): boolean {
  return a.message === b.message && a.type === b.type && a.projectName === b.projectName;
}

/**
 * ノンブロッキング通知の重複チェック（キュー内 + 現在表示中）
 *
 * question タイプはユーザーの明示的な応答が必要なのでスキップしない。
 * info / stop タイプで同一内容（message + type + projectName）が
 * 現在表示中またはキュー内に存在する場合は重複と判定する。
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
  return queue.some((queued) => isSameNotification(queued, data));
}
