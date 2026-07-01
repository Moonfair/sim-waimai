/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#ff6200',
        'primary-light': '#ff8c00',
        'primary-dark': '#e05500',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
      },
      keyframes: {
        'rider-move': {
          '0%': { left: '85%' },
          '100%': { left: '10%' },
        },
        'confetti-fall': {
          '0%': { transform: 'translateY(-100px) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(700px) rotate(720deg)', opacity: '0' },
        },
        'number-roll': {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-90%)' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-scale': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        },
      },
      animation: {
        'rider-move': 'rider-move 30s linear forwards',
        'confetti-fall': 'confetti-fall 3s linear forwards',
        'number-roll': 'number-roll 1.5s ease-out forwards',
        'fade-in-up': 'fade-in-up 0.5s ease-out forwards',
        'pulse-scale': 'pulse-scale 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
