import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dashboard is served from the root CommonJS server at /publishing/.
// - base: '/publishing/' so built asset URLs are absolute under that path.
// - outDir: ../../public/publishing so the build lands where the server serves it.
// - emptyOutDir: true so stale build artifacts are cleared on each build.
// - The frontend uses same-origin relative API calls (/api/publishing/*), so no
//   proxy is needed in production. During local `vite dev` the root server must
//   be running on the same origin; set server.proxy if you want to point the
//   dev server at a different host.
export default defineConfig({
  plugins: [react()],
  base: '/publishing/',
  build: {
    outDir: '../../public/publishing',
    emptyOutDir: true,
  },
})
