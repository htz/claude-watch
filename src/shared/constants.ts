import path from 'path';
import os from 'os';

export const SOCKET_DIR = path.join(os.homedir(), '.claude-watch');
export const SOCKET_PATH = path.join(SOCKET_DIR, 'watch.sock');
