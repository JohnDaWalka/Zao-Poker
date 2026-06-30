import type { Config } from "tailwindcss";

/**
 * Tailwind CSS Configuration
 * 
 * This configuration centralizes all theme colors for the mini app.
 * To change the app's color scheme, simply update the 'primary' color value below.
 * 
 * Example theme changes:
 * - Blue theme: primary: "#3182CE"
 * - Green theme: primary: "#059669" 
 * - Red theme: primary: "#DC2626"
 * - Orange theme: primary: "#EA580C"
 */
export default {
    darkMode: "media",
    content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
  		colors: {
  			// ZAO Poker brand: chemist-neon cyan over a near-black glass surface.
  			primary: "#22d3ee", // Main brand color (neon cyan)
  			"primary-light": "#67e8f9", // For hover states
  			"primary-dark": "#0891b2", // For active states

  			// Secondary colors for backgrounds and text
  			secondary: "#f8fafc", // Light backgrounds
  			"secondary-dark": "#334155", // Dark backgrounds

  			// Chemist/poker accent set
  			"neon-green": "#39ff14",
  			"neon-gold": "#eab308",

  			// Dark glass surfaces
  			surface: "#0a0f16",
  			"surface-light": "#10182333",

  			// Legacy CSS variables for backward compatibility
  			background: 'var(--background)',
  			foreground: 'var(--foreground)'
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		// Custom spacing for consistent layout
  		spacing: {
  			'18': '4.5rem',
  			'88': '22rem',
  		},
  		// Custom container sizes
  		maxWidth: {
  			'xs': '20rem',
  			'sm': '24rem',
  			'md': '28rem',
  			'lg': '32rem',
  			'xl': '36rem',
  			'2xl': '42rem',
  		},
  		boxShadow: {
  			glow: '0 0 18px rgba(34, 211, 238, 0.45)',
  			'glow-gold': '0 0 18px rgba(234, 179, 8, 0.45)',
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
