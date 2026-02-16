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

// 1. Robust CORS configuration for event environments
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

const UserSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true },
  name: String,
  email: String,
  role: String,
  department: String,
  status: { type: String, default: 'Offline' },
  lastSeen: { type: Date, default: Date.now }
});

const LocationSchema = new mongoose.Schema({
  userId: String,
  lat: Number,
  lng: Number,
  isInsideGeofence: Boolean,
  timestamp: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  senderId: String,
  receiverId: String,
  text: String,
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const LocationUpdate = mongoose.model('Location', LocationSchema);
const Message = mongoose.model('Message', MessageSchema);

const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('✓ BCS Tactical Database Connected'))
    .catch(err => console.error('✗ Database Link Failure:', err));
}

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ status: 'ACTIVE', version: '1.2.1', hq_link: true });
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "AI link throttled." }
});

const verificationCache = new Map();

app.post('/api/verify', aiLimiter, async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: "No image data provided." });
  
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error("✗ CRITICAL: API_KEY is missing from environment variables.");
    return res.status(500).json({ 
      error: "HQ CONFIGURATION ERROR: The API_KEY is not set in the Render environment." 
    });
  }

  const hash = crypto.createHash('md5').update(image).digest('hex');
  if (verificationCache.has(hash)) return res.json(verificationCache.get(hash));

  try {
    const ai = new GoogleGenAI({ apiKey: apiKey });
    
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: image.split(',')[1] || image } },
          { text: "Location Verification: Extract GPS coordinates (latitude/longitude) from this photo's metadata or visual context (like campus buildings/landmarks). If the coordinates are present, provide them. Be generous with the isAuthentic flag - as long as it looks like a real photo of a location, set isAuthentic to true. Return strictly JSON." }
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

    const result = JSON.parse(response.text.trim());
    verificationCache.set(hash, result);
    res.json(result);
  } catch (error) {
    console.error("AI Generation Error:", error);
    res.status(500).json({ error: "Intelligence Uplink Failure: " + error.message });
  }
});

io.on('connection', (socket) => {
  socket.on('join_event', async ({ eventCode, user }) => {
    socket.join(eventCode);
    await User.findOneAndUpdate(
      { uid: user.id }, 
      { name: user.name, email: user.email, role: user.role, department: user.department, status: 'Online', lastSeen: Date.now() }, 
      { upsert: true }
    );
    socket.to(eventCode).emit('user_status_changed', { userId: user.id, status: 'Online' });
  });

  socket.on('update_location', async ({ eventCode, userId, data }) => {
    if (data.currentLocation) {
      await LocationUpdate.create({
        userId,
        lat: data.currentLocation.lat,
        lng: data.currentLocation.lng,
        isInsideGeofence: data.isInsideGeofence
      });
    }
    socket.to(eventCode).emit('telemetry_received', { userId, data });
  });

  socket.on('broadcast_activity', async ({ eventCode, type, item }) => {
    if (type === 'messages') {
      await Message.create({ senderId: item.senderId, receiverId: item.receiverId, text: item.text });
    }
    io.to(eventCode).emit('new_activity', { type, item });
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`BCS HQ Active on Port ${PORT}`));
