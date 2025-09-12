
import { defineConfig } from "vite";
import { dependencies } from './package.json';
// https://vite.dev/config/
export default defineConfig({
    build: {
        emptyOutDir: true,
        copyPublicDir: false,
        lib: {
            entry: './src/index.ts',
            fileName: format => `index.${format}.js`,
            formats: ['es', 'cjs', 'umd', 'iife'],
            name: "VT"
        },
        rollupOptions: {
            external: Object.keys(dependencies)
        }
    }
})
