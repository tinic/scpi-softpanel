import type { WebSocket } from 'ws'
import { ClientMessageSchema, type ClientMessage, type ServerMessage } from '@scpi/shared'

/**
 * Tracks connected browser sockets, validates inbound control messages against the
 * shared zod schema, and fans out server messages. Each new client is greeted with
 * a snapshot so it renders current state immediately without waiting for a poll.
 */
export class WsHub {
  private readonly clients = new Set<WebSocket>()

  constructor(
    private readonly snapshot: () => ServerMessage,
    private readonly onMessage: (msg: ClientMessage) => Promise<void> | void,
    private readonly onError: (message: string) => void,
  ) {}

  add(ws: WebSocket): void {
    this.clients.add(ws)
    this.sendTo(ws, this.snapshot())
    ws.on('message', (data: unknown) => void this.handle(ws, data))
    ws.on('close', () => this.clients.delete(ws))
    ws.on('error', () => this.clients.delete(ws))
  }

  get clientCount(): number {
    return this.clients.size
  }

  broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg)
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(data)
    }
  }

  private async handle(ws: WebSocket, data: unknown): Promise<void> {
    let parsed: ClientMessage
    try {
      parsed = ClientMessageSchema.parse(JSON.parse(String(data)))
    } catch (err) {
      this.sendTo(ws, { type: 'error', message: `invalid message: ${errMessage(err)}` })
      return
    }
    try {
      await this.onMessage(parsed)
    } catch (err) {
      const message = errMessage(err)
      this.onError(message)
      this.sendTo(ws, { type: 'error', message })
    }
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
