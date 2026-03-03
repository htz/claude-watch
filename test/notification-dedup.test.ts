import { describe, expect, it } from 'vitest';
import { isNotificationDuplicate, isSameNotification } from '../src/shared/notification-dedup';
import type { NotificationPopupData } from '../src/shared/types';

/** テスト用のヘルパー: NotificationPopupData を生成 */
function makeNotification(overrides: Partial<NotificationPopupData> = {}): NotificationPopupData {
  return {
    message: 'タスクが完了しました',
    title: '通知',
    type: 'info',
    projectName: 'my-project',
    queueCount: 0,
    ...overrides,
  };
}

describe('isSameNotification', () => {
  it('message, type, projectName が全て一致すれば true', () => {
    const a = makeNotification();
    const b = makeNotification();
    expect(isSameNotification(a, b)).toBe(true);
  });

  it('message が異なれば false', () => {
    const a = makeNotification({ message: 'A' });
    const b = makeNotification({ message: 'B' });
    expect(isSameNotification(a, b)).toBe(false);
  });

  it('type が異なれば false', () => {
    const a = makeNotification({ type: 'info' });
    const b = makeNotification({ type: 'stop' });
    expect(isSameNotification(a, b)).toBe(false);
  });

  it('projectName が異なれば false', () => {
    const a = makeNotification({ projectName: 'project-a' });
    const b = makeNotification({ projectName: 'project-b' });
    expect(isSameNotification(a, b)).toBe(false);
  });

  it('projectName が両方 undefined なら一致', () => {
    const a = makeNotification({ projectName: undefined });
    const b = makeNotification({ projectName: undefined });
    expect(isSameNotification(a, b)).toBe(true);
  });

  it('queueCount が異なっても一致判定に影響しない', () => {
    const a = makeNotification({ queueCount: 0 });
    const b = makeNotification({ queueCount: 5 });
    expect(isSameNotification(a, b)).toBe(true);
  });

  it('title が異なっても一致判定に影響しない', () => {
    const a = makeNotification({ title: 'タイトルA' });
    const b = makeNotification({ title: 'タイトルB' });
    expect(isSameNotification(a, b)).toBe(true);
  });
});

describe('isNotificationDuplicate', () => {
  describe('question タイプ', () => {
    it('question タイプは常に重複とみなさない', () => {
      const data = makeNotification({ type: 'question' });
      const current = makeNotification({ type: 'question' });
      const queue = [makeNotification({ type: 'question' })];

      expect(isNotificationDuplicate(data, current, true, queue)).toBe(false);
    });
  });

  describe('現在表示中の通知との重複', () => {
    it('表示中の通知と同一内容なら重複', () => {
      const data = makeNotification();
      const current = makeNotification();

      expect(isNotificationDuplicate(data, current, true, [])).toBe(true);
    });

    it('通知が表示中でなければ重複判定しない', () => {
      const data = makeNotification();
      const current = makeNotification();

      expect(isNotificationDuplicate(data, current, false, [])).toBe(false);
    });

    it('currentNotification が null なら重複判定しない', () => {
      const data = makeNotification();

      expect(isNotificationDuplicate(data, null, true, [])).toBe(false);
    });

    it('表示中の通知と内容が異なれば重複ではない', () => {
      const data = makeNotification({ message: '新しい通知' });
      const current = makeNotification({ message: '古い通知' });

      expect(isNotificationDuplicate(data, current, true, [])).toBe(false);
    });

    it('表示中の通知とプロジェクトが異なれば重複ではない', () => {
      const data = makeNotification({ projectName: 'project-a' });
      const current = makeNotification({ projectName: 'project-b' });

      expect(isNotificationDuplicate(data, current, true, [])).toBe(false);
    });
  });

  describe('キュー内の通知との重複', () => {
    it('キュー内に同一内容があれば重複', () => {
      const data = makeNotification();
      const queue = [makeNotification()];

      expect(isNotificationDuplicate(data, null, false, queue)).toBe(true);
    });

    it('キュー内に同一内容がなければ重複ではない', () => {
      const data = makeNotification({ message: '新しい通知' });
      const queue = [makeNotification({ message: '別の通知' })];

      expect(isNotificationDuplicate(data, null, false, queue)).toBe(false);
    });

    it('キューが空なら重複ではない', () => {
      const data = makeNotification();

      expect(isNotificationDuplicate(data, null, false, [])).toBe(false);
    });

    it('キュー内に複数項目があり、いずれかと一致すれば重複', () => {
      const data = makeNotification({ message: 'ターゲット' });
      const queue = [
        makeNotification({ message: '別の通知1' }),
        makeNotification({ message: 'ターゲット' }),
        makeNotification({ message: '別の通知2' }),
      ];

      expect(isNotificationDuplicate(data, null, false, queue)).toBe(true);
    });

    it('同一プロジェクトでも message が異なればキュー内で重複しない', () => {
      const data = makeNotification({ message: 'A' });
      const queue = [makeNotification({ message: 'B' })];

      expect(isNotificationDuplicate(data, null, false, queue)).toBe(false);
    });

    it('同一 message でもプロジェクトが異なればキュー内で重複しない', () => {
      const data = makeNotification({ projectName: 'project-a' });
      const queue = [makeNotification({ projectName: 'project-b' })];

      expect(isNotificationDuplicate(data, null, false, queue)).toBe(false);
    });
  });

  describe('表示中 + キュー両方のチェック', () => {
    it('表示中に重複があればキューをチェックせず重複', () => {
      const data = makeNotification();
      const current = makeNotification();
      const queue = [makeNotification({ message: '別' })];

      expect(isNotificationDuplicate(data, current, true, queue)).toBe(true);
    });

    it('表示中に重複がなくてもキューに重複があれば重複', () => {
      const data = makeNotification({ message: 'ターゲット' });
      const current = makeNotification({ message: '別の表示中' });
      const queue = [makeNotification({ message: 'ターゲット' })];

      expect(isNotificationDuplicate(data, current, true, queue)).toBe(true);
    });

    it('表示中にもキューにも重複がなければ重複ではない', () => {
      const data = makeNotification({ message: '新規' });
      const current = makeNotification({ message: '表示中' });
      const queue = [makeNotification({ message: 'キュー内' })];

      expect(isNotificationDuplicate(data, current, true, queue)).toBe(false);
    });
  });

  describe('stop タイプ', () => {
    it('stop タイプも重複チェック対象', () => {
      const data = makeNotification({ type: 'stop' });
      const queue = [makeNotification({ type: 'stop' })];

      expect(isNotificationDuplicate(data, null, false, queue)).toBe(true);
    });

    it('stop と info は type が異なるので重複しない', () => {
      const data = makeNotification({ type: 'stop' });
      const queue = [makeNotification({ type: 'info' })];

      expect(isNotificationDuplicate(data, null, false, queue)).toBe(false);
    });
  });
});
