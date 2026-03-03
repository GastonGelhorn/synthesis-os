import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./src/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                theme: "var(--synthesis-text)",
                "theme-secondary": "var(--synthesis-text-secondary)",
                "theme-muted": "var(--synthesis-text-muted)",
                "theme-accent": "var(--synthesis-accent)",
            },
            backgroundColor: {
                theme: "var(--synthesis-bg)",
                "theme-secondary": "var(--synthesis-bg-secondary)",
                "theme-surface": "var(--synthesis-surface)",
                "theme-surface-hover": "var(--synthesis-surface-hover)",
            },
            borderColor: {
                theme: "rgba(var(--synthesis-glass-border-rgb, 255, 255, 255), 0.15)",
            },
            backgroundImage: {
                "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
                "gradient-conic":
                    "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
            },
        },
    },
    plugins: [],
};
export default config;
