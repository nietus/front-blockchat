// Environment-based configuration
export const config = {
  // API URLs
  blockchain: {
    // Use Railway deployed URLs in production, local URLs in development
    baseUrl: process.env.NODE_ENV === 'production' 
      ? 'https://blockchain-blockchat.onrender.com/node0'
      : 'http://localhost:8003',
    chainEndpoint: '/chain',
    newTransactionEndpoint: '/new_transaction',
    mineEndpoint: '/mine'
  },
  // WebSocket configuration
  websocket: {
    url: process.env.NODE_ENV === 'production'
      ? 'wss://blockchain-blockchat.onrender.com/node0/ws'
      : `ws://localhost:8081`
  },
  // Relay server configuration
  relayServer: {
    url: 'https://relayserver-7mrprq-production.up.railway.app/store'
  }
}; 