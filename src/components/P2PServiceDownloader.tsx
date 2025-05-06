// frontend/src/components/P2PServiceDownloader.tsx
import React, { useState, useEffect } from "react";
import {
  Box,
  Button,
  VStack,
  HStack,
  Text,
  useToast,
  Flex,
} from "@chakra-ui/react";
import { DownloadIcon, InfoIcon } from "@chakra-ui/icons";

interface P2PServiceDownloaderProps {
  connectedStatus?: boolean;
}

const P2PServiceDownloader: React.FC<P2PServiceDownloaderProps> = ({
  connectedStatus,
}) => {
  const [serviceRunning, setServiceRunning] = useState(false);
  const [checking, setChecking] = useState(true);
  const toast = useToast();

  // Use the connection status from parent if available
  useEffect(() => {
    if (connectedStatus === true) {
      setServiceRunning(true);
      setChecking(false);
    }
  }, [connectedStatus]);

  // Check if p2p service is running
  useEffect(() => {
    const checkService = async () => {
      try {
        const ws = new WebSocket("ws://localhost:8081");

        ws.onopen = () => {
          setServiceRunning(true);
          setChecking(false);
          ws.close();
        };

        ws.onerror = () => {
          if (!connectedStatus) {
            setServiceRunning(false);
            setChecking(false);
          }
        };

        // Set a timeout in case it hangs
        setTimeout(() => {
          if (checking && !connectedStatus) {
            setServiceRunning(false);
            setChecking(false);
          }
        }, 3000);
      } catch (error) {
        if (!connectedStatus) {
          setServiceRunning(false);
          setChecking(false);
        }
      }
    };

    if (!connectedStatus) {
      checkService();
    }
  }, [connectedStatus, checking]);

  // Handle download and instructions
  const handleDownload = () => {
    toast({
      title: "P2P Service downloaded - please run the exe file to start",
      status: "success",
      duration: 5000,
      isClosable: true,
      position: "bottom-left",
    });
  };

  // Instructions for running the service
  const handleShowInstructions = () => {
    toast({
      title:
        "P2P Service Instructions: Download, run exe file, keep running in background",
      status: "success",
      duration: 5000,
      isClosable: true,
      position: "bottom-left",
    });
  };

  // If service is running or connected externally, don't show
  if (serviceRunning || connectedStatus === true) {
    return null;
  }

  return (
    <Box
      position="fixed"
      bottom="20px"
      right="20px"
      bg="rgba(220, 38, 38, 0.9)"
      p={3}
      borderRadius="md"
      boxShadow="lg"
      width="auto"
      maxWidth="300px"
      zIndex={1000}
    >
      <VStack spacing={2} align="stretch">
        <Text fontWeight="bold" color="white" fontSize="md" textAlign="center">
          🚫 P2P Service Not Running
        </Text>
        <Text fontSize="xs" color="white" textAlign="center">
          BlockChat requires the P2P service
        </Text>
        <HStack justifyContent="center" spacing={2}>
          <Button
            as="a"
            href="/p2pConection.exe"
            download
            size="sm"
            colorScheme="green"
            leftIcon={<DownloadIcon />}
            onClick={handleDownload}
          >
            Download
          </Button>
          <Button
            size="sm"
            colorScheme="blue"
            leftIcon={<InfoIcon />}
            onClick={handleShowInstructions}
          >
            Help
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
};

export default P2PServiceDownloader;
