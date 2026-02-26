import './style.css';
import type { PopupData, NotificationPopupData } from '../shared/types';

// DOM elements
const permissionView = document.getElementById('permission-view')!;
const notificationView = document.getElementById('notification-view')!;
const dangerBadge = document.getElementById('danger-badge')!;
const toolName = document.getElementById('tool-name')!;
const queueBadge = document.getElementById('queue-badge')!;
const commandText = document.getElementById('command-text')!;
const descriptionText = document.getElementById('description-text')!;
const projectName = document.getElementById('project-name')!;
const btnDeny = document.getElementById('btn-deny')!;
const btnAllow = document.getElementById('btn-allow')!;
const btnSkip = document.getElementById('btn-skip')!;
const notificationIcon = document.getElementById('notification-icon')!;
const notificationTitle = document.getElementById('notification-title')!;
const notificationProjectName = document.getElementById('notification-project-name')!;
const notificationQueueBadge = document.getElementById('notification-queue-badge')!;
const notificationMessage = document.getElementById('notification-message')!;
const btnDismiss = document.getElementById('btn-dismiss')!;
const btnOk = document.getElementById('btn-ok')!;

let currentRequestId: string | null = null;

// Type config: icon, button color, button label
interface TypeConfig {
  icon: string;
  buttonColor: string;
  label: string;
}

const TYPE_CONFIG: Record<string, TypeConfig> = {
  info:     { icon: '\uD83D\uDCE2', buttonColor: '#007aff', label: 'OK' },
  stop:     { icon: '\u2705',       buttonColor: '#34c759', label: 'OK' },
  question: { icon: '\uD83D\uDCAC', buttonColor: '#ff9500', label: '\u78BA\u8A8D' },
};

function showPermissionView(data: PopupData): void {
  currentRequestId = data.id;

  // Hide notification, show permission
  notificationView.classList.add('hidden');
  permissionView.classList.remove('hidden');

  // Danger badge
  dangerBadge.textContent = data.dangerInfo.label;
  dangerBadge.style.backgroundColor = data.dangerInfo.badgeColor;

  // Tool name
  toolName.textContent = data.toolName;

  // Project name
  if (data.projectName) {
    projectName.textContent = data.projectName;
    projectName.classList.remove('hidden');
  } else {
    projectName.classList.add('hidden');
  }

  // Queue badge
  if (data.queueCount > 0) {
    queueBadge.textContent = `+${data.queueCount} 件待機中`;
    queueBadge.classList.remove('hidden');
  } else {
    queueBadge.classList.add('hidden');
  }

  // Command
  commandText.textContent = data.command;

  // Description
  descriptionText.textContent = data.description;

  // Allow button color
  btnAllow.style.backgroundColor = data.dangerInfo.buttonColor;

  // Re-trigger animation
  permissionView.style.animation = 'none';
  permissionView.offsetHeight; // Force reflow
  permissionView.style.animation = '';
}

function showNotificationView(data: NotificationPopupData): void {
  currentRequestId = null;

  // Hide permission, show notification
  permissionView.classList.add('hidden');
  notificationView.classList.remove('hidden');

  const config = TYPE_CONFIG[data.type] || TYPE_CONFIG.info;

  // Icon
  notificationIcon.textContent = config.icon;

  // Title
  notificationTitle.textContent = data.title;

  // Message
  notificationMessage.textContent = data.message;

  // OK button
  btnOk.textContent = config.label;
  btnOk.style.backgroundColor = config.buttonColor;

  // Project name
  if (data.projectName) {
    notificationProjectName.textContent = data.projectName;
    notificationProjectName.classList.remove('hidden');
  } else {
    notificationProjectName.classList.add('hidden');
  }

  // Queue badge
  if (data.queueCount > 0) {
    notificationQueueBadge.textContent = `+${data.queueCount} 件待機中`;
    notificationQueueBadge.classList.remove('hidden');
  } else {
    notificationQueueBadge.classList.add('hidden');
  }

  // Re-trigger animation
  notificationView.style.animation = 'none';
  notificationView.offsetHeight;
  notificationView.style.animation = '';
}

function respond(decision: 'allow' | 'deny' | 'skip'): void {
  if (!currentRequestId) return;
  window.notifierAPI.respond(currentRequestId, decision);
  currentRequestId = null;
}

// Button event listeners
btnAllow.addEventListener('click', (e) => {
  e.stopPropagation();
  respond('allow');
});

btnDeny.addEventListener('click', (e) => {
  e.stopPropagation();
  respond('deny');
});

btnSkip.addEventListener('click', (e) => {
  e.stopPropagation();
  respond('skip');
});

btnDismiss.addEventListener('click', (e) => {
  e.stopPropagation();
  window.notifierAPI.dismissNotification();
});

btnOk.addEventListener('click', (e) => {
  e.stopPropagation();
  window.notifierAPI.dismissNotification();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (currentRequestId) {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      respond('allow');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      respond('deny');
    }
  } else {
    // Notification view
    if (e.key === 'Escape' || (e.key === 'Enter' && e.metaKey)) {
      window.notifierAPI.dismissNotification();
    }
  }
});

// Listen for IPC events from main process
window.notifierAPI.onPermission(showPermissionView);
window.notifierAPI.onNotification(showNotificationView);
window.notifierAPI.onQueueUpdate((count: number) => {
  if (count > 0) {
    notificationQueueBadge.textContent = `+${count} 件待機中`;
    notificationQueueBadge.classList.remove('hidden');
  } else {
    notificationQueueBadge.classList.add('hidden');
  }
});
