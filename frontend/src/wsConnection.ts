// wsConnection.ts – a lightweight singleton for the browser WebSocket API
// It provides automatic reconnect and a simple publish/subscribe model.

type MessageHandler = (msg: MessageEvent) => void

class WSConnection {
  private static instance: WSConnection | null = null
  private ws?: WebSocket
  private url: string = ''
  private handlers: Set<MessageHandler> = new Set()
  private reconnectDelay = 2000 // ms

  private constructor() {}

  static getInstance(): WSConnection {
    if (!WSConnection.instance) {
      WSConnection.instance = new WSConnection()
    }
    return WSConnection.instance
  }

  connect(url: string = 'ws://localhost:8080') {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return // already connected
    this.url = url
    this.ws = new WebSocket(url)

    this.ws.onopen = () => console.log('WS connected')
    this.ws.onclose = ev => {
      console.warn('WS closed, reconnecting...', ev)
      setTimeout(() => this.connect(this.url), this.reconnectDelay)
    }
    this.ws.onerror = err => console.error('WS error', err)
    this.ws.onmessage = ev => this.handlers.forEach(h => h(ev))
  }

  send(data: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data)
    } else {
      console.warn('WS not open – drop message')
    }
  }

  addMessageListener(handler: MessageHandler) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  close() {
    this.ws?.close()
    this.ws = undefined
  }
}

export default WSConnection.getInstance()
