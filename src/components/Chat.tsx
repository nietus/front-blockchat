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
  Flex,
  IconButton,
  Tab,
  Tabs,
  TabList,
  TabPanel,
  TabPanels,
  Heading,
} from "@chakra-ui/react";
import Web3 from "web3";
import { AES, enc } from "crypto-js";
import {
  FiSend,
  FiMessageSquare,
  FiChevronLeft,
  FiChevronRight,
} from "react-icons/fi";
import Menssage from "./menssage/Menssage";

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
};

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

  const wsRef = useRef<WebSocket | null>(null);
  const web3Ref = useRef<Web3 | null>(null);
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
    // If we have saved address, username and ports, try to reconnect automatically
    if (ethAddress && username) {
      console.log("Found saved credentials, attempting auto-reconnect...");
      // Short delay to ensure the UI is fully loaded
      const reconnectTimeout = setTimeout(() => {
        connectWallet();
      }, 1000);

      return () => clearTimeout(reconnectTimeout);
    }
  }, []);

  // Add a helper function to compare message arrays
  const areMessagesEqual = (
    messagesA: Message[],
    messagesB: Message[]
  ): boolean => {
    if (messagesA.length !== messagesB.length) {
      return false;
    }

    // Compare messages by content, sender and timestamp
    return messagesA.every((msgA, index) => {
      const msgB = messagesB[index];
      return (
        msgA.content === msgB.content &&
        msgA.sender === msgB.sender &&
        msgA.timestamp === msgB.timestamp &&
        msgA.decrypted === msgB.decrypted
      );
    });
  };

  // Update setMessages to only change state if content actually changed
  const updateMessagesIfChanged = (newMessages: Message[]) => {
    // Compare with current messages to avoid unnecessary updates
    if (!areMessagesEqual(messages, newMessages)) {
      setMessages(newMessages);
    }
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
      const response = await fetch("http://localhost:8003/chain");

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

        // Sort all messages by timestamp
        allMessages.sort((a, b) => a.timestamp - b.timestamp);

        // Build conversations from blockchain data
        const newConversations: Record<string, Conversation> = {};

        // Group messages by peer
        historicalPeers.forEach((peerAddress) => {
          // Get all messages between this peer and the current user
          const peerMessages = allMessages.filter(
            (msg) =>
              msg.sender === peerAddress ||
              (msg.sender === ethAddress && msg.target === peerAddress) ||
              msg.sender === ethAddress // Also include messages without explicit target
          );

          newConversations[peerAddress] = {
            peerAddress,
            messages: peerMessages,
            unreadCount: 0,
          };
        });

        // Update conversations with blockchain data
        setConversations((prevConversations) => {
          const merged = { ...prevConversations };

          // Merge in the new conversations
          Object.keys(newConversations).forEach((peerAddress) => {
            merged[peerAddress] = newConversations[peerAddress];
          });

          return merged;
        });

        // Update connected peers
        setConnectedPeers(new Set(historicalPeers));

        // IMPORTANT: Always update current messages view if we have an active peer
        // This is critical for ensuring decrypted messages appear
        if (activePeer && newConversations[activePeer]) {
          console.log(`Updating active messages for peer ${activePeer}`);
          // Only update if messages have actually changed
          const newMessages = [...newConversations[activePeer].messages];
          updateMessagesIfChanged(newMessages);

          // Schedule another UI refresh to make absolutely sure updates are picked up
          // but only if there are actual changes
          setTimeout(() => {
            if (activePeer && newConversations[activePeer]) {
              updateMessagesIfChanged([
                ...newConversations[activePeer].messages,
              ]);
            }
          }, 500);
        }

        // If we had newly decrypted messages, always trigger a UI refresh
        if (hasNewDecryptedMessages) {
          // Set a small timeout to allow state to update
          setTimeout(() => {
            if (activePeer && newConversations[activePeer]) {
              updateMessagesIfChanged([
                ...newConversations[activePeer].messages,
              ]);
            }
          }, 100);

          // And another refresh a bit later to be sure
          setTimeout(() => {
            if (activePeer && newConversations[activePeer]) {
              updateMessagesIfChanged([
                ...newConversations[activePeer].messages,
              ]);
            }
          }, 1000);
        }

        console.log(
          `Loaded ${historicalPeers.size} peer conversations from blockchain`
        );
        return Array.from(historicalPeers);
      }
    } catch (error) {
      console.error("Error fetching blockchain messages:", error);
      return [];
    }
  };

  // 1. Separate the relay server connection
  const connectToRelayServer = async (address: string, port: number) => {
    try {
      console.log(
        `Registering address ${address} with relay server using P2P port ${port}...`
      );
      const response = await fetch("http://localhost:8080/store", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender_id: address,
          p2p_addr: `127.0.0.1:${port}`,
        }),
      });

      const responseText = await response.text();
      console.log(
        `Relay server response: ${response.status} - ${responseText}`
      );

      if (response.ok) {
        console.log(
          `Successfully registered with relay server using port ${port}`
        );
        // Display a success message
        toast({
          title: "Connected to Relay Server",
          description: `Your P2P port (${port}) is now registered`,
          status: "success",
          duration: 3000,
          isClosable: true,
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error connecting to relay server:", error);
      return false;
    }
  };

  // 2. Separate the WebSocket connection
  const connectWebSocket = () => {
    // Update the status immediately when attempting to connect
    setIsConnecting(true);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("WebSocket already connected, skipping connection");
      setConnected(true);
      setIsConnecting(false);
      return;
    }

    try {
      console.log(
        `Attempting to connect WebSocket to ws://localhost:${wsPort}`
      );
      // Clear any previous websocket
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (err) {
          console.log("Error closing existing websocket:", err);
        }
      }

      // Update UI to show connecting status
      setConnected(false);

      const ws = new WebSocket(`ws://localhost:${wsPort}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`Connected to P2P server on port ${wsPort}`);
        setConnected(true);
        setIsConnecting(false);

        // Clear any existing reconnect timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = undefined;
        }

        if (ethAddress) {
          const registerMsg = {
            type: "register",
            content: "Register ethereum address",
            eth_address: ethAddress,
          };
          console.log("Sending WebSocket registration:", registerMsg);
          ws.send(JSON.stringify(registerMsg));

          // Force refresh messages immediately after successful connection
          setTimeout(() => forceRefreshMessages(), 500);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setConnected(false);
        setIsConnecting(false);

        // Try to reconnect on error
        scheduleReconnect();
      };

      ws.onclose = (event) => {
        console.log(
          `WebSocket disconnected. Code: ${event.code}, Reason: ${
            event.reason || "N/A"
          }`
        );
        // Explicitly set connected to false when websocket closes
        setConnected(false);
        setIsConnecting(false);

        // Don't clear connection state on temporary disconnection
        // clearConnectionState();

        // Schedule a reconnection
        scheduleReconnect();
      };

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("Received message:", message);

          // Initiate an immediate refresh regardless of message type
          // This ensures we don't miss any messages even if the WebSocket notification
          // doesn't contain all the data we need
          if (message.sender !== ethAddress) {
            // Don't refresh for our own messages
            setTimeout(() => forceRefreshMessages(), 200); // Quick refresh
          }

          if (message.type === "system") {
            console.log("System message:", message.content);
            // Immediate refresh for system messages
            forceRefreshMessages();
          } else if (message.type === "message") {
            // First try to decrypt the message if it's encrypted
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
                console.error("Failed to decrypt incoming message:", error);
              }
            }

            // Add a staggered refresh approach for better reliability
            const refreshSequence = () => {
              // Immediate refresh
              forceRefreshMessages();

              // Then another refresh after a short delay
              setTimeout(() => forceRefreshMessages(), 1000);

              // And a final refresh after a longer delay to catch any delayed blockchain writing
              setTimeout(() => forceRefreshMessages(), 3000);
            };

            refreshSequence();

            // Add the message to the conversation immediately for a responsive UI
            if (message.sender && message.content) {
              const newMessage = {
                sender: message.sender,
                content: message.content,
                timestamp: message.timestamp || Date.now(),
                confirmed: true,
                signature: message.signature,
                encrypted: message.encrypted || false,
                decrypted: message.decrypted || false,
                encryptedSymmetricKey: message.encryptedSymmetricKey,
              };

              // Update the UI immediately if this is for the active conversation
              if (activePeer === message.sender) {
                setMessages((prevMessages) => [...prevMessages, newMessage]);

                // Scroll to bottom
                if (chatContainerRef.current) {
                  chatContainerRef.current.scrollTop =
                    chatContainerRef.current.scrollHeight;
                }
              }

              // Update the conversations state
              setConversations((prevConversations) => {
                const updatedConversations = { ...prevConversations };
                const peerAddress = message.sender;

                if (updatedConversations[peerAddress]) {
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
                } else {
                  updatedConversations[peerAddress] = {
                    peerAddress,
                    messages: [newMessage],
                    unreadCount: activePeer !== peerAddress ? 1 : 0,
                  };
                }
                return updatedConversations;
              });
            }
          } else if (message.type === "peer_list") {
            // Update connected peers list
            setCurrentPeers(message.peers || []);
            forceRefreshMessages();
          } else if (message.type === "connection") {
            // Handle successful peer connection
            if (message.status === "connected" && message.peer) {
              const peerAddress = message.peer;

              // Add to ACTUAL connected peers - this is the key change
              addActuallyConnectedPeer(peerAddress);

              // Also add to historical peers
              setConnectedPeers((prev) => new Set([...prev, peerAddress]));

              // Set as active peer if no active peer is set
              if (!activePeer) {
                setActivePeer(peerAddress);
              }

              toast({
                title: "Peer Connected",
                description: `Connected to peer: ${peerAddress}`,
                status: "success",
                duration: 3000,
                isClosable: true,
              });

              // Immediately fetch messages and load conversation history when connecting
              (async () => {
                // First fetch blockchain messages to ensure we have the latest data
                await forceRefreshMessages();

                // Then update the UI with the conversation for this peer
                if (conversations[peerAddress]) {
                  console.log(
                    `Loading existing conversation with ${peerAddress}`
                  );
                  // If we're setting this as active peer, update messages
                  if (activePeer === peerAddress || !activePeer) {
                    setMessages(conversations[peerAddress].messages);
                  }
                } else {
                  console.log(
                    `No existing conversation with ${peerAddress}, starting new one`
                  );
                  // Create an empty conversation for this peer if none exists
                  setConversations((prev) => ({
                    ...prev,
                    [peerAddress]: {
                      peerAddress,
                      messages: [],
                      unreadCount: 0,
                    },
                  }));
                }
              })();
            }
          } else if (message.type === "refresh_request") {
            forceRefreshMessages();
          } else if (message.type === "ping" || message.type === "pong") {
            // Handle ping/pong messages
            console.log(`Received ${message.type} from server`);

            // Always refresh on pings/pongs for more reliable updates
            forceRefreshMessages();
          }
        } catch (e) {
          console.log("Non-JSON server message:", event.data);
        }
      };
    } catch (error) {
      console.error("Error creating WebSocket:", error);
      setConnected(false);
      setIsConnecting(false);

      // Try to reconnect
      scheduleReconnect();
    }
  };

  // Add a dedicated reconnect scheduler function
  const scheduleReconnect = () => {
    // Prevent multiple reconnect attempts
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    console.log("Scheduling WebSocket reconnection in 2 seconds...");
    // Make sure UI shows disconnected status
    setConnected(false);

    reconnectTimeoutRef.current = window.setTimeout(() => {
      console.log("Attempting to reconnect WebSocket...");
      connectWebSocket();
    }, 2000);
  };

  // Main connection function that follows the same sequence as the Python script
  const connectWallet = async () => {
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
          description: "Please enter a username before connecting",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
        return;
      }

      if (window.ethereum) {
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
        }

        // 1. First connect to relay server
        console.log("Connecting to relay server...");
        const relayConnected = await connectToRelayServer(ethAddress, p2pPort);
        if (!relayConnected) {
          console.error("Failed to register with relay server");
          toast({
            title: "Relay Connection Failed",
            description: "Could not connect to relay server",
            status: "error",
            duration: 5000,
            isClosable: true,
          });
          return; // Exit like the Python script does
        }

        // 2. Then connect to WebSocket - use the established connectWebSocket function
        connectWebSocket();

        toast({
          title: "Connected to Wallet",
          description: `Connected to address: ${ethAddress.substring(
            0,
            6
          )}...${ethAddress.substring(38)}`,
          status: "success",
          duration: 3000,
          isClosable: true,
        });
      } else {
        toast({
          title: "MetaMask Not Found",
          description: "Please install MetaMask extension",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      }
    } catch (error) {
      console.error("Error connecting to wallet:", error);
      toast({
        title: "Connection Error",
        description: "Failed to connect to Ethereum wallet",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  // Make the forceRefreshMessages function smarter about updates
  const forceRefreshMessages = async () => {
    console.log("Forcing blockchain message refresh");

    try {
      // First try to get messages from blockchain
      await fetchBlockchainMessages(true);

      // Ensure UI updates when active peer is selected, but only if needed
      if (activePeer && conversations[activePeer]) {
        // Only update if the content has actually changed
        updateMessagesIfChanged([...conversations[activePeer].messages]);
      }

      // Then request peers to send their latest messages
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          const refreshRequest = {
            type: "refresh_request",
            sender: ethAddress,
            timestamp: Date.now(),
            content: "Refresh request", // Add content field to fix backend errors
          };
          wsRef.current.send(JSON.stringify(refreshRequest));
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
            wsRef.current.send(JSON.stringify(directRefreshRequest));
            console.log(
              `Sent direct refresh request to active peer: ${activePeer}`
            );
          }
        } catch (error) {
          console.error("Error sending refresh request:", error);
          // If there's an error sending, try to reconnect
          if (wsRef.current.readyState !== WebSocket.OPEN) {
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

  // Make the refresh interval even shorter and more reliable
  useEffect(() => {
    connectWebSocket();

    // Fetch blockchain messages on mount
    forceRefreshMessages();

    // Set up interval to refresh messages from blockchain every 3 seconds
    const refreshInterval = setInterval(() => {
      if (connected && ethAddress) {
        console.log("Running scheduled 3-second blockchain refresh");
        // Use forceRefreshMessages instead of fetchBlockchainMessages to match the refresh button behavior
        forceRefreshMessages();
      }
    }, 3000); // Reduced from 5000 to 3000ms

    // Add an additional more aggressive refresh for the active conversation
    const activeConvoInterval = setInterval(() => {
      if (connected && ethAddress && activePeer) {
        console.log(
          `Running extra refresh for active conversation with ${activePeer}`
        );
        forceRefreshMessages();
      }
    }, 2000); // Even more frequent refresh for active conversations

    return () => {
      clearInterval(refreshInterval);
      clearInterval(activeConvoInterval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [wsPort, ethAddress]);

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

  // Generate and store encryption keys
  const generateEncryptionKeys = async () => {
    if (!web3Ref.current || !ethAddress) return;

    try {
      // Use MetaMask to sign a message as a seed for the encryption key
      const seed = await window.ethereum.request({
        method: "personal_sign",
        params: ["BlockChat encryption key generation", ethAddress],
      });

      // Use the seed as a private key
      const privateKey = web3Ref.current.utils.keccak256(seed);
      localStorage.setItem("blockChatPrivateKey", privateKey);

      // Generate a public key based on the private key
      const publicKey = web3Ref.current.utils.keccak256(privateKey);
      localStorage.setItem("blockChatPublicKey", publicKey);

      toast({
        title: "Encryption Keys Generated",
        description:
          "Your encryption keys have been generated and stored securely.",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      console.error("Error generating encryption keys:", error);
      toast({
        title: "Key Generation Failed",
        description: "Failed to generate encryption keys.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  // Add this function to post to blockchain
  const postToBlockchain = async (
    message: string,
    sender: string,
    encrypted: boolean = false,
    encryptedSymmetricKey?: string
  ) => {
    try {
      console.log(`Posting message to blockchain at http://localhost:8003...`);

      const txData = {
        author: sender, // Note: using author instead of sender as per Python script
        content: message,
        encrypted: encrypted,
        encryptedSymmetricKey: encryptedSymmetricKey,
      };

      const response = await fetch("http://localhost:8003/new_transaction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(txData),
      });

      if (response.status === 201) {
        console.log("Transaction submitted successfully");

        // Mine the block to include the transaction
        const mineResponse = await fetch("http://localhost:8003/mine");

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
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    try {
      // Disable input while processing to prevent double-sends
      setInput("");
      const messageContent = input.trim();

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
            description:
              "Could not sign and encrypt the message. Please try again.",
            status: "error",
            duration: 3000,
            isClosable: true,
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
            description: "Could not sign the message. Please try again.",
            status: "error",
            duration: 3000,
            isClosable: true,
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

      // Post to blockchain after signing - Always send the encrypted content to blockchain
      const blockchainSuccess = await postToBlockchain(
        contentToStore,
        ethAddress,
        encrypted,
        encryptedSymmetricKey
      );
      if (!blockchainSuccess) {
        console.warn(
          "Message will be sent to peers but not saved to blockchain"
        );
      }

      // Always force a refresh of blockchain messages after sending to ensure consistency
      // Use setTimeout to allow the blockchain to process the message
      setTimeout(() => forceRefreshMessages(), 1500);

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
      };

      // Send to active peer or broadcast
      if (activePeer) {
        const peerMessage = {
          ...wsMessage,
          target: activePeer,
          broadcast: false,
        };
        wsRef.current.send(JSON.stringify(peerMessage));
      } else {
        wsMessage.broadcast = true;
        wsRef.current.send(JSON.stringify(wsMessage));
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
        description: "Failed to send message",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  // Connect to peer using ETH address
  const connectToPeer = async (targetAddress: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    try {
      setIsConnecting(true);

      // First try to establish connection through relay server
      const response = await fetch("http://localhost:8080/discover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target_id: targetAddress,
        }),
      });

      const data = await response.json();
      if (data.status === "present") {
        // Send connection request through WebSocket
        const message = {
          type: "connect_peer",
          target: targetAddress,
          sender: ethAddress,
          content: `Connect to ${targetAddress}`, // Make sure content is included
        };
        wsRef.current.send(JSON.stringify(message));

        // Keep polling for punch through for up to 30 seconds
        let attempts = 0;
        const maxAttempts = 10; // Try 10 times over 30 seconds
        let connected = false;

        // Show toast indicating waiting for the other peer
        toast({
          title: "Waiting for Connection",
          description: `Sent connection request to ${targetAddress}. Waiting for response...`,
          status: "info",
          duration: 5000,
          isClosable: true,
        });

        while (attempts < maxAttempts && !connected) {
          try {
            // Wait for punch through
            const punchResponse = await fetch(
              "http://localhost:8080/waiting_punch",
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
                wsRef.current &&
                wsRef.current.readyState === WebSocket.OPEN
              ) {
                wsRef.current.send(JSON.stringify(message));
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
            description: `Could not establish connection with ${targetAddress}. The peer may need to click "Connect" as well.`,
            status: "error",
            duration: 5000,
            isClosable: true,
          });
        }
      } else {
        toast({
          title: "Peer Not Found",
          description: `Peer ${targetAddress} not found on relay server. Make sure the address is correct and they are online.`,
          status: "error",
          duration: 5000,
          isClosable: true,
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
    // Only allow switching to actually connected peers
    if (!actuallyConnectedPeers.includes(peerAddress)) {
      toast({
        title: "Not Connected",
        description: `You're not currently connected to ${formatPeerName(
          peerAddress
        )}. This peer is only in your history.`,
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

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
    } else {
      setMessages([]);
    }

    forceRefreshMessages();
  };

  // Function to select and display a conversation history
  const selectConversation = (peerAddress: string) => {
    // If we're selecting the active peer, just switch to it
    if (connectedPeers.has(peerAddress)) {
      switchActivePeer(peerAddress);
      return;
    }

    // Otherwise, go into history view mode
    setSelectedConversation(peerAddress);

    // Load messages from this conversation
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

    setViewingHistory(true);
  };

  // Go back from history view to active peer
  const goBackToCurrent = () => {
    setViewingHistory(false);
    setSelectedConversation(null);
    setShowConversations(true); // Show the conversation history panel

    // Reset to current messages if there are any
    if (activePeer && conversations[activePeer]) {
      setMessages(conversations[activePeer].messages);
    } else {
      setMessages([]);
    }
  };

  // Utility functions for display
  const formatPeerName = (address: string) => {
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
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
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
      description: "You have been successfully logged out",
      status: "success",
      duration: 3000,
      isClosable: true,
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

  return (
    <>
      <Container maxW="container.xl" py={5} color="whiteAlpha.900">
        <VStack spacing={4} align="stretch">
          <HStack justifyContent="space-between">
            <Text
              fontSize={["xl", "2xl"]}
              fontWeight="bold"
              bgGradient="linear(to-r, cyan.400, purple.500)"
              bgClip="text"
            >
              BlockChat
            </Text>
            <HStack
              spacing={2}
              flexWrap="wrap"
              justifyContent={["flex-end", "flex-end", "flex-end"]}
            >
              <Button
                size={["xs", "sm"]}
                onClick={onOpenSettings}
                colorScheme="teal"
                variant="outline"
              >
                Settings
              </Button>
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
                onClick={forceRefreshMessages}
                colorScheme="cyan"
                variant="outline"
                mr={2}
              >
                Refresh
              </Button>
              {ethAddress && (
                <Button
                  size={["xs", "sm"]}
                  onClick={handleLogoff}
                  colorScheme="red"
                  variant="outline"
                >
                  Log Off
                </Button>
              )}
            </HStack>
          </HStack>

          {!ethAddress ? (
            <Box
              p={5}
              borderWidth={1}
              borderRadius="lg"
              bg="gray.800"
              boxShadow="xl"
            >
              <VStack spacing={4}>
                <Text fontSize="lg">
                  Please connect your wallet to use BlockChat
                </Text>
                <Input
                  placeholder="Enter your username"
                  value={username}
                  onChange={handleUsernameChange}
                  bg="gray.700"
                  borderColor="gray.600"
                  _placeholder={{ color: "gray.400" }}
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
                  />
                  <Text fontSize="xs" color="gray.400" mt={1}>
                    This port will be associated with your address in the relay
                    server. Use a different port for each BlockChat instance.
                  </Text>
                </FormControl>
                <Button
                  colorScheme="blue"
                  onClick={connectWallet}
                  width={["100%", "auto"]}
                >
                  Connect Wallet
                </Button>
              </VStack>
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

                  {!viewingHistory && !isConnecting && (
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
                    <Button size="xs" onClick={onOpen} colorScheme="blue">
                      Connect New
                    </Button>
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
                        <Text fontSize={["xs", "sm"]}>
                          Your P2P Address: {ethAddress.substring(0, 6)}...
                          {ethAddress.substring(38)} (Port: {p2pPort})
                        </Text>
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

                <Button
                  colorScheme="purple"
                  onClick={generateEncryptionKeys}
                  size="sm"
                >
                  Generate Encryption Keys
                </Button>
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
    </>
  );
};

export default Chat;
