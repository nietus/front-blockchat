import { Box, Heading, Container } from "@chakra-ui/react";
import Chat from "../components/Chat";

export default function Home() {
  return (
    <Container maxW="container.xl" py={5}>
      <Box textAlign="center" mb={8}>
        <Heading as="h1" size="xl">
          BlockChat
        </Heading>
      </Box>
      <Chat />
    </Container>
  );
}
