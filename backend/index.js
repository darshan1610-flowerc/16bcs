
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

// Updated CORS to be more flexible for deployment
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allow all for initial deployment, then restrict to your Netlify URL
    methods: ["GET", "POST"]
  }
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

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check route
app.get('/', (req, res) => res.send('BCS Tactical Server: ACTIVE'));

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "AI link throttled." }
});

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const verificationCache = new Map();

app.post('/api/verify', aiLimiter, async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: "No image data." });
  const hash = crypto.createHash('md5').update(image).digest('hex');
  if (verificationCache.has(hash)) return res.json(verificationCache.get(hash));

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: image.split(',')[1] || image } },
          { text: "Verify if this photo is taken at a university campus. Extract GPS coords from the image metadata. Return JSON." }
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
    res.status(500).json({ error: "Intelligence Uplink Failure" });
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
