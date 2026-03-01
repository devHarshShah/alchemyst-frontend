# Alchemyst Frontend

Next.js frontend for a JWT-protected realtime AI chat product with:
- auth (`/auth/login`, `/auth/signup`)
- chat sessions sidebar (`GET /chat/sessions`)
- session history (`GET /chat/history/:sessionId`)
- realtime streaming over WebSocket (`/chat/ws`)

## Quick Start
```bash
pnpm install
pnpm dev
```

Open:
- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend docs: [http://localhost:4000/docs](http://localhost:4000/docs)

## Scripts
```bash
pnpm dev
pnpm run build
pnpm start
pnpm exec tsc --noEmit
pnpm exec eslint src
```

## Routes
- `/`: main chat app (protected)
- `/auth/login`: login
- `/auth/signup`: signup
- `/dashboard`: redirects to `/`

## Reviewer Docs
For a full architecture and behavior walkthrough, see:
- [docs/REVIEW_GUIDE.md](docs/REVIEW_GUIDE.md)

## Notes
- App uses `next/font` with Google-hosted Geist fonts.
- In restricted network environments, production build can fail due to font fetch errors, independent of app logic.
