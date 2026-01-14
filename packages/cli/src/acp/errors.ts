import { RequestError } from "@agentclientprotocol/sdk";

export function invalidParams(message: string): RequestError {
  return new RequestError(-32602, message);
}

export function internalError(message: string): RequestError {
  return new RequestError(-32603, message);
}

export function sessionNotFound(sessionId: string): RequestError {
  return new RequestError(-32602, `Session ${sessionId} was not found`);
}
