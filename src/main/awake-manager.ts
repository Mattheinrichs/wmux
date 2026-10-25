export type KeepAwakeMode = 'smart' | 'always' | 'off';

export interface KeepAwakeState {
  mode: KeepAwakeMode;
  isActive: boolean;
  preventDisplaySleep: boolean;
  blockerType: 'prevent-app-suspension' | 'prevent-display-sleep';
}

export interface PowerBlockerDriver {
  start(type: 'prevent-app-suspension' | 'prevent-display-sleep'): number;
  stop(id: number): void;
  isStarted(id: number): boolean;
}

const defaultDriver: PowerBlockerDriver = {
  start: (type) => {
    try {
      const electron = require('electron');
      return electron.powerSaveBlocker ? electron.powerSaveBlocker.start(type) : 0;
    } catch {
      return 0;
    }
  },
  stop: (id) => {
    try {
      const electron = require('electron');
      if (electron.powerSaveBlocker) electron.powerSaveBlocker.stop(id);
    } catch {
      /* ignore */
    }
  },
  isStarted: (id) => {
    try {
      const electron = require('electron');
      return electron.powerSaveBlocker ? electron.powerSaveBlocker.isStarted(id) : false;
    } catch {
      return false;
    }
  },
};

export class AwakeManager {
  private driver: PowerBlockerDriver;
  private mode: KeepAwakeMode = 'smart';
  private preventDisplaySleep = false;
  private activeBlockerId: number | null = null;
  private workingAgentsCount = 0;
  private listeners = new Set<(state: KeepAwakeState) => void>();

  constructor(driver?: PowerBlockerDriver, initialMode: KeepAwakeMode = 'smart', initialPreventDisplay = false) {
    this.driver = driver ?? defaultDriver;
    this.mode = initialMode;
    this.preventDisplaySleep = initialPreventDisplay;
  }

  public getState(): KeepAwakeState {
    return {
      mode: this.mode,
      isActive: this.activeBlockerId !== null,
      preventDisplaySleep: this.preventDisplaySleep,
      blockerType: this.targetBlockerType(),
    };
  }

  public setMode(mode: KeepAwakeMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.evaluate();
  }

  public setPreventDisplaySleep(prevent: boolean): void {
    if (this.preventDisplaySleep === prevent) return;
    this.preventDisplaySleep = prevent;
    // If currently active, we must restart the blocker with the new type
    if (this.activeBlockerId !== null) {
      this.release();
      this.acquire();
    } else {
      this.notify();
    }
  }

  public onWorkingAgentsCountChanged(workingCount: number): void {
    this.workingAgentsCount = Math.max(0, workingCount);
    this.evaluate();
  }

  public onStateChange(listener: (state: KeepAwakeState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public dispose(): void {
    this.release();
    this.listeners.clear();
  }

  private targetBlockerType(): 'prevent-app-suspension' | 'prevent-display-sleep' {
    return this.preventDisplaySleep ? 'prevent-display-sleep' : 'prevent-app-suspension';
  }

  private evaluate(): void {
    const shouldBeActive = this.mode === 'always' || (this.mode === 'smart' && this.workingAgentsCount > 0);

    if (shouldBeActive && this.activeBlockerId === null) {
      this.acquire();
    } else if (!shouldBeActive && this.activeBlockerId !== null) {
      this.release();
    } else {
      this.notify();
    }
  }

  private acquire(): void {
    const type = this.targetBlockerType();
    this.activeBlockerId = this.driver.start(type);
    this.notify();
  }

  private release(): void {
    if (this.activeBlockerId !== null) {
      this.driver.stop(this.activeBlockerId);
      this.activeBlockerId = null;
      this.notify();
    }
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        /* listener error shouldn't crash caller */
      }
    }
  }
}
