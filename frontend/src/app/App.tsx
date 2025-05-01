import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import Chat from "../components/Chat";
import { styleTheme } from "../style/StyleTheme";

function App() {
  return (
    <ChakraProvider theme={styleTheme}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Chat />} />
        </Routes>
      </BrowserRouter>
    </ChakraProvider>
  );
}

export default App;
