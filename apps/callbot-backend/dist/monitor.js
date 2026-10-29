import { WebSocket } from 'ws';
const monitors = new Map();
export function addMonitor(jobId, ws) {
    const list = monitors.get(jobId) ?? new Set();
    list.add(ws);
    monitors.set(jobId, list);
    ws.on('close', () => {
        list.delete(ws);
        if (list.size === 0)
            monitors.delete(jobId);
    });
}
export function broadcastMonitorAudio(jobId, message) {
    if (!jobId)
        return;
    const list = monitors.get(jobId);
    if (!list)
        return;
    const payload = JSON.stringify(message);
    for (const ws of list) {
        if (ws.readyState === WebSocket.OPEN)
            ws.send(payload);
    }
}
export function broadcastMonitorEvent(jobId, message) {
    broadcastMonitorAudio(jobId, message);
}
