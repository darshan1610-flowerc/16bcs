
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
  const BACKEND_URL = window.location.hostname === 'localhost' 
      ? '' 
      : BACKEND_PROD_URL;
  
  const API_ENDPOINT = `${BACKEND_URL}/api/verify`;

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: base64Image }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Rate limit reached. Please wait 60 seconds.");
      }
      throw new Error(`Server returned error status: ${response.status}`);
    }

    const data: VerificationResult = await response.json();
    return data;
  } catch (error: any) {
    console.error("API Verification Error:", error);
    throw new Error(error.message || "Failed to establish secure link with HQ server.");
  }
};
