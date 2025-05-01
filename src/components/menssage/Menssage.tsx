import React from "react";
import {
  Text,
  Box,
  Tooltip,
  HStack,
  Badge,
  Flex,
  Icon,
} from "@chakra-ui/react";
import { FiLock, FiUnlock } from "react-icons/fi";

interface MessageProps {
  content: string;
  sender: string;
  timestamp: number;
  isCurrentUser: boolean;
  encrypted?: boolean;
  decrypted?: boolean;
  encryptedContent?: string;
  formatTime: (timestamp: number) => string;
  formatPeerName: (address: string) => string;
}

const Menssage: React.FC<MessageProps> = ({
  content,
  sender,
  timestamp,
  isCurrentUser,
  encrypted = false,
  decrypted = false,
  encryptedContent,
  formatTime,
  formatPeerName,
}) => {
  // Determine what content to show
  const displayContent = isCurrentUser
    ? content // For current user, always show plaintext
    : encrypted && !decrypted
    ? encryptedContent || content // Show encrypted content if not decrypted
    : content; // Show decrypted content if available

  return (
    <Box
      p={3}
      borderRadius="lg"
      bg={isCurrentUser ? "blue.100" : "gray.100"}
      maxW="80%"
      borderWidth={encrypted ? 1 : 0}
      borderColor={
        encrypted ? (decrypted ? "green.200" : "red.200") : undefined
      }
      position="relative"
    >
      {encrypted && (
        <Box
          position="absolute"
          top="-8px"
          right="-8px"
          bg={decrypted ? "green.500" : "red.500"}
          borderRadius="full"
          p={1}
        >
          <Icon as={decrypted ? FiUnlock : FiLock} color="white" boxSize={3} />
        </Box>
      )}

      <HStack spacing={1} mb={1}>
        <Text fontWeight="bold" fontSize="sm">
          {isCurrentUser ? "You" : formatPeerName(sender)}
        </Text>
        {encrypted && (
          <Badge
            colorScheme={decrypted ? "green" : "red"}
            variant="solid"
            borderRadius="full"
            fontSize="xs"
            px={2}
          >
            <Tooltip
              label={
                decrypted
                  ? "This message was encrypted and has been decrypted"
                  : "This message is encrypted and couldn't be decrypted"
              }
            >
              <span>{decrypted ? "Decrypted" : "Encrypted"}</span>
            </Tooltip>
          </Badge>
        )}
      </HStack>

      <Text whiteSpace="pre-wrap" wordBreak="break-word">
        {displayContent}
      </Text>

      <Flex justify="space-between" mt={1}>
        <Text fontSize="xs" color="gray.500">
          {formatTime(timestamp)}
        </Text>
        {encrypted && !isCurrentUser && !decrypted && (
          <Tooltip label="This message is encrypted and couldn't be decrypted">
            <Text fontSize="xs" color="red.500" fontStyle="italic">
              Unable to decrypt
            </Text>
          </Tooltip>
        )}
      </Flex>
    </Box>
  );
};

export default Menssage;
