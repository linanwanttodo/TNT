import { EventEmitter } from "events";

import { ToolCallRequest } from "./types.js";

export interface PermissionRequestResult {
  approved: boolean;
  remember?: boolean; // For future implementation - remember this decision
  /** Set when the request expired unanswered; a timeout never approves. */
  timedOut?: boolean;
}

export const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60_000;

export class ToolPermissionManager extends EventEmitter {
  private pendingRequests = new Map<
    string,
    {
      toolCall: ToolCallRequest;
      resolve: (result: PermissionRequestResult) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();

  private requestCounter = 0;

  /**
   * Request permission for a tool call. Returns a promise that resolves
   * when the user approves or rejects the request, or when the timeout
   * expires unanswered. A timeout resolves as a refusal and removes the
   * pending entry, so a surface that lost the prompt can never leave the
   * engine waiting forever.
   */
  async requestPermission(
    toolCall: ToolCallRequest,
    timeoutMs: number = DEFAULT_PERMISSION_TIMEOUT_MS,
  ): Promise<PermissionRequestResult> {
    const requestId = `tool-request-${++this.requestCounter}`;

    return new Promise<PermissionRequestResult>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      // Timeout settlement: the delete returning true proves the answer was
      // never given, so the expiry resolves the promise exactly once, racing
      // an approval or rejection through the same map entry.
      const expire = () => {
        if (this.pendingRequests.delete(requestId)) {
          resolve({ approved: false, timedOut: true });
          return true;
        }
        return false;
      };

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (expire()) {
            this.emit("permissionResponse", {
              requestId,
              approved: false,
              timedOut: true,
            });
          }
        }, timeoutMs);
      }

      this.pendingRequests.set(requestId, {
        toolCall,
        resolve,
        timer,
      });

      // Emit event for UI to handle
      this.emit("permissionRequested", {
        requestId,
        toolCall,
      });
    });
  }

  /**
   * Approve a pending permission request
   */
  approveRequest(requestId: string, remember = false): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      // Also try to emit for the new event-based system
      this.emit("permissionResponse", { requestId, approved: true });
      return false;
    }

    clearTimeout(request.timer);
    this.pendingRequests.delete(requestId);
    request.resolve({ approved: true, remember });

    // Also emit for the new event-based system
    this.emit("permissionResponse", { requestId, approved: true });
    return true;
  }

  /**
   * Reject a pending permission request
   */
  rejectRequest(requestId: string): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      // Also try to emit for the new event-based system
      this.emit("permissionResponse", { requestId, approved: false });
      return false;
    }

    clearTimeout(request.timer);
    this.pendingRequests.delete(requestId);
    request.resolve({ approved: false });

    // Also emit for the new event-based system
    this.emit("permissionResponse", { requestId, approved: false });
    return true;
  }

  /**
   * Get details of a pending request
   */
  getPendingRequest(requestId: string) {
    return this.pendingRequests.get(requestId);
  }

  /**
   * Get all pending request IDs
   */
  getPendingRequestIds(): string[] {
    return Array.from(this.pendingRequests.keys());
  }
}

// Global instance
export const toolPermissionManager = new ToolPermissionManager();
