import { WebSocket } from 'ws';

type MonitorMessage =
  | { type: 'audio'; role: 'agent' | 'customer'; rate: number; data: string }
  | { type: 'clear'; role?: 'agent' | 'customer' }
  | { type: 'ended' };

const monitors = new Map<number, Set<WebSocket>>();

export function addMonitor(jobId: number, ws: WebSocket) {
  const list = monitors.get(jobId) ?? new Set<WebSocket>();
  list.add(ws);
  monitors.set(jobId, list);
  ws.on('close', () => {
    list.delete(ws);
    if (list.size === 0) monitors.delete(jobId);
  });
}

export function broadcastMonitorAudio(jobId: number | null, message: MonitorMessage) {
  if (!jobId) return;
  const list = monitors.get(jobId);
  if (!list) return;
  const payload = JSON.stringify(message);
  for (const ws of list) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

export function broadcastMonitorEvent(jobId: number | null, message: MonitorMessage) {
  broadcastMonitorAudio(jobId, message);
}
