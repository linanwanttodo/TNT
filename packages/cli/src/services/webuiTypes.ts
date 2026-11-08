import type http from "http";

import type { Session } from "core/index.js";

export interface WebUiServiceOptions {
  /** Port to try first; occupied ports are probed upwards. */
  port?: number;
  /**
   * The session `/api/server-info` reports. Defaults to the process's current
   * session.
   */
  getSession?: () => Session;
  /**
   * Where the built frontend lives. Defaults to the copy inside this package;
   * TNT_WEBUI_DIST overrides it the same way.
   */
  distDir?: string;
  /** Test seam: how many ports may be probed before giving up. */
  maxAttempts?: number;
  /**
   * Long-lived mode (`tnt webui`): reuse the token stored under globalDir so
   * a restart keeps serving the same URL. Defaults to false, where every
   * launch generates a fresh token.
   */
  persistToken?: boolean;
}

export interface WebUiHandle {
  /** The port the server actually bound, after probing. */
  port: number;
  /** The token every gated route demands, via cookie or Bearer header. */
  token: string;
  server: http.Server;
  close(): Promise<void>;
}
