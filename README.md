# 🛰️ BCS MEDIA TEAM PRO - DEPLOYMENT MANUAL

This project is a **Monorepo**. The Frontend is in the root, and the Server is in `/backend`.

---

## 🛠️ PHASE 1: PUSH TO GITHUB (POWERSHELL COMMANDS)
Run these commands in your project folder:

1. `git init`
2. `git add .`
3. `git commit -m "Ready for Deployment"`
4. `git remote add origin [YOUR_GITHUB_URL]`
5. `git branch -M main`
6. `git push -u origin main`

---

## ⚙️ PHASE 2: DEPLOY BACKEND (RENDER.COM)
1. **New Web Service** -> Connect GitHub Repo.
2. **Name**: `bcs-backend`
3. **Environment**: `Node`
4. **Root Directory**: `backend` (⚠️ DO NOT SKIP THIS)
5. **Build Command**: `npm install`
6. **Start Command**: `node index.js`
7. **ENV VARIABLES**:
   - `MONGODB_URI`: [Your MongoDB Link]
   - `API_KEY`: [Your Gemini API Key]
8. **COPY THE URL**: (e.g., `https://bcs-backend.onrender.com`)

---

## 🌐 PHASE 3: DEPLOY FRONTEND (NETLIFY)
1. **New Site** -> Import from GitHub.
2. **Base directory**: (Leave empty)
3. **Build command**: `npm run build`
4. **Publish directory**: `dist`
5. **ENV VARIABLES**:
   - `API_KEY`: [Your Gemini API Key]
6. **IMPORTANT**: After Netlify gives you a link, go to `syncService.ts`, update `BACKEND_PROD_URL` with your Render link, and push to GitHub again.

---

## 🚨 TROUBLESHOOTING
- **Camera/GPS not working?** Make sure you are using `https://`.
- **Backend not connecting?** Check that you entered the `backend` folder as the **Root Directory** in Render.