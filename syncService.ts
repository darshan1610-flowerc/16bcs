  import { io } from 'socket.io-client';
import { User } from './types';

let socket: any = null;
let lastUpdateTimestamp = 0;
let lastPosition: { lat: number, lng: number } | null = null;

const THROTTLE_MS = 10000; 
const MOVEMENT_THRESHOLD = 0.0002; 

export const BACKEND_PROD_URL = 'https://bcs-media-backend.onrender.com';

export const syncService = {
  fetchInitialState: async (eventCode: string) => {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const BACKEND_URL = isLocal ? 'http://localhost:5000' : BACKEND_PROD_URL;
    try {
      const res = await fetch(`${BACKEND_URL}/api/state/${eventCode}`);
      if (!res.ok) throw new Error("Sync Fail");
      return await res.json();
    } catch (e) {
      console.warn("Using local cache, HQ unreachable.");
      return null;
    }
  },

  init: (eventCode: string, user: User, onUpdate: (data: any) => void) => {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const BACKEND_URL = isLocal ? 'http://localhost:5000' : BACKEND_PROD_URL; 
    
    socket = io(BACKEND_URL, {
      transports: ['websocket'],
      reconnectionAttempts: 10,
      timeout: 20000,
      autoConnect: true
    } as any);
    
    socket.on('connect', () => {
      console.log("%c✓ HQ CONNECTION ESTABLISHED", "color: #10b981; font-weight: bold;");
      socket?.emit('join_event', { eventCode, user });
    });

    socket.on('user_status_changed', (data: any) => onUpdate({ type: 'user', ...data }));
    socket.on('telemetry_received', (data: any) => onUpdate({ type: 'user', ...data }));
    socket.on('new_activity', (data: any) => onUpdate(data));
    
    return () => {
      socket?.disconnect();
    };
  },

  pushState: (eventCode: string, userId: string, data: Partial<User>) => {
    const now = Date.now();
    
    if (data.currentLocation) {
      const { lat, lng } = data.currentLocation;
      const hasMovedSignificantly = !lastPosition || 
        Math.abs(lat - lastPosition.lat) > MOVEMENT_THRESHOLD || 
        Math.abs(lng - lastPosition.lng) > MOVEMENT_THRESHOLD;

      const isTimeElapsed = (now - lastUpdateTimestamp) > THROTTLE_MS;
      if (!hasMovedSignificantly && !isTimeElapsed && !data.attendance) return; 

      lastUpdateTimestamp = now;
      lastPosition = { lat, lng };
    }

    if (socket?.connected) {
      socket.emit('update_location', { eventCode, userId, data });
    }
  },

  broadcastActivity: (eventCode: string, type: 'messages' | 'workUpdates', item: any) => {
    if (socket?.connected) {
      socket.emit('broadcast_activity', { eventCode, type, item });
    }
  }
};
