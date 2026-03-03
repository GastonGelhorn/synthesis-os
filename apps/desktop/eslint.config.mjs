import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        ignores: ["src/lib/polyfills/**"],
    },
    {
        files: ["src/**/*.{ts,tsx}"],
        plugins: {
            react: reactPlugin,
            "react-hooks": reactHooks,
        },
        languageOptions: {
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
            globals: {
                window: "readonly",
                document: "readonly",
                console: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                fetch: "readonly",
                localStorage: "readonly",
                sessionStorage: "readonly",
                indexedDB: "readonly",
                URL: "readonly",
                Blob: "readonly",
                FormData: "readonly",
                Request: "readonly",
                Response: "readonly",
                AbortController: "readonly",
                MutationObserver: "readonly",
                ResizeObserver: "readonly",
                PerformanceObserver: "readonly",
                IntersectionObserver: "readonly",
            },
        },
        settings: {
            react: { version: "detect" },
        },
        rules: {
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "react/react-in-jsx-scope": "off",
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",
            "prefer-const": "warn",
            "no-useless-escape": "warn",
            "no-async-promise-executor": "warn",
            "no-case-declarations": "warn",
            "no-undef": "off",
        },
    },
);
