import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ChakraProvider } from '@chakra-ui/react'
import App from './App.tsx'
import { styleTheme } from '../style/StyleTheme.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChakraProvider theme={styleTheme}>
      <App />
    </ChakraProvider>
  </StrictMode>
)
