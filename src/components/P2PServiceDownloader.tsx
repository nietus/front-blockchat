// frontend/src/components/P2PServiceDownloader.tsx
import React, { useState, useEffect } from "react";
import { Box, Button, VStack, HStack, Text, useToast } from "@chakra-ui/react";
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
      title: "Downloading P2P Service",
      description: "After download, run the exe file to start the P2P service",
      status: "info",
      duration: 5000,
      isClosable: true,
    });
  };

  // Instructions for running the service
  const handleShowInstructions = () => {
    toast({
      title: "P2P Service Instructions",
      description:
        "1. Download the p2pConection.exe file\n2. Run it before using BlockChat\n3. Keep it running in the background",
      status: "info",
      duration: 10000,
      isClosable: true,
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
      bg="red.600"
      p={4}
      borderRadius="md"
      boxShadow="lg"
      zIndex={1000}
    >
      <VStack spacing={3} align="stretch">
        <Text fontWeight="bold" color="white">
          P2P Service Not Running
        </Text>
        <Text fontSize="sm" color="white">
          BlockChat requires the P2P service to send and receive messages
        </Text>
        <HStack>
          <Button
            as="a"
            href="/p2pConection.exe"
            download
            size="sm"
            colorScheme="green"
            leftIcon={<DownloadIcon />}
            onClick={handleDownload}
          >
            Download Service
          </Button>
          <Button
            size="sm"
            colorScheme="blue"
            leftIcon={<InfoIcon />}
            onClick={handleShowInstructions}
          >
            Instructions
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
};

export default P2PServiceDownloader;
