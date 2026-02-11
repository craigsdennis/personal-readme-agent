# Personal README agent

Update forms with your voice (coming soon)

## Install

```bash
cp .dev.vars.example .dev.vars
```

Add your key.

```bash
npm install
```

```bash
npm run preview
```

## Deploy

```bash
npx wrangler secret bulk .dev.vars
```

```bash
npm run deploy
```
