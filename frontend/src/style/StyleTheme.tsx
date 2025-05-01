import { extendTheme } from "@chakra-ui/react";

export const styleTheme = extendTheme({
    fonts: {
        heading: `'Roboto', sans-serif`,
        body: `'Roboto', sans-serif`,
    },
    colors: {
        gray: {
            50: '#f7f7f7',
            100: '#e1e1e1',
            200: '#cfcfcf',
            300: '#b1b1b1',
            400: '#9e9e9e',
            500: '#7e7e7e',
            600: '#626262',
            700: '#515151',
            800: '#3b3b3b',
            900: '#222222',
        },
        primary: {
            50: '#e3f2f9',
            100: '#c5e4f3',
            200: '#a2d4ec',
            300: '#7ac1e4',
            400: '#47a9da',
            500: '#0088cc',
            600: '#007ab8',
            700: '#006ba1',
            800: '#005885',
            900: '#003f5e',
        },
        accent: {
            500: '#ff4081',
        },
    },
    fontSizes: {
        xs: '0.75rem',    // 12px
        sm: '0.875rem',   // 14px
        md: '1rem',       // 16px
        lg: '1.125rem',   // 18px
        xl: '1.25rem',    // 20px
        '2xl': '1.5rem',  // 24px
        '3xl': '1.875rem',// 30px
        '4xl': '2.25rem', // 36px
        '5xl': '3rem',    // 48px
        '6xl': '4rem',    // 64px
    },
    styles: {
        global: {
            'html, body': {
                backgroundColor: '#b1b1b1',
            },
        },
    },
})