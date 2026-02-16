
import React, { useState, useEffect, useCallback } from 'react';
import { Role, User, Equipment, ChatMessage, LocationPoint, WorkUpdate, Geofence } from './types';
import { INITIAL_USERS, INITIAL_EQUIPMENT } from './data';
import AdminDashboard from './components/AdminDashboard';
import MemberPortal from './components/MemberPortal';
import Login from './components/Login';
import { syncService } from './syncService';

const GEOFENCE: Geofence = {
  center: { lat: 18.5194, lng: 73.8150, timestamp: 0 },
  radiusLat: 0.005,
  radiusLng: 0.005,
  name: "Event Zone A"
};

const EVENT_CODE = "BCS-MAIN-EVENT";

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>(INITIAL_USERS);
  const [equipments, setEquipments] = useState<Equipment[]>(INITIAL_EQUIPMENT);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [workUpdates, setWorkUpdates] = useState<WorkUpdate[]>([]);
  const [trackingActive, setTrackingActive] = useState(false);
  const [lastSync, setLastSync] = useState<number>(Date.now());

  // Socket Connection Setup
  useEffect(() => {
    if (isLoggedIn && currentUser) {
      // Added missing 'currentUser' argument to match syncService.init(eventCode, user, onUpdate)
      const cleanup = syncService.init(EVENT_CODE, currentUser, (update) => {
        setLastSync(Date.now());
        
        if (update.type === 'full') {
          const state = update.state;
          setUsers(prev => prev.map(u => ({ ...u, ...(state.users[u.id] || {}) })));
          setMessages(state.messages);
          setWorkUpdates(state.workUpdates);
        } else if (update.type === 'user') {
          setUsers(prev => prev.map(u => u.id === update.userId ? { ...u, ...update.data } : u));
        } else if (update.type === 'activity') {
          if (update.type === 'messages') setMessages(prev => [...prev, update.item]);
          if (update.type === 'workUpdates') setWorkUpdates(prev => [update.item, ...prev]);
        }
      });
      return cleanup;
    }
  }, [isLoggedIn, currentUser]);

  const checkGeofence = (point: LocationPoint): boolean => {
    return (
      Math.abs(point.lat - GEOFENCE.center.lat) <= GEOFENCE.radiusLat &&
      Math.abs(point.lng - GEOFENCE.center.lng) <= GEOFENCE.radiusLng
    );
  };

  const handleUpdateLocation = (userId: string, lat: number, lng: number) => {
    const newPoint: LocationPoint = { lat, lng, timestamp: Date.now() };
    const isIn = checkGeofence(newPoint);
    
    setUsers(prev => prev.map(u => {
      if (u.id === userId) {
        const updated = {
          ...u,
          status: 'Online' as const,
          currentLocation: newPoint,
          isInsideGeofence: isIn,
          locationHistory: [...(u.locationHistory || []), newPoint].slice(-20)
        };
        syncService.pushState(EVENT_CODE, userId, updated);
        return updated;
      }
      return u;
    }));
  };

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    setIsLoggedIn(true);
    if (user.role === Role.ADMIN) setTrackingActive(true);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setCurrentUser(null);
    setTrackingActive(false);
  };

  const markAttendance = (userId: string, day: number, session: number) => {
    const sessionKey = `D${day}S${session}`;
    setUsers(prev => prev.map(u => {
      if (u.id === userId && !u.attendance.includes(sessionKey)) {
        const updated = { ...u, attendance: [...u.attendance, sessionKey] };
        syncService.pushState(EVENT_CODE, userId, { attendance: updated.attendance });
        return updated;
      }
      return u;
    }));
  };

  const updateEquipment = (eq: Equipment) => {
    setEquipments(prev => prev.map(e => e.id === eq.id ? eq : e));
  };

  const registerEquipment = (name: string, sn: string, memberId: string) => {
    const newEq: Equipment = {
      id: `eq-${Date.now()}`,
      name,
      serialNumber: sn,
      assignedToId: memberId,
      status: 'Good',
      lastUpdated: new Date().toISOString()
    };
    setEquipments(prev => [...prev, newEq]);
  };

  const sendChatMessage = (senderId: string, receiverId: string, text: string) => {
    const newMessage: ChatMessage = {
      id: Math.random().toString(36).substr(2, 9),
      senderId,
      receiverId,
      text,
      timestamp: Date.now(),
      isRead: false
    };
    setMessages(prev => [...prev, newMessage]);
    syncService.broadcastActivity(EVENT_CODE, 'messages', newMessage);
  };

  const addWorkUpdate = (userId: string, task: string) => {
    const update: WorkUpdate = {
      id: Math.random().toString(36).substr(2, 9),
      userId,
      task,
      timestamp: Date.now()
    };
    setWorkUpdates(prev => [update, ...prev]);
    syncService.broadcastActivity(EVENT_CODE, 'workUpdates', update);
  };

  if (!isLoggedIn || !currentUser) {
    return <Login users={users} onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-slate-900 text-white p-2 text-xs flex justify-between items-center px-6 z-50 border-b border-slate-800">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${trackingActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></div>
            <span className="font-mono uppercase tracking-tighter text-[10px]">Relay: {trackingActive ? 'Socket Live' : 'Disconnected'}</span>
          </div>
          <div className="flex items-center gap-2 border-l border-slate-700 pl-4">
            <div className={`w-1.5 h-1.5 rounded-full bg-blue-500`}></div>
            <span className="text-[9px] text-slate-400 font-bold uppercase">Event: {EVENT_CODE}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-400">|</span>
          <span className="font-mono text-[9px] text-slate-500">Last Sync: {new Date(lastSync).toLocaleTimeString()}</span>
          <button 
            onClick={handleLogout}
            className="bg-slate-800 hover:bg-red-600 px-3 py-1 rounded font-medium transition-colors border border-slate-700"
          >
            Log Out
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-auto bg-slate-950">
        {currentUser.role === Role.ADMIN ? (
          <AdminDashboard 
            users={users} 
            equipments={equipments}
            messages={messages}
            workUpdates={workUpdates}
            onUpdateEquipment={updateEquipment}
            onRegisterEquipment={registerEquipment}
            onSendMessage={sendChatMessage}
            adminId={currentUser.id}
          />
        ) : (
          <MemberPortal 
            user={users.find(u => u.id === currentUser.id)!}
            allUsers={users}
            equipments={equipments.filter(e => e.assignedToId === currentUser.id)}
            messages={messages}
            onMarkAttendance={(day, session) => markAttendance(currentUser.id, day, session)}
            onToggleTracking={() => setTrackingActive(!trackingActive)}
            onUpdateLocation={(lat, lng) => handleUpdateLocation(currentUser.id, lat, lng)}
            isTracking={trackingActive}
            onSendMessage={(text) => sendChatMessage(currentUser.id, 'admin-1', text)}
            onAddWorkUpdate={(task) => addWorkUpdate(currentUser.id, task)}
          />
        )}
      </main>
    </div>
  );
};

export default App;
