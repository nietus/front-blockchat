// frontend/src/services/P2PService.ts
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

class P2PService {
  private static instance: P2PService;
  private p2pProcess: ChildProcess | null = null;
  private isRunning: boolean = false;
  private onConnectCallbacks: (() => void)[] = [];

  private constructor() {
    // Private constructor to enforce singleton
  }

  public static getInstance(): P2PService {
    if (!P2PService.instance) {
      P2PService.instance = new P2PService();
    }
    return P2PService.instance;
  }

  public async startP2PConnection(): Promise<boolean> {
    if (this.isRunning) {
      console.log('P2P Connection is already running');
      return true;
    }

    try {
      // Determine correct binary path based on platform and environment
      const isElectron = window.navigator.userAgent.toLowerCase().includes('electron');
      let p2pBinaryPath: string;
      let args: string[] = [];
      
      if (isElectron) {
        // In Electron, the binary is started by the main process
        console.log('Running in Electron - P2P Connection should be started by main process');
        this.isRunning = true;
        this.notifyConnected();
        return true;
      } else {
        // In browser-only mode, we need to use a proxy API to start the process
        console.log('Attempting to start P2P Connection via API');
        const response = await fetch('/api/start-p2p', {
          method: 'POST',
        });
        
        if (response.ok) {
          console.log('P2P Connection started via API');
          this.isRunning = true;
          this.notifyConnected();
          return true;
        } else {
          console.error('Failed to start P2P Connection via API');
          return false;
        }
      }
    } catch (error) {
      console.error('Error starting P2P Connection:', error);
      return false;
    }
  }

  public stopP2PConnection(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.p2pProcess) {
      this.p2pProcess.kill();
      this.p2pProcess = null;
    }

    // In browser mode, call the API to stop the process
    if (!window.navigator.userAgent.toLowerCase().includes('electron')) {
      fetch('/api/stop-p2p', { method: 'POST' })
        .then(() => console.log('P2P Connection stopped via API'))
        .catch(err => console.error('Failed to stop P2P Connection via API:', err));
    }

    this.isRunning = false;
  }

  public onConnect(callback: () => void): void {
    this.onConnectCallbacks.push(callback);
    if (this.isRunning) {
      callback();
    }
  }

  private notifyConnected(): void {
    this.onConnectCallbacks.forEach(callback => callback());
  }
}

export default P2PService;