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
const notificationMessage = document.getElementById('notification-message')!;
const btnDismiss = document.getElementById('btn-dismiss')!;

let currentRequestId: string | null = null;

// Type icons
const TYPE_ICONS: Record<string, string> = {
  info: '\u2139\uFE0F',
  stop: '\u2705',
  question: '\u2753',
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

  // Icon
  notificationIcon.textContent = TYPE_ICONS[data.type] || TYPE_ICONS.info;

  // Title
  notificationTitle.textContent = data.title;

  // Message
  notificationMessage.textContent = data.message;

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

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (currentRequestId) {
    if (e.key === 'Enter') {
      e.preventDefault();
      respond('allow');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      respond('deny');
    }
  } else {
    // Notification view - any key dismisses
    if (e.key === 'Escape' || e.key === 'Enter') {
      window.notifierAPI.dismissNotification();
    }
  }
});

// Listen for IPC events from main process
window.notifierAPI.onPermission(showPermissionView);
window.notifierAPI.onNotification(showNotificationView);
