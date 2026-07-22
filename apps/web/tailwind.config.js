/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#FFFCEB',
          100: '#FFF7C7',
          200: '#FEEE89',
          300: '#FDE04B',
          400: '#FCCF21',
          500: '#F5B60A',   // primary accent — Rapido-yellow neighborhood
          600: '#D48A05',
          700: '#A96208',
          800: '#8B4D0F',
          900: '#764012',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted:   '#F6F7F9',
          border:  '#E5E7EB',
          strong:  '#0F172A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        card: '1rem',
      },
      boxShadow: {
        sheet: '0 -8px 24px -12px rgba(15, 23, 42, 0.15)',
        card:  '0 4px 16px -8px rgba(15, 23, 42, 0.15)',
      },
      keyframes: {
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to:   { transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
      },
      animation: {
        'slide-up': 'slide-up 220ms cubic-bezier(0.4, 0.0, 0.2, 1)',
        'fade-in':  'fade-in 200ms ease-out',
      },
    },
  },
  plugins: [],
};
