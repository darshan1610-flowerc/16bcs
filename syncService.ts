import { io, Socket } from 'socket.io-client';
import { User } from './types';

// Use 'any' type for socket to resolve issues with mismatched type definitions in this environment
let socket: any = null;
let lastUpdateTimestamp = 0;
let lastPosition: { lat: number, lng: number } | null = null;

const THROTTLE_MS = 10000; 
const MOVEMENT_THRESHOLD = 0.0002; 

/**
 * 🛰️ PRODUCTION CONFIGURATION
 * Paste your Render URL here once it is deployed.
 */
export const BACKEND_PROD_URL = 'https://bcs-media-backend.onrender.com';

export const syncService = {
  init: (eventCode: string, user: User, onUpdate: (data: any) => void) => {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const BACKEND_URL = isLocal ? 'http://localhost:5000' : BACKEND_PROD_URL; 
    
    console.log(`[BCS Sync] Initializing Link to: ${BACKEND_URL}`);
    
    // Cast options to any to fix "transports" property error
    socket = io(BACKEND_URL, {
      transports: ['websocket'],
      reconnectionAttempts: 10,
      timeout: 20000
    } as any);
    
    // Using any for the socket variable resolves the missing '.on' property error
    socket.on('connect', () => {
      console.log("✓ HQ Link Established - Signaling Session Start");
      socket?.emit('join_event', { eventCode, user });
    });

    socket.on('connect_error', (err: any) => {
      console.error("✗ HQ Link Failure:", err.message);
    });

    socket.on('user_status_changed', (data: any) => onUpdate({ type: 'user', data }));
    socket.on('telemetry_received', (data: any) => onUpdate({ type: 'user', ...data }));
    socket.on('new_activity', (data: any) => onUpdate({ type: 'activity', ...data }));
    
    return () => {
      console.log("[BCS Sync] Severing Link");
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

      if (!hasMovedSignificantly && !isTimeElapsed) return; 

      lastUpdateTimestamp = now;
      lastPosition = { lat, lng };
    }

    socket?.emit('update_location', { eventCode, userId, data });
  },

  broadcastActivity: (eventCode: string, type: 'messages' | 'workUpdates', item: any) => {
    socket?.emit('broadcast_activity', { eventCode, type, item });
  }
};