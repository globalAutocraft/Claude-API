# Apps Script website + Claude chatbot

```
Browser ──google.script.run──▶ Apps Script (Code.gs) ──UrlFetchApp──▶ Node backend (Agent SDK) ──▶ Claude
```

- `apps-script/`: the website and chat widget. The backend secret stays on the Apps Script server, so the browser never sees it.
- `backend/`: an Express server that calls Claude through `@anthropic-ai/claude-agent-sdk`. It has no tools and runs in an empty folder, so it's plain chat with no access to your files or shell.

## Which login to use

| Who uses the chatbot | Auth | Billing |
|---|---|---|
| Only you (web app access = "Only myself") | Your Claude login, or `CLAUDE_CODE_OAUTH_TOKEN` | Claude Max plan |
| Anyone else (staff, customers, public) | `ANTHROPIC_API_KEY` | API (Console) |

Anthropic's Agent SDK docs say: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."* So the Max-plan path is only for your own use. `appsscript.json` sets the web app to `MYSELF` to enforce this. If you open it to other people, put an API key in `.env`.

## 1. Backend

```bash
cd backend
npm install
cp .env.example .env      # then edit .env
```

In `.env`, set `BACKEND_SECRET` to a long random string:
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

**Max plan auth, pick one:**
- Running on this PC: `npm install -g @anthropic-ai/claude-code`, then run `claude` once and log in with your Max account. Leave both auth vars blank.
- Running on a server: run `claude setup-token` on your PC and paste the token into `CLAUDE_CODE_OAUTH_TOKEN`.

Start it: `npm start`. Then check `http://localhost:3000/health`, which shows the auth mode in use.

## 2. Deploy to Render

1. Push this folder to a **private** GitHub repo. `.env` is git-ignored, so it is never uploaded.
2. In Render, go to New → Blueprint, then pick the repo. Render reads `render.yaml` and creates the service.
3. On your PC, create the Claude token. You need a terminal on your own computer, because it opens a browser to log in:
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude setup-token
   ```
   Log in with your Max account. It prints a long token that starts with `sk-ant-oat…`.
4. In Render, open the service, go to **Environment**, and paste the token as `CLAUDE_CODE_OAUTH_TOKEN`. Leave `ANTHROPIC_API_KEY` empty, then save.
5. Copy the generated `BACKEND_SECRET` value. Apps Script needs it.
6. Open `https://<your-service>.onrender.com/health`. It should show `"auth":"subscription (setup-token)"`.

Never paste the token into chat, code or git. If it leaks, run `claude setup-token` again and replace it in Render.

### Keep-alive (stop Render from sleeping)

The free plan sleeps after 15 minutes without traffic. Apps Script pings `/health` every 10 minutes: run `setupKeepAlive` once from the Apps Script editor. `stopKeepAlive` removes the ping.

- One always-on free service uses about 744 of the 750 free hours each month, so don't run a second free service on the same account.
- Render's disk is wiped on restart. If an old chat session is gone, the server starts a new session automatically.

## 3. Apps Script

1. Go to script.google.com and create a new project.
2. Paste in `Code.gs`, add an HTML file named `Index` with `Index.html`, and replace the manifest with `appsscript.json` (to see the manifest: Project Settings → "Show appsscript.json").
3. Under Project Settings → Script Properties, add:
   - `BACKEND_URL` = your public URL (no trailing slash)
   - `BACKEND_SECRET` = the same value as in `.env`
4. Run `testBackend` once, authorize, and check the log for a reply.
5. Run `setupKeepAlive` once.
6. Deploy → New deployment → Web app. Open the URL and click 💬.
