import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  Input,
  Button,
  Text,
  VStack,
  HStack,
  Container,
  List,
  ListItem,
  useToast,
  Badge,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  useDisclosure,
  FormControl,
  FormLabel,
  Spinner,
  Tooltip,
  Divider,
  Grid,
  GridItem,
  Avatar,
  IconButton,
  Switch,
} from "@chakra-ui/react";
import Web3 from "web3";
import { AES, enc } from "crypto-js";
import { FiSend, FiChevronLeft, FiCopy } from "react-icons/fi";
import Menssage from "./menssage/Menssage";
import P2PServiceDownloader from "../components/P2PServiceDownloader";

interface Message {
  sender: string;
  content: string;
  timestamp: number;
  confirmed: boolean;
  signature?: string;
  encrypted?: boolean;
  broadcast?: boolean;
  type?: string;
  target?: string;
  decrypted?: boolean;
  encryptedSymmetricKey?: string;
  encryptedContent?: string;
  saveToBlockchain?: boolean;
  p2pOnly?: boolean; // New field to identify P2P-only messages
  senderUsername?: string; // New field to store the username of the sender
}

interface Conversation {
  peerAddress: string;
  messages: Message[];
  unreadCount: number;
}

// Make all ports configurable
const DEFAULT_WS_PORT = 8081;
const DEFAULT_P2P_PORT = 8082;

// For TypeScript compliance with window.ethereum
declare global {
  interface Window {
    ethereum: {
      request: (args: {
        method: string;
        params?: any[] | undefined;
      }) => Promise<any>;
      on: (event: string, callback: (...args: any[]) => void) => void;
      removeListener: (
        event: string,
        callback: (...args: any[]) => void
      ) => void;
      isMetaMask?: boolean | undefined;
    };
  }
}

// Add constants for localStorage keys
const STORAGE_KEYS = {
  USERNAME: "blockchat_username",
  ETH_ADDRESS: "blockchat_eth_address",
  WS_PORT: "blockchat_ws_port",
  P2P_PORT: "blockchat_p2p_port",
  ACTIVE_PEER: "blockchat_active_peer",
  PUBLIC_IP: "blockchat_public_ip", // Add new key for public IP
  SAVE_TO_BLOCKCHAIN: "blockchat_save_to_blockchain", // Add new key for saveToBlockchain setting
  PEER_USERNAMES: "blockchat_peer_usernames", // Add new key for peer usernames
};

// Add this new helper function near the getPublicIpAddress function
const formatAddressForConnection = (address: string, port: number): string => {
  // Check if this is an IPv6 address (contains :)
  if (address.includes(":")) {
    // IPv6 addresses in URLs need to be wrapped in square brackets
    return `[${address}]:${port}`;
  }
  // Regular IPv4 address
  return `${address}:${port}`;
};

// Modify the getPublicIpAddress function to be more robust
const getPublicIpAddress = async (): Promise<string> => {
  try {
    // Try with ipify service first
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();
    console.log("Retrieved public IP:", data.ip);

    // Store IP in localStorage for future use
    localStorage.setItem(STORAGE_KEYS.PUBLIC_IP, data.ip);
    return data.ip;
  } catch (error) {
    console.error("Error getting public IP from ipify:", error);

    // Try with ipinfo as a backup
    try {
      const backupResponse = await fetch("https://ipinfo.io/json");
      const backupData = await backupResponse.json();
      if (backupData.ip) {
        console.log("Retrieved public IP from backup service:", backupData.ip);
        localStorage.setItem(STORAGE_KEYS.PUBLIC_IP, backupData.ip);
        return backupData.ip;
      }
    } catch (backupError) {
      console.error(
        "Error getting public IP from backup service:",
        backupError
      );
    }

    // Fallback to any stored IP from previous sessions
    const storedIp = localStorage.getItem(STORAGE_KEYS.PUBLIC_IP);
    if (storedIp) {
      console.log("Using stored public IP:", storedIp);
      return storedIp;
    }

    // Return a placeholder if we can't get the IP
    console.warn("Returning default IPv4 address as fallback");
    return "0.0.0.0";
  }
};

// Add this outside any function to track the global WebSocket connection
const globalWebSocketRef: { current: WebSocket | null } = { current: null };

const Chat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [username, setUsername] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.USERNAME) || "";
  });
  const [ethAddress, setEthAddress] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.ETH_ADDRESS) || "";
  });
  const [connected, setConnected] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState<number>(0);
  const [currentPeers, setCurrentPeers] = useState<string[]>([]);
  const [connectTarget, setConnectTarget] = useState("");
  const [wsPort, setWsPort] = useState(() => {
    const savedPort = localStorage.getItem(STORAGE_KEYS.WS_PORT);
    return savedPort ? parseInt(savedPort) : DEFAULT_WS_PORT;
  });
  const [p2pPort, setP2pPort] = useState(() => {
    const savedPort = localStorage.getItem(STORAGE_KEYS.P2P_PORT);
    return savedPort ? parseInt(savedPort) : DEFAULT_P2P_PORT;
  });
  const [myP2pAddress, setMyP2pAddress] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedPeers, setConnectedPeers] = useState<Set<string>>(new Set());
  const [actuallyConnectedPeers, setActuallyConnectedPeers] = useState<
    string[]
  >([]);
  const [conversations, setConversations] = useState<
    Record<string, Conversation>
  >({});
  const [activePeer, setActivePeer] = useState<string | null>(null);
  const [lastFetchTimestamp, setLastFetchTimestamp] = useState<number>(0);

  // History view state
  const [viewingHistory, setViewingHistory] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<
    string | null
  >(null);
  const [showConversations, setShowConversations] = useState(true);

  // Add this new state to track when last messages were received
  const [lastMessageTimestamp, setLastMessageTimestamp] = useState<number>(0);

  // Adicione este estado para armazenar a preferência do usuário
  const [saveToBlockchain, setSaveToBlockchain] = useState(true);

  // We'll use this to control the WebSocket's initialization
  const [wsInitialized, setWsInitialized] = useState<boolean>(false);

  const toast = useToast();
  const reconnectTimeoutRef = useRef<number | undefined>();
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const {
    isOpen: isSettingsOpen,
    onOpen: onOpenSettings,
    onClose: onCloseSettings,
  } = useDisclosure();

  // Add these tracking variables for decryption failures
  const [decryptionFailures, setDecryptionFailures] = useState<
    Record<string, number>
  >({});
  const decryptionNotificationTimeoutRef = useRef<number | undefined>();

  // Add a dedicated state variable to track P2P refresh interval
  const [p2pRefreshTimer, setP2pRefreshTimer] = useState<NodeJS.Timeout | null>(
    null
  );

  // Add this flag at the component level, outside any functions
  const [isWebSocketStable, setIsWebSocketStable] = useState<boolean>(false);
  const lastConnectionTimestamp = useRef<number>(0);

  const web3Ref = useRef<Web3 | null>(null);

  const [loginButtonConnecting, setLoginButtonConnecting] = useState(false); // New state for login button only

  // Add tracking for previously shown system messages to prevent duplicates
  const [lastSystemMessage, setLastSystemMessage] = useState("");
  const [lastSystemMessageTime, setLastSystemMessageTime] = useState(0);

  // Add a state to store peer usernames
  const [peerUsernames, setPeerUsernames] = useState<Record<string, string>>(
    () => {
      const saved = localStorage.getItem(STORAGE_KEYS.PEER_USERNAMES);
      return saved ? JSON.parse(saved) : {};
    }
  );

  // Save values to localStorage when they change
  useEffect(() => {
    if (username) {
      localStorage.setItem(STORAGE_KEYS.USERNAME, username);
    }
  }, [username]);

  useEffect(() => {
    if (ethAddress) {
      localStorage.setItem(STORAGE_KEYS.ETH_ADDRESS, ethAddress);
    }
  }, [ethAddress]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WS_PORT, wsPort.toString());
  }, [wsPort]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.P2P_PORT, p2pPort.toString());
  }, [p2pPort]);

  useEffect(() => {
    if (activePeer) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_PEER, activePeer);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_PEER);
    }
  }, [activePeer]);

  // Add auto-reconnect on page load if we have saved credentials
  useEffect(() => {
    // Only attempt auto-reconnect if the user has already logged in
    // and we have both ethereum address and username
    if (ethAddress && username) {
      console.log("Found saved credentials, attempting auto-reconnect...");
      // Short delay to ensure the UI is fully loaded
      const reconnectTimeout = setTimeout(() => {
        // When auto-reconnecting, don't show the connecting indicator
        connectWallet(true); // Pass true to indicate this is an auto-reconnect
      }, 1000);

      return () => clearTimeout(reconnectTimeout);
    }
  }, [ethAddress, username]);

  // Add a stable message ID generator to uniquely identify messages
  const getMessageId = (msg: Message): string => {
    return `${msg.signature || ""}_${msg.sender}_${
      msg.timestamp
    }_${msg.content.substring(0, 10)}`;
  };

  // Create a more reliable message comparison function
  const areMessagesEqual = (
    messagesA: Message[],
    messagesB: Message[]
  ): boolean => {
    if (messagesA.length !== messagesB.length) {
      return false;
    }

    // Create message ID maps for easier comparison
    const mapA = new Map(messagesA.map((msg) => [getMessageId(msg), msg]));
    const mapB = new Map(messagesB.map((msg) => [getMessageId(msg), msg]));

    // Check if all message IDs in A exist in B
    for (const id of mapA.keys()) {
      if (!mapB.has(id)) {
        return false;
      }
    }

    // Check if all messages in B exist in A
    for (const id of mapB.keys()) {
      if (!mapA.has(id)) {
        return false;
      }
    }

    return true;
  };

  // Update setMessages to only change state if content actually changed
  const updateMessagesIfChanged = (newMessages: Message[]) => {
    setMessages((currentMessages) => {
      // If the arrays are identical by reference, no need to update
      if (currentMessages === newMessages) return currentMessages;

      // If messages are equivalent, keep the current state to prevent re-renders
      if (areMessagesEqual(currentMessages, newMessages)) {
        return currentMessages;
      }

      console.log("Messages have changed, updating state");
      return newMessages; // Only update if there's a real change
    });
  };

  // Add a new function to fetch messages from the blockchain (add this before the useEffect)
  const fetchBlockchainMessages = async (forceRefresh = false) => {
    try {
      // Only fetch if connected to wallet
      if (!ethAddress) {
        console.log("Not fetching messages: No wallet connected");
        return [];
      }

      // Throttle requests to prevent spamming - only fetch if it's been 2 seconds since last fetch
      // unless forceRefresh is true
      const now = Date.now();
      if (!forceRefresh && now - lastFetchTimestamp < 2000) {
        console.log(
          "Throttling blockchain request, last fetch was less than 2 seconds ago"
        );
        return [];
      }

      // Update the last fetch timestamp
      setLastFetchTimestamp(now);

      console.log("Fetching messages from blockchain...");

      // Fetch the blockchain data
      const response = await fetch(
        "https://blockchain-bc-production.up.railway.app/node0/chain"
      );

      if (response.status === 200) {
        const chainData = await response.json();
        console.log("Blockchain data received:", chainData);

        // Track any newly decrypted messages to update UI after processing
        let hasNewDecryptedMessages = false;
        let wasActiveConversationUpdated = false;

        // Clear any pending decryption notifications when loading new messages
        if (decryptionNotificationTimeoutRef.current) {
          clearTimeout(decryptionNotificationTimeoutRef.current);
          decryptionNotificationTimeoutRef.current = undefined;
        }
        setDecryptionFailures({});

        // Process all messages from all blocks
        const allMessages: Message[] = [];
        let historicalPeers = new Set<string>();
        let encryptedMessageCount = 0;

        if (chainData.chain) {
          // Process each block in the chain
          for (const block of chainData.chain) {
            if (block.transactions) {
              // Process each transaction (message) in the block
              for (const tx of block.transactions) {
                if (tx.author && tx.content) {
                  // Special handling for own messages
                  let messageContent = tx.content;
                  let decrypted = false;
                  let encryptedContent = undefined;

                  // For messages sent by yourself
                  if (tx.encrypted && tx.author === ethAddress) {
                    try {
                      // Try to decrypt your own messages
                      const decryptedContent = await decryptMessage(
                        tx.content,
                        tx.encryptedSymmetricKey,
                        tx.author
                      );

                      if (decryptedContent) {
                        encryptedContent = tx.content; // Save the encrypted version
                        messageContent = decryptedContent; // Use decrypted content for display
                        decrypted = true;
                        hasNewDecryptedMessages = true;
                        if (activePeer && tx.target === activePeer) {
                          wasActiveConversationUpdated = true;
                        }
                      }
                    } catch (error) {
                      console.error("Failed to decrypt own message:", error);
                      // Fall back to showing encrypted content
                    }
                  }
                  // For messages from others
                  else if (tx.encrypted && tx.author !== ethAddress) {
                    try {
                      const decryptedContent = await decryptMessage(
                        tx.content,
                        tx.encryptedSymmetricKey,
                        tx.author
                      );

                      if (decryptedContent) {
                        encryptedContent = tx.content;
                        messageContent = decryptedContent;
                        decrypted = true;
                        hasNewDecryptedMessages = true;
                        if (activePeer && tx.author === activePeer) {
                          wasActiveConversationUpdated = true;
                        }
                      }
                    } catch (error) {
                      console.error(
                        "Failed to decrypt message from other user:",
                        error
                      );
                    }
                  }

                  // Normalize timestamp - ensure it's in milliseconds
                  let normalizedTimestamp = tx.timestamp;

                  // If timestamp is in seconds (less than year 2000), convert to milliseconds
                  if (normalizedTimestamp && normalizedTimestamp < 2000000000) {
                    normalizedTimestamp = normalizedTimestamp * 1000;
                  }

                  // If timestamp is missing or invalid, use current time
                  if (!normalizedTimestamp || isNaN(normalizedTimestamp)) {
                    normalizedTimestamp = Date.now();
                  }

                  // Extract and store username if it exists
                  if (tx.senderUsername && tx.author !== ethAddress) {
                    updatePeerUsername(tx.author, tx.senderUsername);
                  }

                  // Create a message object from the transaction
                  const message: Message = {
                    sender: tx.author,
                    content: messageContent, // Use decrypted content if available
                    timestamp: normalizedTimestamp, // Use normalized timestamp
                    confirmed: true,
                    signature: tx.signature || undefined,
                    encrypted: tx.encrypted || false,
                    encryptedSymmetricKey:
                      tx.encryptedSymmetricKey || undefined,
                    encryptedContent: encryptedContent, // Store encrypted version
                    decrypted: decrypted, // Mark as decrypted if successfully decrypted
                    target: tx.target || undefined, // Store target info if available
                    senderUsername: tx.senderUsername, // Store the username
                  };

                  // Track encrypted messages to show one summary notification
                  if (message.encrypted && !message.decrypted) {
                    encryptedMessageCount++;
                  }

                  allMessages.push(message);

                  // Add to peers list if it's not the current user
                  if (tx.author !== ethAddress) {
                    historicalPeers.add(tx.author);
                  }
                }
              }
            }
          }
        }

        // Filter out invalid peer addresses before creating conversations
        const validHistoricalPeers = Array.from(historicalPeers).filter(
          (peer) => peer && peer.startsWith("0x") && peer.length === 42
        );

        // Sort all messages by timestamp
        allMessages.sort((a, b) => a.timestamp - b.timestamp);

        // Build conversations from blockchain data
        const newConversations: Record<string, Conversation> = {};

        // Group messages by peer (using only valid peers)
        validHistoricalPeers.forEach((peerAddress) => {
          // Get all messages between this peer and the current user
          const peerMessages = allMessages.filter(
            (msg) =>
              (msg.sender === peerAddress &&
                (msg.target === ethAddress || !msg.target)) ||
              (msg.sender === ethAddress && msg.target === peerAddress)
          );

          newConversations[peerAddress] = {
            peerAddress,
            messages: peerMessages,
            unreadCount: 0,
          };
        });

        // Preserve unread counts from existing conversations
        const preserveUnreadCounts = (
          oldConvs: Record<string, Conversation>,
          newConvs: Record<string, Conversation>
        ) => {
          const result = { ...newConvs };
          Object.keys(result).forEach((peerAddress) => {
            if (oldConvs[peerAddress]) {
              result[peerAddress].unreadCount =
                oldConvs[peerAddress].unreadCount;
            }
          });
          return result;
        };

        // Update conversations with blockchain data
        setConversations((prevConversations) => {
          // Create a merged conversations object with preserved unread counts
          const merged = preserveUnreadCounts(
            prevConversations,
            newConversations
          );
          return merged;
        });

        // Update connected peers
        setConnectedPeers(new Set(validHistoricalPeers));

        // IMPORTANT: Always update current messages view if we have an active peer, but only if there were changes
        if (activePeer && newConversations[activePeer]) {
          // Check if the active conversation's messages have actually changed
          const newActiveMessages = [...newConversations[activePeer].messages];

          // First check if we already have these exact messages
          const currentActiveConversation =
            conversations[activePeer]?.messages || [];

          // Only update messages if they've actually changed
          if (!areMessagesEqual(currentActiveConversation, newActiveMessages)) {
            console.log(
              `Updating active messages for peer ${activePeer} - messages changed`
            );
            updateMessagesIfChanged(newActiveMessages);
          } else {
            console.log(
              `Skipping update for peer ${activePeer} - no message changes`
            );
          }
        }

        console.log(
          `Loaded ${validHistoricalPeers.length} peer conversations from blockchain`
        );
        return validHistoricalPeers;
      }
    } catch (error) {
      console.error("Error fetching blockchain messages:", error);
      return [];
    }
  };

  // 1. Separate the relay server connection
  const connectToRelayServer = async (address: string, port: number) => {
    try {
      // If address is empty, try to get it from localStorage directly
      let finalAddress = address;
      if (!finalAddress || finalAddress === "") {
        finalAddress = localStorage.getItem(STORAGE_KEYS.ETH_ADDRESS) || "";
        console.log("Retrieved address from localStorage:", finalAddress);

        if (!finalAddress) {
          console.error(
            "Cannot register with relay server: No Ethereum address available"
          );
          return false;
        }
      }

      // First get the public IP address
      const publicIp = await getPublicIpAddress();
      const formattedAddress = formatAddressForConnection(publicIp, port);

      console.log(
        `Registering address ${finalAddress} with relay server using P2P port ${port} and IP ${publicIp} (formatted: ${formattedAddress})...`
      );
      const response = await fetch(
        "https://relay-server-nzhu.onrender.com/store",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sender_id: finalAddress,
            p2p_addr: formattedAddress,
          }),
        }
      );

      const responseText = await response.text();
      console.log(
        `Relay server response: ${response.status} - ${responseText}`
      );

      if (response.ok) {
        console.log(
          `Successfully registered with relay server using IP ${publicIp} and port ${port}`
        );
        // Display a success message
        toast({
          title: "Connected to Relay Server",
          status: "success",
          duration: 3000,
          isClosable: true,
          position: "bottom-left",
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error connecting to relay server:", error);
      return false;
    }
  };

  // Update the initiateWebSocketConnection function to use the global reference
  const initiateWebSocketConnection = useCallback(() => {
    // If we already have an initialized connection, don't create a new one
    if (
      globalWebSocketRef.current &&
      globalWebSocketRef.current.readyState === WebSocket.OPEN
    ) {
      console.log("WebSocket already connected, reusing existing connection");
      setConnected(true);
      setIsConnecting(false);
      return;
    }

    // If there's a pending connection, don't create a new one
    if (isConnecting) {
      console.log("Connection already in progress, ignoring duplicate request");
      return;
    }

    // Update UI state
    setIsConnecting(true);

    // Check if we have an existing connection that's not closed
    if (
      globalWebSocketRef.current &&
      globalWebSocketRef.current.readyState !== WebSocket.CLOSED
    ) {
      console.log("Closing existing WebSocket before creating a new one");
      // Mark the old websocket to prevent any race conditions with handlers
      const oldWs = globalWebSocketRef.current;
      globalWebSocketRef.current = null;
      oldWs.onclose = null; // Remove handlers to prevent cascading effects
      oldWs.onerror = null;
      oldWs.onmessage = null;
      oldWs.onopen = null;
      oldWs.close();
    }

    try {
      console.log(
        `Creating new WebSocket connection to ws://localhost:${wsPort}`
      );
      const ws = new WebSocket(`ws://localhost:${wsPort}`);
      globalWebSocketRef.current = ws;

      // Define handlers
      ws.onopen = async () => {
        console.log("WebSocket connection established");
        setConnected(true);
        setIsConnecting(false);
        setConnectionAttempts(0);

        // Register the connection with the backend
        let addressToRegister = ethAddress;
        if (!addressToRegister) {
          addressToRegister =
            localStorage.getItem(STORAGE_KEYS.ETH_ADDRESS) || "";
        }

        // Only proceed if we have a valid address
        if (
          addressToRegister &&
          addressToRegister.startsWith("0x") &&
          addressToRegister.length === 42
        ) {
          // Register with the P2P network
          const registerMessage = {
            type: "p2p_register",
            eth_address: addressToRegister,
          };
          console.log("Registering with P2P network:", registerMessage);
          ws.send(JSON.stringify(registerMessage));

          // Set initial mode with delay
          setTimeout(() => {
            // Only send if still connected
            if (ws.readyState === WebSocket.OPEN) {
              const initialModeMessage = {
                type: "toggle_blockchain_mode",
                value: saveToBlockchain,
                sender: addressToRegister,
                content: `Setting initial mode to ${
                  saveToBlockchain ? "blockchain" : "P2P-only"
                } mode`,
                timestamp: Date.now(),
              };
              console.log(
                "Setting initial blockchain mode:",
                initialModeMessage
              );
              ws.send(JSON.stringify(initialModeMessage));

              // If in P2P-only mode, request NAT port with further delay
              if (!saveToBlockchain) {
                setTimeout(() => {
                  if (ws.readyState === WebSocket.OPEN) {
                    const natModeMessage = {
                      type: "p2p_use_nat_port",
                      sender: addressToRegister,
                      target: addressToRegister,
                      nat_address: "",
                      content:
                        "Request to use NAT-negotiated port for initial P2P-only mode",
                      timestamp: Date.now(),
                    };
                    console.log("Requesting NAT port usage:", natModeMessage);
                    ws.send(JSON.stringify(natModeMessage));
                  }
                }, 1500);
              }

              // Request initial messages
              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  forceRefreshMessages(true);
                }
              }, 2500);
            }
          }, 1000);
        } else {
          console.error(
            "Cannot register: Invalid ETH address:",
            addressToRegister
          );
          toast({
            title: "Connection Error",
            status: "error",
            duration: 3000,
            isClosable: true,
            position: "bottom-left",
          });
        }

        // Mark as initialized to prevent unnecessary reconnections
        setWsInitialized(true);
      };

      ws.onclose = (e) => {
        console.log(`WebSocket closed: ${e.code} ${e.reason}`);

        // Only update UI if this is still the current websocket
        if (ws === globalWebSocketRef.current) {
          setConnected(false);
          setIsConnecting(false);
          setWsInitialized(false);

          // Only auto-reconnect if we haven't tried too many times
          if (connectionAttempts < 3) {
            const backoffTime = Math.min(
              5000 * Math.pow(2, connectionAttempts),
              30000
            );
            console.log(
              `Will try to reconnect in ${
                backoffTime / 1000
              } seconds (attempt ${connectionAttempts + 1}/3)`
            );

            setTimeout(() => {
              if (!connected && !isConnecting) {
                initiateWebSocketConnection();
              }
            }, backoffTime);
          } else {
            console.log(
              "Maximum reconnection attempts reached. Please reconnect manually."
            );
            toast({
              title: "Connection Lost",
              status: "error",
              duration: 5000,
              isClosable: true,
              position: "bottom-left",
            });
          }
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        // Don't do anything here, the onclose handler will be called
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("WebSocket message received:", data);

          // Handle specific message types
          if (
            data.type === "message" &&
            data.sender !== ethAddress &&
            data.target === ethAddress
          ) {
            await processPeerMessage(data);
          } else if (data.type === "system" && data.content) {
            // Process with our dedicated handler
            processSystemMessage(data.content);

            // Check for NAT port binding information in system messages
            const peerFoundRegex =
              /Peer (0x[a-fA-F0-9]{40})\s+found Peer ([^:]+):(\d+)/;
            const match = peerFoundRegex.exec(data.content || "");
            if (match && match.length >= 4) {
              const foundEthAddress = match[1];
              const foundIp = match[2];
              const foundPort = match[3];

              // Store this mapping in localStorage for resilience across page reloads
              if (foundEthAddress && foundIp && foundPort) {
                const natPortKey = `nat_port_${foundEthAddress}`;
                const natAddress = `${foundIp}:${foundPort}`;
                localStorage.setItem(natPortKey, natAddress);
                console.log(
                  `Stored NAT port mapping: ${foundEthAddress} -> ${natAddress}`
                );
              }
            }
          } else if (data.type === "refresh_request") {
            console.log("Received refresh request, fetching messages");
            forceRefreshMessages(false);
          } else if (
            data.type === "p2p_refresh_request" &&
            data.target === ethAddress
          ) {
            console.log("Received P2P-specific refresh request");
            refreshP2PMessages();
          } else if (data.type === "nat_address_updated" && data.nat_address) {
            // Handle NAT address updates explicitly
            console.log(`NAT address updated: ${data.nat_address}`);
            localStorage.setItem("nat_address", data.nat_address);

            // No need to update UI state for NAT address as it's handled internally
          } else if (
            data.type === "toggle_blockchain_mode" &&
            data.sender !== ethAddress
          ) {
            // Update our local mode if someone else toggled it (coordination)
            const newMode = data.value === true;
            console.log(
              `Received mode toggle from ${data.sender}: ${
                newMode ? "blockchain" : "P2P-only"
              }`
            );
            setSaveToBlockchain(newMode);
            localStorage.setItem(
              STORAGE_KEYS.SAVE_TO_BLOCKCHAIN,
              newMode.toString()
            );
          } else if (
            data.type === "connect_peer" &&
            data.target === ethAddress
          ) {
            // Someone is trying to connect to us, let's connect back
            const senderAddress = data.sender;
            if (
              senderAddress &&
              senderAddress !== ethAddress &&
              senderAddress.startsWith("0x") &&
              senderAddress.length === 42
            ) {
              console.log(
                `Received connection request from ${senderAddress}, connecting back`
              );
              // Initiate connection if not already connected
              if (!actuallyConnectedPeers.includes(senderAddress)) {
                connectToPeer(senderAddress);
              }
            }
          } else if (
            data.type === "message" &&
            data.p2pOnly === true &&
            ((data.sender === ethAddress && data.target) ||
              (data.target === ethAddress && data.sender))
          ) {
            // Handle P2P-only messages specifically for better reliability
            console.log("Processing a P2P-only message:", data);
            await processPeerMessage(data);
          }
        } catch (e) {
          console.log("Non-JSON message:", event.data);
        }
      };
    } catch (error) {
      console.error("Error creating WebSocket:", error);
      setConnected(false);
      setIsConnecting(false);

      // Schedule reconnect with backoff
      const backoffTime = Math.min(
        5000 * Math.pow(1.5, connectionAttempts),
        30000
      );
      setTimeout(() => {
        initiateWebSocketConnection();
      }, backoffTime);
    }
  }, [
    wsPort,
    ethAddress,
    saveToBlockchain,
    isConnecting,
    connected,
    connectionAttempts,
  ]);

  // Replace connectWebSocket with the new function
  const connectWebSocket = initiateWebSocketConnection;

  // Modify the useEffect hook
  useEffect(() => {
    // Only initialize the WebSocket if it hasn't been initialized yet
    if (!wsInitialized) {
      initiateWebSocketConnection();
    }

    // Set up a SINGLE refresh interval
    const refreshInterval = setInterval(() => {
      if (connected) {
        console.log("Running periodic refresh");
        if (saveToBlockchain) {
          forceRefreshMessages();
        } else {
          refreshP2PMessages();
        }
      }
    }, 15000);

    // Clean up on unmount
    return () => {
      clearInterval(refreshInterval);

      // Don't close the global websocket on component unmount
      // We want to keep it alive across renders
    };
  }, [wsInitialized, connected, saveToBlockchain]);

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(e.target.value);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleConnectTargetChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setConnectTarget(e.target.value);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  // Sign message with MetaMask
  const signMessage = async (message: string): Promise<string | null> => {
    if (!web3Ref.current || !ethAddress) return null;

    try {
      const messageHash = web3Ref.current.utils.keccak256(
        web3Ref.current.utils.utf8ToHex(message)
      );
      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [messageHash, ethAddress],
      });
      return signature;
    } catch (error) {
      console.error("Error signing message:", error);
      return null;
    }
  };

  // Function that combines signing and encrypting in one step to avoid multiple signature requests
  const signAndEncryptMessage = async (
    message: string,
    recipient: string
  ): Promise<{
    signature: string;
    encrypted: boolean;
    content: string;
    encryptedSymmetricKey?: string;
  } | null> => {
    if (!web3Ref.current || !ethAddress) return null;

    try {
      // First, get the signature - we'll use this for both signing and encryption
      const messageHash = web3Ref.current.utils.keccak256(
        web3Ref.current.utils.utf8ToHex(message)
      );
      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [messageHash, ethAddress],
      });

      if (!signature) {
        throw new Error("Failed to get signature");
      }

      // Use the signature itself to derive a symmetric key for encryption
      const symmetricKey = web3Ref.current.utils
        .keccak256(signature)
        .substring(0, 34);

      // Encrypt the message with the symmetric key
      const encryptedContent = AES.encrypt(message, symmetricKey).toString();

      return {
        signature: signature,
        encrypted: true,
        content: encryptedContent,
        encryptedSymmetricKey: signature, // We reuse the signature as the encryption key
      };
    } catch (error) {
      console.error("Error signing/encrypting message:", error);
      return null;
    }
  };

  // Add this function to post to blockchain
  const postToBlockchain = async (
    message: string,
    sender: string,
    encrypted: boolean = false,
    encryptedSymmetricKey?: string,
    target?: string | null
  ) => {
    try {
      console.log(
        `Posting message to blockchain at https://blockchain-bc-production.up.railway.app/node0...`
      );

      const txData = {
        author: sender, // Note: using author instead of sender as per Python script
        content: message,
        encrypted: encrypted,
        encryptedSymmetricKey: encryptedSymmetricKey,
        target: target || undefined, // Convert null to undefined if needed
        senderUsername: username, // Include the username in blockchain transactions
      };

      const response = await fetch(
        "https://blockchain-bc-production.up.railway.app/node0/new_transaction",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(txData),
        }
      );

      if (response.status === 201) {
        console.log("Transaction submitted successfully");

        // Mine the block to include the transaction
        const mineResponse = await fetch(
          "https://blockchain-bc-production.up.railway.app/node0/mine"
        );

        if (mineResponse.status === 200) {
          console.log("Block mined successfully, message saved to blockchain");
          return true;
        } else {
          console.error(`Error mining block: ${mineResponse.status}`);
          return false;
        }
      } else {
        console.error(`Error submitting transaction: ${response.status}`);
        return false;
      }
    } catch (error) {
      console.error("Error posting to blockchain:", error);
      return false;
    }
  };

  // Update the handleSend function to store both encrypted and original content for your own messages
  const handleSend = async () => {
    if (
      !input.trim() ||
      !globalWebSocketRef.current ||
      globalWebSocketRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    try {
      // Disable input while processing to prevent double-sends
      const messageContent = input.trim();
      setInput(""); // Clear input immediately

      // Use a precise millisecond timestamp that will be consistent across all messages
      const preciseTimestamp = Date.now(); // This is already in milliseconds

      // Sign the message first - await this before proceeding
      let signature;
      let contentToStore = messageContent;
      let contentToSend = messageContent;
      let encrypted = false;
      let encryptedSymmetricKey = undefined;

      // If we have an active peer, use one-step signing and encryption
      if (activePeer) {
        const result = await signAndEncryptMessage(messageContent, activePeer);

        if (!result) {
          toast({
            title: "Signature Failed",
            status: "error",
            duration: 3000,
            isClosable: true,
            position: "bottom-left",
          });
          setInput(messageContent);
          return;
        }

        signature = result.signature;
        if (result.encrypted) {
          contentToStore = result.content; // This is the encrypted content
          contentToSend = result.content; // This is the encrypted content
          encrypted = true;
          encryptedSymmetricKey = result.encryptedSymmetricKey;
        }
      } else {
        // Just get a regular signature for broadcast messages (no encryption)
        signature = await signMessage(messageContent);

        if (!signature) {
          toast({
            title: "Signature Failed",
            status: "error",
            duration: 3000,
            isClosable: true,
            position: "bottom-left",
          });
          setInput(messageContent);
          return;
        }
      }

      // Create a message object for the UI - IMPORTANT: Use original message content for display
      const newMessage: Message = {
        content: messageContent, // Use the original unencrypted content for display
        timestamp: preciseTimestamp, // Use the precise timestamp in milliseconds
        sender: ethAddress,
        signature: signature,
        confirmed: false,
        encrypted: encrypted,
        encryptedSymmetricKey: encryptedSymmetricKey,
        target: activePeer || undefined,
        encryptedContent: encrypted ? contentToStore : undefined, // Store encrypted version separately
        decrypted: encrypted, // Mark as decrypted since we're using the original content
        saveToBlockchain: saveToBlockchain, // Add the flag to indicate if it should be saved in the blockchain
        p2pOnly: !saveToBlockchain, // Mark as P2P-only if not saving to blockchain
        senderUsername: username, // Add the username to the message
      };

      // Immediately update UI with the new message
      if (activePeer) {
        // Update the UI with the new message for the active conversation
        setMessages((prevMessages) => [...prevMessages, newMessage]);

        // Also update the conversations state
        setConversations((prevConversations) => {
          const updatedConversations = { ...prevConversations };
          if (updatedConversations[activePeer]) {
            updatedConversations[activePeer] = {
              ...updatedConversations[activePeer],
              messages: [
                ...updatedConversations[activePeer].messages,
                newMessage,
              ],
            };
          } else {
            updatedConversations[activePeer] = {
              peerAddress: activePeer,
              messages: [newMessage],
              unreadCount: 0,
            };
          }
          return updatedConversations;
        });
      }

      // Post to blockchain only if saveToBlockchain is true
      if (saveToBlockchain) {
        const blockchainSuccess = await postToBlockchain(
          contentToStore,
          ethAddress,
          encrypted,
          encryptedSymmetricKey,
          activePeer
        );
        if (!blockchainSuccess) {
          console.warn(
            "Message will be sent to peers but not saved to blockchain"
          );
        }

        // Always force a refresh of blockchain messages after sending to ensure consistency
        // Use setTimeout to allow the blockchain to process the message
        setTimeout(() => forceRefreshMessages(), 1500);
      } else {
        console.log("Message sent only via P2P, not saved to blockchain");

        // For P2P-only messages, send a direct confirmation to UI to ensure responsive UX
        // If we have a WebSocket connection, immediately attempt P2P delivery
        // without waiting for the blockchain
        if (
          globalWebSocketRef.current &&
          activePeer &&
          actuallyConnectedPeers.includes(activePeer)
        ) {
          console.log("Sending P2P-only message to: ", activePeer);

          // Make sure we set confirmed=true for UI updating
          setMessages((prevMessages) =>
            prevMessages.map((msg) =>
              msg.timestamp === preciseTimestamp
                ? { ...msg, confirmed: true }
                : msg
            )
          );

          // Also update in the conversations state
          if (activePeer) {
            setConversations((prevConvs) => {
              const newConvs = { ...prevConvs };
              if (newConvs[activePeer]) {
                newConvs[activePeer].messages = newConvs[
                  activePeer
                ].messages.map((msg) =>
                  msg.timestamp === preciseTimestamp
                    ? { ...msg, confirmed: true }
                    : msg
                );
              }
              return newConvs;
            });
          }
        }
      }

      // Prepare message data for WebSocket with the signature
      const wsMessage = {
        type: "message",
        content: contentToSend,
        timestamp: preciseTimestamp, // Use the same precise timestamp
        sender: ethAddress,
        signature: signature,
        broadcast: false,
        encrypted: encrypted,
        encryptedSymmetricKey: encryptedSymmetricKey,
        saveToBlockchain: saveToBlockchain, // Add flag to the WebSocket message object
        p2pOnly: !saveToBlockchain, // Add p2pOnly flag based on saveToBlockchain setting
        senderUsername: username, // Include the username in the outgoing message
      };

      // Send to active peer or broadcast
      if (activePeer) {
        const peerMessage = {
          ...wsMessage,
          target: activePeer,
          broadcast: false,
        };

        // For P2P-only messages, implement multiple send attempts for better reliability
        if (!saveToBlockchain && actuallyConnectedPeers.includes(activePeer)) {
          // Send the initial message
          globalWebSocketRef.current.send(JSON.stringify(peerMessage));

          // Also process this message locally to ensure it appears in our UI
          if (!saveToBlockchain) {
            processPeerMessage({
              ...peerMessage,
              confirmed: true,
              content: messageContent, // Use the decrypted content for UI
              decrypted: encrypted ? true : false,
            });
          }

          // Then send one additional copy with a delay for reliability
          setTimeout(() => {
            if (globalWebSocketRef.current?.readyState === WebSocket.OPEN) {
              globalWebSocketRef.current.send(JSON.stringify(peerMessage));
              console.log(`Sent redundant P2P message (attempt 1)`);
            }
          }, 500);
        } else {
          // For blockchain messages, just send once
          globalWebSocketRef.current.send(JSON.stringify(peerMessage));
        }
      } else {
        wsMessage.broadcast = true;
        globalWebSocketRef.current.send(JSON.stringify(wsMessage));
      }

      // Scroll to bottom
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop =
          chatContainerRef.current.scrollHeight;
      }
    } catch (error) {
      console.error("Error sending message:", error);
      toast({
        title: "Send Error",
        status: "error",
        duration: 3000,
        isClosable: true,
        position: "bottom-left",
      });
    }
  };

  // Connect to peer using ETH address
  const connectToPeer = async (targetAddress: string) => {
    if (
      !globalWebSocketRef.current ||
      globalWebSocketRef.current.readyState !== WebSocket.OPEN
    )
      return;

    try {
      // Clear the messages display first when initiating new connection
      setMessages([]);
      setIsConnecting(true);

      // First try to establish connection through relay server
      const response = await fetch(
        "https://relay-server-nzhu.onrender.com/discover",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            target_id: targetAddress,
          }),
        }
      );

      const data = await response.json();
      if (data.status === "present") {
        // Send connection request through WebSocket
        const message = {
          type: "connect_peer",
          target: targetAddress,
          sender: ethAddress,
          content: `Connect to ${targetAddress}`, // Make sure content is included
        };
        globalWebSocketRef.current.send(JSON.stringify(message));

        // Keep polling for punch through for up to 30 seconds
        let attempts = 0;
        const maxAttempts = 10; // Try 10 times over 30 seconds
        let connected = false;

        // Show toast indicating waiting for the other peer
        toast({
          title: "Waiting for Connection",
          status: "info",
          duration: 3000,
          isClosable: true,
          position: "bottom-left",
        });

        while (attempts < maxAttempts && !connected) {
          try {
            // Wait for punch through
            const punchResponse = await fetch(
              "https://relay-server-nzhu.onrender.com/waiting_punch",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  sender_id: ethAddress,
                  target_id: targetAddress,
                }),
              }
            );

            const punchData = await punchResponse.json();
            if (punchData.status === "punch") {
              connected = true;
            } else {
              // Resend the connection request
              if (
                globalWebSocketRef.current &&
                globalWebSocketRef.current.readyState === WebSocket.OPEN
              ) {
                globalWebSocketRef.current.send(JSON.stringify(message));
              }

              // Wait 3 seconds before retrying
              await new Promise((resolve) => setTimeout(resolve, 3000));
              attempts++;
            }
          } catch (error) {
            console.error("Error in connection attempt:", error);
            attempts++;
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        }

        if (connected) {
          // Add to actually connected peers
          addActuallyConnectedPeer(targetAddress);
          // Also add to historical peers
          setConnectedPeers((prev) => new Set([...prev, targetAddress]));

          // Set as active peer
          setActivePeer(targetAddress);

          // Load conversation history if it exists
          (async () => {
            await forceRefreshMessages();

            if (conversations[targetAddress]) {
              console.log(
                `Loading existing conversation with ${targetAddress}`
              );
              // If we're setting this as active peer, update messages
              if (activePeer === targetAddress || !activePeer) {
                setMessages(conversations[targetAddress].messages);
              }
            } else {
              console.log(
                `No existing conversation with ${targetAddress}, starting new one`
              );
              // Create an empty conversation for this peer if none exists
              setConversations((prev) => ({
                ...prev,
                [targetAddress]: {
                  peerAddress: targetAddress,
                  messages: [],
                  unreadCount: 0,
                },
              }));
            }
          })();

          setIsConnecting(false);
          return true;
        } else {
          toast({
            title: "Connection Failed",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "bottom-left",
          });
        }
      } else {
        toast({
          title: "Peer Not Found",
          status: "error",
          duration: 5000,
          isClosable: true,
          position: "bottom-left",
        });
      }
      setIsConnecting(false);
      return false;
    } catch (error) {
      console.error("Error connecting to peer:", error);
      setIsConnecting(false);
      return false;
    }
  };

  // New functions for switching between active peers and viewing history

  // Switch to a different active peer
  const switchActivePeer = (peerAddress: string) => {
    // Always clear messages first when switching peers
    setMessages([]);

    // If not currently connected to this peer, try to connect first
    if (!actuallyConnectedPeers.includes(peerAddress)) {
      // If the peer is in our historical peers list but not currently connected
      if (connectedPeers.has(peerAddress)) {
        toast({
          title: "Connecting...",
          status: "info",
          duration: 3000,
          isClosable: true,
          position: "bottom-left",
        });

        // Try to establish a connection
        connectToPeer(peerAddress);
        return;
      } else {
        toast({
          title: "Not Connected",
          status: "warning",
          duration: 3000,
          isClosable: true,
          position: "bottom-left",
        });
        return;
      }
    }

    // Update active peer state
    setActivePeer(peerAddress);
    setViewingHistory(false);

    // Load messages for this peer
    if (conversations[peerAddress]) {
      setMessages(conversations[peerAddress].messages);

      // Mark conversation as read
      setConversations((prev) => {
        const updated = { ...prev };
        if (updated[peerAddress]) {
          updated[peerAddress] = {
            ...updated[peerAddress],
            unreadCount: 0,
          };
        }
        return updated;
      });
    }

    forceRefreshMessages();
  };

  // Function to select and display a conversation history
  const selectConversation = (peerAddress: string) => {
    // Always clear messages first when switching conversations
    setMessages([]);

    // If we're selecting the active peer, just switch to it
    if (actuallyConnectedPeers.includes(peerAddress)) {
      switchActivePeer(peerAddress);
      return;
    }

    // Otherwise, go into history view mode
    setSelectedConversation(peerAddress);

    // Load messages from this conversation
    if (conversations[peerAddress]) {
      // Make sure we're only showing messages that belong to this conversation
      const filteredMessages = conversations[peerAddress].messages.filter(
        (msg) =>
          (msg.sender === peerAddress &&
            (msg.target === ethAddress || !msg.target)) ||
          (msg.sender === ethAddress && msg.target === peerAddress)
      );

      setMessages(filteredMessages);

      // Mark conversation as read
      setConversations((prev) => {
        const updated = { ...prev };
        if (updated[peerAddress]) {
          updated[peerAddress] = {
            ...updated[peerAddress],
            unreadCount: 0,
          };
        }
        return updated;
      });
    }

    setViewingHistory(true);
  };

  // Go back from history view to active peer
  const goBackToCurrent = () => {
    // Always clear messages first
    setMessages([]);

    setViewingHistory(false);
    setSelectedConversation(null);
    setShowConversations(true); // Show the conversation history panel

    // Reset to current messages if there are any
    if (activePeer && conversations[activePeer]) {
      setMessages(conversations[activePeer].messages);
    }
  };

  // Utility functions for display
  const formatPeerName = (address: string) => {
    // If we have a username for this address, use it
    if (peerUsernames[address]) {
      return peerUsernames[address];
    }

    // Otherwise use the shortened address format
    return address.length > 10
      ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}`
      : address;
  };

  const formatTime = (timestamp: number) => {
    if (!timestamp) return "Unknown time";

    const date = new Date(timestamp);
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatConversationDate = (timestamp: number) => {
    if (!timestamp) return "Unknown date";

    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Check if date is today
    if (date.toDateString() === today.toDateString()) {
      return `Today ${date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
    // Check if date is yesterday
    else if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday ${date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
    // Otherwise show full date
    else {
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
  };

  // Update formatMessageDate for use in message display
  const formatMessageDate = (timestamp: number) => {
    if (!timestamp) return "Unknown";

    const date = new Date(timestamp);
    const now = new Date();

    // If the message is from today, just show the time
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
    // If within the last week, show day name and time
    else if (now.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) {
      return `${date.toLocaleDateString([], {
        weekday: "short",
      })} ${date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
    // Otherwise show full date
    else {
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
  };

  // Get all conversations sorted by most recent message
  const getSortedConversations = () => {
    return Object.values(conversations)
      .filter((convo) => convo.messages.length > 0)
      .sort((a, b) => {
        const aLastMsg = a.messages[a.messages.length - 1];
        const bLastMsg = b.messages[b.messages.length - 1];
        return bLastMsg.timestamp - aLastMsg.timestamp;
      });
  };

  // Get the last message from a conversation
  const getLastMessage = (conversation: Conversation) => {
    if (conversation.messages.length === 0) return null;
    return conversation.messages[conversation.messages.length - 1];
  };

  // Count total unread messages
  const getTotalUnreadCount = () => {
    return Object.values(conversations).reduce(
      (total, convo) => total + convo.unreadCount,
      0
    );
  };

  // Effect to scroll chat to bottom when messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Add a clear function for when disconnected
  const clearConnectionState = () => {
    setConnectedPeers(new Set());
    setActuallyConnectedPeers([]);
    setActivePeer(null);
    setMessages([]);
  };

  // Update the decryptMessage function to track failures without showing toasts for each one
  const decryptMessage = async (
    encryptedContent: string,
    encryptedSymmetricKey: string,
    senderAddress: string
  ): Promise<string | null> => {
    if (!web3Ref.current || !ethAddress) return null;

    try {
      console.log("Attempting to decrypt message from:", senderAddress);
      console.log("Encrypted content:", encryptedContent);

      // Skip non-encrypted or already decrypted messages
      if (
        !encryptedContent ||
        typeof encryptedContent !== "string" ||
        !encryptedContent.startsWith("U2FsdGVk")
      ) {
        console.log("Content doesn't appear to be encrypted, returning as is");
        return encryptedContent;
      }

      // With our combined approach, use the provided signature to derive the symmetric key
      const symmetricKey = web3Ref.current.utils
        .keccak256(encryptedSymmetricKey)
        .substring(0, 34);

      console.log("Generated symmetric key for decryption");

      // Decrypt using the symmetric key
      try {
        const decryptedBytes = AES.decrypt(encryptedContent, symmetricKey);
        const decryptedContent = decryptedBytes.toString(enc.Utf8);

        if (!decryptedContent || decryptedContent.length === 0) {
          console.error(
            "Decryption produced empty result for sender:",
            senderAddress
          );

          // Instead of showing individual toasts, track the failures by sender
          setDecryptionFailures((prev) => {
            const updated = { ...prev };
            updated[senderAddress] = (updated[senderAddress] || 0) + 1;
            return updated;
          });

          // Set a timeout to show a batched notification (only on the first failure)
          if (!decryptionNotificationTimeoutRef.current) {
            decryptionNotificationTimeoutRef.current = window.setTimeout(() => {
              // Show a single notification with the count of failed decryptions
              const totalFailures = Object.values(decryptionFailures).reduce(
                (sum, count) => sum + count,
                0
              );
              const uniqueSenders = Object.keys(decryptionFailures).length;

              if (totalFailures > 0) {
                toast({
                  title: "Decryption Notice",
                  description: `${totalFailures} message${
                    totalFailures > 1 ? "s" : ""
                  } from ${uniqueSenders} sender${
                    uniqueSenders > 1 ? "s" : ""
                  } couldn't be decrypted.`,
                  status: "warning",
                  duration: 5000,
                  isClosable: true,
                  position: "bottom-left",
                });
              }

              // Reset the failures and timeout
              setDecryptionFailures({});
              decryptionNotificationTimeoutRef.current = undefined;
            }, 2000); // Wait 2 seconds to batch notifications
          }

          return null; // Indicate decryption failure
        }

        console.log(
          "Message decrypted successfully:",
          decryptedContent.substring(0, 20) + "..."
        );
        return decryptedContent;
      } catch (decryptError) {
        console.error(
          "AES decryption failed for sender:",
          senderAddress,
          decryptError
        );

        // Track failures but don't show individual toasts
        setDecryptionFailures((prev) => {
          const updated = { ...prev };
          updated[senderAddress] = (updated[senderAddress] || 0) + 1;
          return updated;
        });

        return null; // Indicate decryption failure
      }
    } catch (error) {
      console.error("Error in decryption process:", error);
      return null; // Indicate decryption failure
    }
  };

  // Add a logoff function
  const handleLogoff = () => {
    // Close WebSocket connection
    if (globalWebSocketRef.current) {
      globalWebSocketRef.current.close();
      globalWebSocketRef.current = null;
    }

    // Clear localStorage
    localStorage.removeItem(STORAGE_KEYS.USERNAME);
    localStorage.removeItem(STORAGE_KEYS.ETH_ADDRESS);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_PEER);
    // Keep port settings as they're likely to remain the same

    // Reset application state
    setEthAddress("");
    setUsername("");
    setConnected(false);
    setConnectedPeers(new Set());
    setActuallyConnectedPeers([]);
    setActivePeer(null);
    setMessages([]);
    setConversations({});
    clearConnectionState();

    // Show confirmation
    toast({
      title: "Logged Out",
      status: "success",
      duration: 3000,
      isClosable: true,
      position: "bottom-left",
    });
  };

  // Convert the Set to Array and vice versa in state management
  const addActuallyConnectedPeer = useCallback((peerAddress: string) => {
    setActuallyConnectedPeers((prev) => {
      if (prev.includes(peerAddress)) return prev;
      return [...prev, peerAddress];
    });

    // ... existing code ...
  }, []);

  // Fix the removeActuallyConnectedPeer function
  const removeActuallyConnectedPeer = useCallback((peerAddress: string) => {
    setActuallyConnectedPeers((prev) => {
      return prev.filter((p) => p !== peerAddress);
    });

    // ... existing code ...
  }, []);

  // Fix the function name from handleSelectConversation to selectConversation
  const handleConversationSelect = (conversationId: string) => {
    selectConversation(conversationId);
  };

  // Add an effect to set the background color
  useEffect(() => {
    // Set background color on mount
    document.body.style.backgroundColor = "#1A202C"; // gray.900

    // Cleanup on unmount
    return () => {
      document.body.style.backgroundColor = "";
    };
  }, []);

  const copyAddressToClipboard = () => {
    if (navigator.clipboard && ethAddress) {
      navigator.clipboard.writeText(ethAddress);
      toast({
        title: "Address Copied",
        status: "success",
        duration: 2000,
        isClosable: true,
        position: "bottom-left",
      });
    }
  };

  // Add a function to get public IP address
  const getPublicIpAddress = async (): Promise<string> => {
    try {
      // Try with ipify service first
      const response = await fetch("https://api.ipify.org?format=json");
      const data = await response.json();
      console.log("Retrieved public IP:", data.ip);

      // Store IP in localStorage for future use
      localStorage.setItem(STORAGE_KEYS.PUBLIC_IP, data.ip);
      return data.ip;
    } catch (error) {
      console.error("Error getting public IP from ipify:", error);

      // Try with ipinfo as a backup
      try {
        const backupResponse = await fetch("https://ipinfo.io/json");
        const backupData = await backupResponse.json();
        if (backupData.ip) {
          console.log(
            "Retrieved public IP from backup service:",
            backupData.ip
          );
          localStorage.setItem(STORAGE_KEYS.PUBLIC_IP, backupData.ip);
          return backupData.ip;
        }
      } catch (backupError) {
        console.error(
          "Error getting public IP from backup service:",
          backupError
        );
      }

      // Fallback to any stored IP from previous sessions
      const storedIp = localStorage.getItem(STORAGE_KEYS.PUBLIC_IP);
      if (storedIp) {
        console.log("Using stored public IP:", storedIp);
        return storedIp;
      }

      // Return a placeholder if we can't get the IP
      return "0.0.0.0";
    }
  };

  // Add a new function for P2P-only message refreshing
  const refreshP2PMessages = async () => {
    if (
      !globalWebSocketRef.current ||
      globalWebSocketRef.current.readyState !== WebSocket.OPEN ||
      !activePeer
    ) {
      return;
    }

    // Use a timestamp to throttle requests
    const now = Date.now();
    const lastRefreshKey = `last_p2p_refresh_${activePeer}`;
    const lastRefreshStr = sessionStorage.getItem(lastRefreshKey);
    const lastRefresh = lastRefreshStr ? parseInt(lastRefreshStr) : 0;

    // Don't send a refresh request if we've sent one in the last 3 seconds
    if (now - lastRefresh < 3000) {
      console.log("Skipping P2P refresh request - too soon since last request");
      return;
    }

    // Update the last refresh timestamp
    sessionStorage.setItem(lastRefreshKey, now.toString());

    try {
      // Send a special P2P refresh request to the active peer
      const refreshRequest = {
        type: "p2p_refresh_request",
        sender: ethAddress,
        target: activePeer,
        timestamp: now,
        content: "P2P message refresh request",
      };

      globalWebSocketRef.current.send(JSON.stringify(refreshRequest));
      console.log(`Sent P2P refresh request to active peer: ${activePeer}`);

      // Send one more request with a delay for reliability
      setTimeout(() => {
        if (globalWebSocketRef.current?.readyState === WebSocket.OPEN) {
          globalWebSocketRef.current.send(JSON.stringify(refreshRequest));
        }
      }, 500);
    } catch (error) {
      console.error("Error sending P2P refresh request:", error);
    }
  };

  // Add message update debounce logic
  useEffect(() => {
    // When switching active peer, ensure we're not throttling the first update
    sessionStorage.removeItem(`last_p2p_refresh_${activePeer}`);

    // Also clear any other refresh keys for inactive peers periodically
    const cleanupInterval = setInterval(() => {
      if (activePeer) {
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (
            key &&
            key.startsWith("last_p2p_refresh_") &&
            !key.includes(activePeer)
          ) {
            sessionStorage.removeItem(key);
          }
        }
      }
    }, 60000); // Clean up every minute

    return () => {
      clearInterval(cleanupInterval);
    };
  }, [activePeer]);

  // Add a helper function to process peer messages consistently
  const processPeerMessage = async (message: any) => {
    // Extract and store the username if it exists in the message
    if (message.senderUsername && message.sender !== ethAddress) {
      updatePeerUsername(message.sender, message.senderUsername);
    }

    // First try to decrypt if encrypted
    if (message.encrypted && message.encryptedSymmetricKey) {
      try {
        const decryptedContent = await decryptMessage(
          message.content,
          message.encryptedSymmetricKey,
          message.sender
        );

        if (decryptedContent) {
          message.content = decryptedContent;
          message.decrypted = true;
          message.encryptedContent = message.content;
        }
      } catch (error) {
        console.error("Failed to decrypt incoming P2P message:", error);
      }
    }

    // Create the message object
    const newMessage: Message = {
      sender: message.sender,
      content: message.content,
      timestamp: message.timestamp || Date.now(),
      confirmed: true,
      signature: message.signature,
      encrypted: message.encrypted || false,
      decrypted: message.decrypted || false,
      encryptedSymmetricKey: message.encryptedSymmetricKey,
      p2pOnly: message.p2pOnly || false,
      target: message.target,
      senderUsername: message.senderUsername || peerUsernames[message.sender],
    };

    // Determine the peer address correctly based on whether you're sending or receiving
    const peerAddress =
      message.sender === ethAddress ? message.target : message.sender;

    // Update the UI immediately if this is for the active conversation
    // Check if the active peer matches EITHER the sender OR target of the message
    if (
      activePeer === message.sender ||
      (message.sender === ethAddress && activePeer === message.target) ||
      (message.target === ethAddress && activePeer === message.sender)
    ) {
      setMessages((prevMessages) => {
        // Check if this message already exists to prevent duplicates
        const messageExists = prevMessages.some(
          (msg) =>
            msg.signature === newMessage.signature &&
            msg.timestamp === newMessage.timestamp
        );

        if (messageExists) return prevMessages;
        return [...prevMessages, newMessage];
      });

      // Scroll to bottom
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop =
          chatContainerRef.current.scrollHeight;
      }
    }

    // Update the conversations state
    setConversations((prevConversations) => {
      const updatedConversations = { ...prevConversations };

      // Only proceed if we have a valid peer address (Ethereum format)
      if (
        !peerAddress ||
        !peerAddress.startsWith("0x") ||
        peerAddress.length !== 42
      ) {
        return updatedConversations;
      }

      if (updatedConversations[peerAddress]) {
        // Check if this message already exists in the conversation
        const messageExists = updatedConversations[peerAddress].messages.some(
          (msg) =>
            msg.signature === newMessage.signature &&
            msg.timestamp === newMessage.timestamp
        );

        if (!messageExists) {
          updatedConversations[peerAddress] = {
            ...updatedConversations[peerAddress],
            messages: [
              ...updatedConversations[peerAddress].messages,
              newMessage,
            ],
            unreadCount:
              activePeer !== peerAddress
                ? updatedConversations[peerAddress].unreadCount + 1
                : 0,
          };
        }
      } else {
        updatedConversations[peerAddress] = {
          peerAddress,
          messages: [newMessage],
          unreadCount: activePeer !== peerAddress ? 1 : 0,
        };
      }
      return updatedConversations;
    });
  };

  // Update the handleModeSwitch function
  const handleModeSwitch = (newSaveToBlockchain: boolean) => {
    try {
      // Skip if the mode is already set
      if (newSaveToBlockchain === saveToBlockchain) {
        console.log(
          "Mode already set to",
          newSaveToBlockchain ? "blockchain" : "P2P-only"
        );
        return;
      }

      // Enforce cooldown
      const now = Date.now();
      const lastModeChange = parseInt(
        localStorage.getItem("blockchat_last_mode_change") || "0"
      );
      const timeSinceLastChange = now - lastModeChange;

      if (timeSinceLastChange < 5000) {
        console.log(
          `Mode change rejected - too soon (${timeSinceLastChange}ms since last change)`
        );
        toast({
          title: "Please wait",
          status: "warning",
          duration: 3000,
          isClosable: true,
          position: "bottom-left",
        });
        return;
      }

      // Update state
      setSaveToBlockchain(newSaveToBlockchain);
      localStorage.setItem(
        STORAGE_KEYS.SAVE_TO_BLOCKCHAIN,
        newSaveToBlockchain.toString()
      );
      localStorage.setItem("blockchat_last_mode_change", now.toString());

      // Check for valid WebSocket
      if (
        !globalWebSocketRef.current ||
        globalWebSocketRef.current.readyState !== WebSocket.OPEN
      ) {
        console.error("WebSocket not connected, can't send mode change");
        return;
      }

      // Prepare message
      let addressToUse = ethAddress;
      if (!addressToUse) {
        addressToUse = localStorage.getItem(STORAGE_KEYS.ETH_ADDRESS) || "";
      }

      if (
        !addressToUse ||
        !addressToUse.startsWith("0x") ||
        addressToUse.length !== 42
      ) {
        console.error("Invalid Ethereum address:", addressToUse);
        toast({
          title: "Mode Change Error",
          status: "error",
          duration: 3000,
          isClosable: true,
          position: "bottom-left",
        });
        return;
      }

      // Send mode change
      const modeMessage = {
        type: "toggle_blockchain_mode",
        value: newSaveToBlockchain,
        sender: addressToUse,
        content: `Switching to ${
          newSaveToBlockchain ? "blockchain" : "P2P-only"
        } mode`,
        timestamp: now,
      };

      console.log("Sending mode change:", modeMessage);
      globalWebSocketRef.current.send(JSON.stringify(modeMessage));

      // For P2P-only mode, send NAT request with delay
      if (!newSaveToBlockchain) {
        // Show status toast
        toast({
          title: "Switching to P2P-only Mode",
          status: "info",
          duration: 3000,
          isClosable: true,
          position: "bottom-left",
        });

        // Send multiple NAT detection requests to ensure it's processed
        // First immediate request
        sendNatPortRequest(addressToUse);

        // Second request after delay
        setTimeout(() => {
          if (
            globalWebSocketRef.current &&
            globalWebSocketRef.current.readyState === WebSocket.OPEN
          ) {
            sendNatPortRequest(addressToUse);
          }
        }, 1000);

        // Final request with longer delay for reliability
        setTimeout(() => {
          if (
            globalWebSocketRef.current &&
            globalWebSocketRef.current.readyState === WebSocket.OPEN
          ) {
            sendNatPortRequest(addressToUse);

            // Also refresh messages to ensure proper connection
            forceRefreshMessages(true);
          }
        }, 2500);
      }
    } catch (error) {
      console.error("Error handling mode switch:", error);
    }
  };

  // Helper function to send NAT port request
  const sendNatPortRequest = (addressToUse: string) => {
    if (
      !globalWebSocketRef.current ||
      globalWebSocketRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const natModeMessage = {
      type: "p2p_use_nat_port",
      sender: addressToUse,
      target: addressToUse,
      nat_address: "", // Empty string triggers automatic NAT detection
      content: "Request to use NAT port for P2P-only mode",
      timestamp: Date.now(),
    };
    console.log("Requesting NAT port usage:", natModeMessage);
    globalWebSocketRef.current.send(JSON.stringify(natModeMessage));
  };

  // Main connection function
  const connectWallet = async (isAutoReconnect = false) => {
    try {
      // Clear any existing state first
      setConnectedPeers(new Set());
      setActuallyConnectedPeers([]);
      setActivePeer(localStorage.getItem(STORAGE_KEYS.ACTIVE_PEER));
      setMessages([]);
      setConversations({});

      if (!username.trim()) {
        toast({
          title: "Username Required",
          status: "error",
          duration: 3000,
          isClosable: true,
          position: "bottom-left",
        });
        return;
      }

      // Only set connecting states if this is not an auto-reconnect
      if (!isAutoReconnect) {
        setIsConnecting(true);
        setLoginButtonConnecting(true); // Set the login button state
      }

      if (window.ethereum) {
        let addressToUse = ethAddress;

        // If we already have an eth address in localStorage, use it without prompting MetaMask
        if (ethAddress && ethAddress.startsWith("0x")) {
          console.log("Using saved Ethereum address:", ethAddress);
          // Still initialize web3
          const web3 = new Web3(window.ethereum);
          web3Ref.current = web3;
        } else {
          // Need to request account access from MetaMask
          await window.ethereum.request({ method: "eth_requestAccounts" });
          const web3 = new Web3(window.ethereum);
          web3Ref.current = web3;

          const accounts = await web3.eth.getAccounts();
          const address = accounts[0];
          setEthAddress(address);
          localStorage.setItem(STORAGE_KEYS.ETH_ADDRESS, address);
          addressToUse = address; // Use this immediately rather than waiting for state update
        }

        // 1. First connect to relay server, always using the definitive address
        console.log("Connecting to relay server with address:", addressToUse);
        const relayConnected = await connectToRelayServer(
          addressToUse,
          p2pPort
        );
        if (!relayConnected) {
          console.error("Failed to register with relay server");
          toast({
            title: "Relay Connection Failed",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "bottom-left",
          });

          // Reset connecting state if this is a manual connection
          if (!isAutoReconnect) {
            setIsConnecting(false);
            setLoginButtonConnecting(false); // Reset the login button state
          }
          return; // Exit like the Python script does
        }

        // 2. Then connect to WebSocket - use the established connectWebSocket function
        connectWebSocket();

        toast({
          title: "Connected to Wallet",
          status: "success",
          duration: 3000,
          isClosable: true,
          position: "bottom-left",
        });

        // Reset connecting state if this is a manual connection
        if (!isAutoReconnect) {
          setIsConnecting(false);
          setLoginButtonConnecting(false); // Reset the login button state
        }
      } else {
        toast({
          title: "MetaMask Not Found",
          status: "error",
          duration: 5000,
          isClosable: true,
          position: "bottom-left",
        });

        // Reset connecting state if this is a manual connection
        if (!isAutoReconnect) {
          setIsConnecting(false);
          setLoginButtonConnecting(false); // Reset the login button state
        }
      }
    } catch (error) {
      console.error("Error connecting to wallet:", error);
      toast({
        title: "Connection Error",
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "bottom-left",
      });

      // Make sure to reset connecting states on error
      if (!isAutoReconnect) {
        setIsConnecting(false);
        setLoginButtonConnecting(false); // Reset the login button state
      }
    }
  };

  // Add forceRefreshMessages function
  const forceRefreshMessages = async (forceIgnoreBlockchainMode = false) => {
    console.log(
      "Forcing message refresh with saveToBlockchain =",
      saveToBlockchain
    );

    try {
      // Check if we should skip blockchain operations completely
      if (!saveToBlockchain && !forceIgnoreBlockchainMode) {
        console.log(
          "Skipping blockchain fetch because saveToBlockchain is false"
        );
        // In P2P-only mode, still refresh P2P messages
        refreshP2PMessages();
        return; // Exit early to avoid any blockchain operations
      }

      // Only proceed with blockchain operations if saveToBlockchain is true or we're forcing it
      if (saveToBlockchain || forceIgnoreBlockchainMode) {
        console.log(
          `Fetching blockchain messages (saveToBlockchain: ${saveToBlockchain}, force: ${forceIgnoreBlockchainMode})`
        );
        await fetchBlockchainMessages(true);
      }

      // Update the connected peers from blockchain data
      if (ethAddress && (saveToBlockchain || forceIgnoreBlockchainMode)) {
        const peers = await fetchBlockchainMessages(true);
        setConnectedPeers(new Set(peers));
      }

      // Always send P2P refresh requests regardless of saveToBlockchain
      if (
        globalWebSocketRef.current &&
        globalWebSocketRef.current.readyState === WebSocket.OPEN
      ) {
        try {
          const refreshRequest = {
            type: "refresh_request",
            sender: ethAddress,
            timestamp: Date.now(),
            content: "Refresh request", // Add content field to fix backend errors
          };
          globalWebSocketRef.current.send(JSON.stringify(refreshRequest));
          console.log("Sent refresh request to peers");

          // If we have an active peer, send a direct refresh request to ensure they respond
          if (activePeer) {
            const directRefreshRequest = {
              type: "refresh_request",
              sender: ethAddress,
              target: activePeer,
              timestamp: Date.now(),
              content: "Direct refresh request",
            };
            globalWebSocketRef.current.send(
              JSON.stringify(directRefreshRequest)
            );
            console.log(
              `Sent direct refresh request to active peer: ${activePeer}`
            );
          }
        } catch (error) {
          console.error("Error sending refresh request:", error);
          // If there's an error sending, try to reconnect
          if (globalWebSocketRef.current.readyState !== WebSocket.OPEN) {
            connectWebSocket();
          }
        }
      } else {
        console.log("WebSocket not open, trying to reconnect...");
        connectWebSocket(); // Try to reconnect if socket isn't open
      }
    } catch (error) {
      console.error("Error during force refresh:", error);
    }
  };

  const processSystemMessage = useCallback(
    (content: string) => {
      // Filter out common system messages that are not important to users
      const systemMessagesToFilter = [
        "stored",
        "queue",
        "mode using port",
        "refresh",
      ];

      // Check if this message contains any filtered terms
      const shouldFilter = systemMessagesToFilter.some((term) =>
        content.toLowerCase().includes(term.toLowerCase())
      );

      if (!shouldFilter) {
        // This is a message worth showing to the user
        toast({
          title: content, // Just use content as the title for cleaner appearance
          status: "success", // Use success status for green color
          duration: 3000,
          isClosable: true,
          position: "bottom-left", // Position on the bottom-left
        });
      } else {
        // Just log filtered messages to console
        console.log("System message (filtered from UI):", content);
      }
    },
    [toast]
  );

  // Add a function to update peer username
  const updatePeerUsername = useCallback(
    (address: string, username: string) => {
      if (!address || !username || address === ethAddress) return;

      setPeerUsernames((prev) => {
        // Only update if it's a new username or different from the existing one
        if (prev[address] !== username) {
          const updated = { ...prev, [address]: username };
          // Save to localStorage for persistence
          localStorage.setItem(
            STORAGE_KEYS.PEER_USERNAMES,
            JSON.stringify(updated)
          );
          return updated;
        }
        return prev;
      });
    },
    [ethAddress]
  );

  return (
    <Box height="100vh" display="flex" flexDirection="column">
      {ethAddress && <P2PServiceDownloader connectedStatus={connected} />}
      <Container maxW="container.xl" py={5} color="whiteAlpha.900">
        <VStack spacing={4} align="stretch">
          <HStack justifyContent="space-between">
            {ethAddress && (
              <Text
                fontSize={["xl", "2xl"]}
                fontWeight="bold"
                bgGradient="linear(to-r, cyan.400, purple.500)"
                bgClip="text"
              >
                BlockChat
              </Text>
            )}
            {ethAddress && (
              <HStack
                spacing={2}
                flexWrap="wrap"
                justifyContent={["flex-end", "flex-end", "flex-end"]}
              >
                {isConnecting ? (
                  <Badge
                    colorScheme="yellow"
                    p={2}
                    borderRadius="md"
                    variant="outline"
                  >
                    Connecting...
                  </Badge>
                ) : connected ? (
                  <Badge
                    colorScheme="green"
                    p={2}
                    borderRadius="md"
                    variant="outline"
                  >
                    Connected
                  </Badge>
                ) : (
                  <Badge
                    colorScheme="red"
                    p={2}
                    borderRadius="md"
                    variant="outline"
                  >
                    Disconnected
                  </Badge>
                )}
                <Button
                  size={["xs", "sm"]}
                  onClick={handleLogoff}
                  colorScheme="red"
                  variant="outline"
                >
                  Log Off
                </Button>
              </HStack>
            )}
          </HStack>

          {!ethAddress ? (
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              minHeight="70vh"
            >
              <Box
                p={8}
                borderWidth={1}
                borderRadius="lg"
                bg="gray.800"
                boxShadow="xl"
                maxWidth="500px"
                width="100%"
              >
                <VStack spacing={6}>
                  <Text
                    fontSize="2xl"
                    fontWeight="bold"
                    bgGradient="linear(to-r, cyan.400, purple.500)"
                    bgClip="text"
                  >
                    Welcome to BlockChat
                  </Text>
                  <Text fontSize="md" textAlign="center" color="gray.400">
                    Secure P2P communication with blockchain verification
                  </Text>
                  <Input
                    placeholder="Enter your username"
                    value={username}
                    onChange={handleUsernameChange}
                    bg="gray.700"
                    borderColor="gray.600"
                    _placeholder={{ color: "gray.400" }}
                    size="lg"
                  />
                  <FormControl>
                    <FormLabel>Your P2P Port</FormLabel>
                    <Input
                      type="number"
                      placeholder="Enter your P2P port (e.g., 8082)"
                      value={p2pPort}
                      onChange={(e) => setP2pPort(parseInt(e.target.value))}
                      bg="gray.700"
                      borderColor="gray.600"
                      _placeholder={{ color: "gray.400" }}
                      size="lg"
                    />
                    <Text fontSize="xs" color="gray.400" mt={1}>
                      This port will be associated with your address in the
                      relay server.
                    </Text>
                  </FormControl>
                  <Button
                    colorScheme="blue"
                    onClick={() => connectWallet(false)}
                    width="100%"
                    size="lg"
                    isLoading={loginButtonConnecting}
                    loadingText="Connecting..."
                  >
                    Connect Wallet
                  </Button>
                </VStack>
              </Box>
            </Box>
          ) : (
            <Grid templateColumns={["1fr", "1fr", "300px 1fr"]} gap={4}>
              {/* Conversation History Sidebar - Always visible */}
              <GridItem display={["none", "none", "block"]}>
                <Box
                  borderWidth={1}
                  borderRadius="lg"
                  height={["50vh", "60vh", "70vh"]}
                  minHeight="300px"
                  maxHeight="800px"
                  overflow="auto"
                  p={2}
                  bg="gray.800"
                  borderColor="gray.700"
                  boxShadow="md"
                >
                  <Text fontWeight="bold" mb={2} p={2} fontSize={["sm", "md"]}>
                    Conversation History
                    {getTotalUnreadCount() > 0 && (
                      <Badge colorScheme="red" borderRadius="full" ml={2}>
                        {getTotalUnreadCount()}
                      </Badge>
                    )}
                  </Text>
                  <Divider mb={2} borderColor="gray.700" />

                  {ethAddress && (
                    <Button
                      size="sm"
                      onClick={onOpen}
                      colorScheme="blue"
                      width="full"
                      mb={2}
                    >
                      Connect to New Peer
                    </Button>
                  )}

                  {getSortedConversations().length > 0 ? (
                    <List spacing={0}>
                      {getSortedConversations().map((convo) => {
                        const lastMsg = getLastMessage(convo);
                        const isActive = activePeer === convo.peerAddress;
                        const isSelected =
                          selectedConversation === convo.peerAddress;

                        // Check actual connection status by looking at actuallyConnectedPeers
                        const isConnected = actuallyConnectedPeers.includes(
                          convo.peerAddress
                        );

                        return (
                          <ListItem
                            key={convo.peerAddress}
                            onClick={() =>
                              selectConversation(convo.peerAddress)
                            }
                            cursor="pointer"
                            p={2}
                            borderRadius="md"
                            _hover={{ bg: "gray.700" }}
                            bg={
                              isActive || isSelected
                                ? "blue.900"
                                : "transparent"
                            }
                            position="relative"
                          >
                            <HStack>
                              <Avatar
                                size="sm"
                                name={formatPeerName(convo.peerAddress)}
                                bg={isConnected ? "green.500" : "gray.500"}
                              />
                              <Box flex="1" overflow="hidden">
                                <HStack justify="space-between">
                                  <Text
                                    fontWeight="bold"
                                    fontSize="sm"
                                    isTruncated
                                  >
                                    {formatPeerName(convo.peerAddress)}
                                    {isConnected && (
                                      <Badge
                                        ml={1}
                                        colorScheme="green"
                                        fontSize="xs"
                                      >
                                        online
                                      </Badge>
                                    )}
                                    {isActive && (
                                      <Badge
                                        ml={1}
                                        colorScheme="blue"
                                        fontSize="xs"
                                      >
                                        active
                                      </Badge>
                                    )}
                                  </Text>
                                  {lastMsg && (
                                    <Text fontSize="xs" color="gray.400">
                                      {formatConversationDate(
                                        lastMsg.timestamp
                                      )}
                                    </Text>
                                  )}
                                </HStack>
                                {lastMsg && (
                                  <Text
                                    fontSize="xs"
                                    color="gray.400"
                                    isTruncated
                                  >
                                    {lastMsg.sender === ethAddress
                                      ? "You: "
                                      : ""}
                                    {lastMsg.content}
                                  </Text>
                                )}
                              </Box>
                              {convo.unreadCount > 0 && (
                                <Badge
                                  colorScheme="red"
                                  borderRadius="full"
                                  px={2}
                                >
                                  {convo.unreadCount}
                                </Badge>
                              )}
                            </HStack>
                          </ListItem>
                        );
                      })}
                    </List>
                  ) : (
                    <Text color="gray.400" p={4} textAlign="center">
                      No conversation history
                    </Text>
                  )}
                </Box>
              </GridItem>

              {/* Mobile Conversation Tabs - Show only on small screens */}
              <GridItem display={["block", "block", "none"]} mb={2}>
                <Box bg="gray.800" p={2} borderRadius="md" boxShadow="md">
                  <HStack justifyContent="space-between" mb={2}>
                    <Text fontSize="sm" fontWeight="bold">
                      Active Conversations
                    </Text>
                    {ethAddress && (
                      <Button size="xs" onClick={onOpen} colorScheme="blue">
                        Connect New
                      </Button>
                    )}
                  </HStack>
                  <Box overflowX="auto" pb={2}>
                    <HStack spacing={2}>
                      {getSortedConversations().length === 0 ? (
                        <Text fontSize="xs" color="gray.400">
                          No active conversations
                        </Text>
                      ) : (
                        getSortedConversations().map((convo) => {
                          const isActive = activePeer === convo.peerAddress;
                          const isConnected = actuallyConnectedPeers.includes(
                            convo.peerAddress
                          );

                          return (
                            <Button
                              key={convo.peerAddress}
                              size="xs"
                              onClick={() =>
                                selectConversation(convo.peerAddress)
                              }
                              colorScheme={isActive ? "blue" : "gray"}
                              variant={isActive ? "solid" : "outline"}
                              position="relative"
                            >
                              {formatPeerName(convo.peerAddress)}
                              {convo.unreadCount > 0 && (
                                <Badge
                                  position="absolute"
                                  top="-1"
                                  right="-1"
                                  colorScheme="red"
                                  borderRadius="full"
                                  fontSize="xs"
                                  transform="scale(0.8)"
                                >
                                  {convo.unreadCount}
                                </Badge>
                              )}
                            </Button>
                          );
                        })
                      )}
                    </HStack>
                  </Box>
                </Box>
              </GridItem>

              {/* Main Chat Area */}
              <GridItem>
                <VStack spacing={4} align="stretch">
                  <Box p={3} borderRadius="md" bg="gray.800" boxShadow="md">
                    <HStack justifyContent="space-between" flexWrap="wrap">
                      <Box>
                        <Text fontSize={["xs", "sm"]}>
                          Connected as: {username}
                        </Text>
                        <HStack>
                          <Text fontSize={["xs", "sm"]}>
                            Your P2P Address: {ethAddress.substring(0, 6)}...
                            {ethAddress.substring(38)} (Port: {p2pPort})
                          </Text>
                          <IconButton
                            aria-label="Copy address"
                            icon={<FiCopy />}
                            size="xs"
                            onClick={copyAddressToClipboard}
                            colorScheme="teal"
                            variant="ghost"
                          />
                        </HStack>
                        {activePeer && (
                          <Text
                            fontSize={["xs", "sm"]}
                            fontWeight="bold"
                            color="cyan.300"
                          >
                            Chatting with: {formatPeerName(activePeer)}
                            {actuallyConnectedPeers.includes(activePeer) && (
                              <Badge ml={2} colorScheme="green" fontSize="xs">
                                Connected
                              </Badge>
                            )}
                          </Text>
                        )}
                      </Box>
                    </HStack>
                  </Box>

                  {viewingHistory && (
                    <Box mb={2}>
                      <HStack>
                        <IconButton
                          aria-label="Go back"
                          icon={<FiChevronLeft />}
                          size="sm"
                          onClick={goBackToCurrent}
                          colorScheme="blue"
                          variant="ghost"
                        />
                        <Text fontSize="sm" color="gray.400">
                          Viewing conversation history with{" "}
                          {formatPeerName(selectedConversation || "")}
                        </Text>
                      </HStack>
                    </Box>
                  )}

                  <Box
                    ref={chatContainerRef}
                    p={4}
                    borderWidth={1}
                    borderRadius="lg"
                    height={["50vh", "60vh", "70vh"]}
                    minHeight="300px"
                    maxHeight="800px"
                    overflow="auto"
                    position="relative"
                    bg="gray.800"
                    borderColor="gray.700"
                    boxShadow="md"
                  >
                    {/* Reconnecting message overlay - show when we have active peer but disconnected */}
                    {activePeer &&
                      !actuallyConnectedPeers.includes(activePeer) &&
                      connected && (
                        <Box
                          position="absolute"
                          top="50%"
                          left="50%"
                          transform="translate(-50%, -50%)"
                          bg="gray.900"
                          p={6}
                          borderRadius="md"
                          boxShadow="lg"
                          zIndex={2}
                          textAlign="center"
                          maxW="90%"
                          border="1px solid"
                          borderColor="blue.500"
                        >
                          <VStack spacing={3}>
                            <Spinner size="xl" color="cyan.400" />
                            <Text fontWeight="bold" color="cyan.300">
                              Reconnecting to peer...
                            </Text>
                            <Text color="gray.300">
                              The connection to {formatPeerName(activePeer)} was
                              lost. Attempting to reconnect automatically.
                            </Text>
                            <Button
                              colorScheme="cyan"
                              size="sm"
                              onClick={() => connectToPeer(activePeer)}
                            >
                              Try Again
                            </Button>
                          </VStack>
                        </Box>
                      )}

                    {messages.length > 0 ? (
                      <List spacing={3}>
                        {messages.map((msg, idx) => (
                          <ListItem
                            key={`${msg.sender}_${msg.timestamp}_${idx}`}
                            display="flex"
                            justifyContent={
                              msg.sender === ethAddress
                                ? "flex-end"
                                : "flex-start"
                            }
                          >
                            <Menssage
                              content={msg.content}
                              sender={msg.sender}
                              timestamp={msg.timestamp}
                              isCurrentUser={msg.sender === ethAddress}
                              encrypted={msg.encrypted}
                              decrypted={msg.decrypted}
                              encryptedContent={msg.encryptedContent}
                              formatTime={formatMessageDate}
                              formatPeerName={formatPeerName}
                            />
                            {msg.p2pOnly && (
                              <Badge
                                ml={1}
                                colorScheme="purple"
                                fontSize="xs"
                                position="absolute"
                                bottom="0"
                                right={
                                  msg.sender === ethAddress ? "10px" : "auto"
                                }
                                left={
                                  msg.sender !== ethAddress ? "10px" : "auto"
                                }
                              >
                                P2P only
                              </Badge>
                            )}
                          </ListItem>
                        ))}
                      </List>
                    ) : (
                      <VStack py={10} spacing={4} align="center">
                        <Text
                          color="gray.300"
                          textAlign="center"
                          fontSize={["md", "lg"]}
                          fontWeight="medium"
                        >
                          {activePeer
                            ? "No messages yet. Start a conversation!"
                            : "No active conversation"}
                        </Text>
                      </VStack>
                    )}
                  </Box>

                  <HStack
                    spacing={2}
                    width="100%"
                    flexDir={["column", "column", "row"]}
                    alignItems="stretch"
                  >
                    <Input
                      placeholder={
                        viewingHistory
                          ? "Viewing history mode"
                          : activePeer
                          ? `Message to ${formatPeerName(activePeer)}...`
                          : "Select a conversation to start chatting..."
                      }
                      value={input}
                      onChange={handleInputChange}
                      onKeyPress={(e) => e.key === "Enter" && handleSend()}
                      isDisabled={viewingHistory || !activePeer}
                      mb={[2, 2, 0]}
                      bg="gray.700"
                      borderColor="gray.600"
                      _placeholder={{ color: "gray.400" }}
                      _hover={{ borderColor: "gray.500" }}
                      _focus={{ borderColor: "cyan.400" }}
                    />
                    <HStack>
                      <Tooltip
                        label={
                          saveToBlockchain
                            ? "Mensagem será salva na blockchain"
                            : "Apenas envio direto P2P"
                        }
                      >
                        <Box>
                          <FormControl
                            display="flex"
                            alignItems="center"
                            mb={[2, 2, 0]}
                            mr={2}
                          >
                            <FormLabel
                              htmlFor="save-to-blockchain"
                              mb="0"
                              fontSize="xs"
                              color="gray.400"
                            >
                              Blockchain
                            </FormLabel>
                            <Switch
                              id="save-to-blockchain"
                              colorScheme="green"
                              isChecked={saveToBlockchain}
                              onChange={(e) => {
                                const newMode = e.target.checked;
                                // Call handleModeSwitch immediately when the switch changes
                                handleModeSwitch(newMode);
                              }}
                            />
                          </FormControl>
                        </Box>
                      </Tooltip>
                      <Button
                        colorScheme="cyan"
                        onClick={handleSend}
                        isDisabled={viewingHistory || !activePeer}
                        width={["100%", "100%", "auto"]}
                        _hover={{ bg: "cyan.600" }}
                      >
                        <HStack spacing={1}>
                          <FiSend />
                          <Text>Send</Text>
                        </HStack>
                      </Button>
                    </HStack>
                  </HStack>
                </VStack>
              </GridItem>
            </Grid>
          )}
        </VStack>

        {/* Connect to Peer Modal */}
        <Modal isOpen={isOpen} onClose={onClose}>
          <ModalOverlay />
          <ModalContent bg="gray.800" color="white">
            <ModalHeader borderBottomWidth="1px" borderColor="gray.700">
              Connect to New Peer
            </ModalHeader>
            <ModalCloseButton />
            <ModalBody py={4}>
              <FormControl>
                <FormLabel>Ethereum Address</FormLabel>
                <Input
                  placeholder="0x..."
                  value={connectTarget}
                  onChange={handleConnectTargetChange}
                  bg="gray.700"
                  borderColor="gray.600"
                  _hover={{ borderColor: "gray.500" }}
                  _focus={{ borderColor: "cyan.400" }}
                />
              </FormControl>
            </ModalBody>

            <ModalFooter borderTopWidth="1px" borderColor="gray.700">
              <Button
                variant="ghost"
                mr={3}
                onClick={onClose}
                _hover={{ bg: "gray.700" }}
              >
                Cancel
              </Button>
              <Button
                colorScheme="cyan"
                onClick={() => {
                  connectToPeer(connectTarget);
                  onClose();
                }}
                isDisabled={isConnecting}
              >
                {isConnecting ? <Spinner size="sm" /> : "Connect"}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* Settings Modal */}
        <Modal isOpen={isSettingsOpen} onClose={onCloseSettings}>
          <ModalOverlay />
          <ModalContent bg="gray.800" color="white">
            <ModalHeader borderBottomWidth="1px" borderColor="gray.700">
              BlockChat Settings
            </ModalHeader>
            <ModalCloseButton />
            <ModalBody py={4}>
              <VStack spacing={4} align="stretch">
                <FormControl>
                  <FormLabel>WebSocket Port</FormLabel>
                  <Input
                    type="number"
                    value={wsPort}
                    onChange={(e) => setWsPort(parseInt(e.target.value))}
                    bg="gray.700"
                    borderColor="gray.600"
                    _hover={{ borderColor: "gray.500" }}
                    _focus={{ borderColor: "cyan.400" }}
                  />
                </FormControl>

                <FormControl>
                  <FormLabel>P2P Port</FormLabel>
                  <Input
                    type="number"
                    value={p2pPort}
                    onChange={(e) => setP2pPort(parseInt(e.target.value))}
                    bg="gray.700"
                    borderColor="gray.600"
                    _hover={{ borderColor: "gray.500" }}
                    _focus={{ borderColor: "cyan.400" }}
                  />
                </FormControl>

                <Divider borderColor="gray.700" />
              </VStack>
            </ModalBody>

            <ModalFooter borderTopWidth="1px" borderColor="gray.700">
              <Button colorScheme="cyan" mr={3} onClick={onCloseSettings}>
                Save
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </Container>
    </Box>
  );
};

export default Chat;
