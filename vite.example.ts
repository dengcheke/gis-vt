
import fg from "fast-glob";
import path from "path";
import { defineConfig } from "vite";
const entrys = fg.globSync([
    "./*.html",
]).map(i => path.resolve(__dirname, i));
console.log(entrys);
// https://vite.dev/config/
export default defineConfig({
    base: './',
    build: {
        copyPublicDir:false,
        sourcemap: true,
        outDir: 'example-build',
        minify: false,
        rollupOptions: {
            input: entrys,
            output: {
                format: 'es' as const,
            },
        }
    },
    server: {
        host: '0.0.0.0'
    }
})
