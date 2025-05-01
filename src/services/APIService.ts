// frontend/src/services/ApiService.ts
class ApiService {
  private static instance: ApiService;
  private baseUrl: string = '';

  private constructor() {
    // Determine base URL based on environment
    this.baseUrl = window.location.origin;
  }

  public static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  public async startP2P(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/start-p2p`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) throw new Error('Failed to start P2P service');
      
      return true;
    } catch (error) {
      console.error('Error starting P2P service:', error);
      return false;
    }
  }

  public async checkP2PStatus(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/p2p-status`, {
        method: 'GET',
      });

      if (!response.ok) return false;
      
      const data = await response.json();
      return data.running;
    } catch (error) {
      console.error('Error checking P2P status:', error);
      return false;
    }
  }

  public async stopP2P(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/stop-p2p`, {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Failed to stop P2P service');
      
      return true;
    } catch (error) {
      console.error('Error stopping P2P service:', error);
      return false;
    }
  }
}

export default ApiService;
