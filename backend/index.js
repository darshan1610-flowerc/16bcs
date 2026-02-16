import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { GoogleGenAI, Type } from "@google/genai";
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

dotenv.config();

const app = express();
const httpServer = createServer(app);

const corsOptions = {
  origin: true,
  methods: ["GET", "POST", "OPTIONS", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

const io = new Server(httpServer, {
  cors: corsOptions
});

// Enhanced User Schema for persistence
const UserSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true },
  name: String,
  email: String,
  role: String,
  department: String,
  status: { type: String, default: 'Offline' },
  lastSeen: { type: Date, default: Date.now },
  attendance: [String],
  currentLocation: {
    lat: Number,
    lng: Number,
    timestamp: Number
  },
  isInsideGeofence: Boolean
});

const MessageSchema = new mongoose.Schema({
  senderId: String,
  receiverId: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
  isRead: { type: Boolean, default: false }
});

const WorkUpdateSchema = new mongoose.Schema({
  userId: String,
  task: String,
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);
const WorkUpdate = mongoose.model('WorkUpdate', WorkUpdateSchema);

const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('✓ BCS Tactical Database Connected'))
    .catch(err => console.error('✗ Database Link Failure:', err));
}

// 1. STATE RECOVERY ENDPOINT
app.get('/api/state/:eventCode', async (req, res) => {
  try {
    const users = await User.find({});
    const messages = await Message.find({}).sort({ timestamp: 1 }).limit(100);
    const workUpdates = await WorkUpdate.find({}).sort({ timestamp: -1 }).limit(50);
    
    // Map DB users to a record object for the frontend
    const userMap = {};
    users.forEach(u => {
      userMap[u.uid] = {
        status: u.status,
        attendance: u.attendance,
        currentLocation: u.currentLocation,
        isInsideGeofence: u.isInsideGeofence,
        lastSeen: u.lastSeen?.getTime()
      };
    });

    res.json({
      users: userMap,
      messages: messages.map(m => ({
        id: m._id,
        senderId: m.senderId,
        receiverId: m.receiverId,
        text: m.text,
        timestamp: m.timestamp.getTime(),
        isRead: m.isRead
      })),
      workUpdates: workUpdates.map(w => ({
        id: w._id,
        userId: w.userId,
        task: w.task,
        timestamp: w.timestamp.getTime()
      }))
    });
  } catch (err) {
    res.status(500).json({ error: "State Recovery Failure" });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ACTIVE', version: '2.0.0', hq_link: true });
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "AI link throttled." }
});

app.post('/api/verify', aiLimiter, async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: "No image data" });
  
  const apiKey = process.env.API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API_KEY Missing" });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: image.split(',')[1] || image } },
          { text: "Extract GPS coordinates. Return JSON with latitude, longitude, isAuthentic, isCampus, confidence." }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            latitude: { type: Type.NUMBER },
            longitude: { type: Type.NUMBER },
            isAuthentic: { type: Type.BOOLEAN },
            isCampus: { type: Type.BOOLEAN },
            confidence: { type: Type.NUMBER }
          },
          required: ["latitude", "longitude", "isAuthentic", "isCampus", "confidence"]
        }
      }
    });

    res.json(JSON.parse(response.text.trim()));
  } catch (error) {
    res.status(500).json({ error: "AI UPLINK ERROR" });
  }
});

io.on('connection', (socket) => {
  socket.on('join_event', async ({ eventCode, user }) => {
    socket.join(eventCode);
    const updated = await User.findOneAndUpdate(
      { uid: user.id }, 
      { 
        name: user.name, 
        email: user.email, 
        role: user.role, 
        department: user.department, 
        status: 'Online', 
        lastSeen: Date.now() 
      }, 
      { upsert: true, new: true }
    );
    io.to(eventCode).emit('user_status_changed', { 
      userId: user.id, 
      status: 'Online',
      data: updated
    });
  });

  socket.on('update_location', async ({ eventCode, userId, data }) => {
    const updatePayload = { lastSeen: Date.now() };
    if (data.currentLocation) updatePayload.currentLocation = data.currentLocation;
    if (data.attendance) updatePayload.attendance = data.attendance;
    if (typeof data.isInsideGeofence === 'boolean') updatePayload.isInsideGeofence = data.isInsideGeofence;
    if (data.status) updatePayload.status = data.status;

    await User.findOneAndUpdate({ uid: userId }, updatePayload);
    socket.to(eventCode).emit('telemetry_received', { userId, data });
  });

  socket.on('broadcast_activity', async ({ eventCode, type, item }) => {
    if (type === 'messages') {
      await Message.create({ 
        senderId: item.senderId, 
        receiverId: item.receiverId, 
        text: item.text,
        timestamp: new Date(item.timestamp)
      });
    } else if (type === 'workUpdates') {
      await WorkUpdate.create({
        userId: item.userId,
        task: item.task,
        timestamp: new Date(item.timestamp)
      });
    }
    io.to(eventCode).emit('new_activity', { type, item });
  });

  socket.on('disconnect', () => {
    // We don't mark offline immediately to handle flaky connections
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`BCS HQ SECURE ON PORT ${PORT}`));
