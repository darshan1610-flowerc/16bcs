import { BACKEND_PROD_URL } from './syncService';

export interface VerificationResult {
  latitude: number | null;
  longitude: number | null;
  isAuthentic: boolean;
  isCampus: boolean;
  confidence: number;
  detectedAddress?: string;
  error?: string;
}

/**
 * Pings the backend to wake it up or check status
 */
export const wakeUpHQ = async (): Promise<boolean> => {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const BACKEND_URL = isLocal ? 'http://localhost:5000' : BACKEND_PROD_URL.replace(/\/$/, '');
  
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(BACKEND_URL, { signal: controller.signal });
    clearTimeout(id);
    return res.ok;
  } catch (e) {
    return false;
  }
};

/**
 * Communicates with the BCS backend for AI-based image verification.
 */
export const verifyAttendanceImage = async (base64Image: string): Promise<VerificationResult> => {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  
  // Ensure the URL is clean and absolute for production
  const BACKEND_URL = isLocal ? 'http://localhost:5000' : BACKEND_PROD_URL.replace(/\/$/, '');
  const API_ENDPOINT = `${BACKEND_URL}/api/verify`;

  console.log(`[AI SERVICE] Initiating verification via: ${API_ENDPOINT}`);

  try {
    const controller = new AbortController();
    // Render free tier can take up to 60s to wake up from cold start
    const timeoutId = setTimeout(() => controller.abort(), 60000); 

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      mode: 'cors', // Explicitly set cors mode
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ image: base64Image }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("RATE_LIMIT: AI link throttled. Please wait 60 seconds.");
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `SERVER_ERROR: Status ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error("[AI SERVICE] Fatal connection error:", error);
    
    if (error.name === 'AbortError') {
      throw new Error("WAKEUP_TIMEOUT: HQ Server cold start in progress. Try again in 10 seconds.");
    }
    
    if (error.message.includes('Failed to fetch')) {
      throw new Error(`UPLINK_FAILURE: Connection to ${BACKEND_PROD_URL} blocked or unreachable. Ensure you have an active internet connection and the server is deployed.`);
    }

    throw new Error(error.message || "UPLINK_CRITICAL: Data transmission interrupted.");
  }
};
