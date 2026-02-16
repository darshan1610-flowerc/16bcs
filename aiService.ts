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
 * Communicates with the BCS backend for AI-based image verification.
 */
export const verifyAttendanceImage = async (base64Image: string): Promise<VerificationResult> => {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  
  // Ensure the URL is clean and absolute for production
  const BACKEND_URL = isLocal ? '' : BACKEND_PROD_URL.replace(/\/$/, '');
  const API_ENDPOINT = `${BACKEND_URL}/api/verify`;

  console.log(`[AI SERVICE] Initiating verification via: ${API_ENDPOINT}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout for cold starts

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
      throw new Error("WAKEUP_TIMEOUT: The HQ Server is taking too long to wake up. Please try again in 30 seconds.");
    }
    
    if (error.message.includes('Failed to fetch')) {
      throw new Error(`UPLINK_FAILURE: Cannot reach HQ Server at ${BACKEND_PROD_URL}. Check if the Render URL is correct in syncService.ts and if the server is active.`);
    }

    throw new Error(error.message || "UPLINK_CRITICAL: Data transmission interrupted.");
  }
};
