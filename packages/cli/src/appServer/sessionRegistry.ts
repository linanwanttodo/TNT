export type AppServerLifecycleState = "available" | "stopping";

export interface SessionLifecycleSnapshot {
  state: AppServerLifecycleState;
  cwd: string;
}

export class SessionRegistry {
  private state: AppServerLifecycleState = "available";
  private readonly cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  getState(): SessionLifecycleSnapshot {
    return { state: this.state, cwd: this.cwd };
  }

  beginShutdown(): SessionLifecycleSnapshot {
    this.state = "stopping";
    return this.getState();
  }
}
