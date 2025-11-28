#!/bin/bash
# Build frontend
npm run build

# Start both backend and frontend
node server/index.js & npx vite preview --host --port ${PORT:-3000}
