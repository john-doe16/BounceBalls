import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode single` bundles everything (JS, CSS, fonts) into one HTML file
// that runs straight from disk — no server or Node needed to play.
export default defineConfig(({ mode }) => (mode === 'single' ? { plugins: [viteSingleFile()] } : {}));
