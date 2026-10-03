I have an existing Google Apps Script web app with a chatbot. Change the chatbot so it gets its replies from my own backend server (a Node.js service on Render that talks to Claude). Keep my existing UI, styling and page structure. Only change how the bot gets its answers, plus the small additions listed below.

## Backend API

- Base URL: `https://claude-chat-backend-igt5.onrender.com`
- `POST /chat`
  - Headers: `Content-Type: application/json` and `x-backend-secret: <secret>`
  - Body: `{ "message": "<user text>", "sessionId": "<id or null>" }`
  - Success (HTTP 200): `{ "reply": "<Claude's answer>", "sessionId": "<id>" }`
  - Errors: 400 `{ "error": "message is required" }`, or the message is over 8000 characters. 401 `{ "error": "Unauthorized" }` means a wrong or missing secret. 502 `{ "error": "..." }` means Claude failed.
- `GET /health` (no auth) returns `{ "ok": true, "auth": "...", "model": "..." }`.

Conversation memory works through `sessionId`. Send `null` for a new chat. The backend returns a `sessionId`; send it back with every later message in that chat. Clearing it starts a fresh chat. The backend keeps the history, so don't resend earlier messages.

## Rules

1. **The secret must never reach the browser.** Call the backend only from server-side `.gs` code with `UrlFetchApp`. The browser calls that `.gs` function through `google.script.run`. Never put the URL or secret in HTML or client JS.
2. Read both values from Script Properties, never hardcode them:
   - `BACKEND_URL` = `https://claude-chat-backend-igt5.onrender.com`
   - `BACKEND_SECRET` = (I set this myself in Project Settings → Script Properties)
3. Use `muteHttpExceptions: true`, parse the JSON, and throw `new Error(body.error)` when the status isn't 200. Then the client's `withFailureHandler` can show the error in the chat.
4. Keep the `sessionId` in a client-side JS variable for the current chat. Add a "New chat" button if there isn't one; it sets the variable to `null`.
5. Show a "Thinking…" indicator and disable the send button while waiting, because replies can take 5–30 seconds.
6. Render's free plan sleeps after 15 minutes idle. Add:
   - `keepAlive()`: `GET BACKEND_URL + '/health'`, wrapped in try/catch, logging the status.
   - `setupKeepAlive()`: deletes any existing `keepAlive` triggers, then creates `ScriptApp.newTrigger('keepAlive').timeBased().everyMinutes(10).create()`.
   - `stopKeepAlive()`: removes those triggers.
   - `testBackend()`: sends "Say hello in one short sentence." and logs the result.
7. If `appsscript.json` lists `oauthScopes`, make sure it includes `https://www.googleapis.com/auth/script.external_request` and `https://www.googleapis.com/auth/script.scriptapp`.
8. Render text replies with `textContent`, not `innerHTML`, to avoid HTML injection. Light markdown rendering is fine if it's escaped first.

## Reference implementation (adapt to my existing code and names)

```javascript
// Code.gs
function sendChatMessage(message, sessionId) {
  var props = PropertiesService.getScriptProperties();
  var backendUrl = props.getProperty('BACKEND_URL');
  var secret = props.getProperty('BACKEND_SECRET');
  if (!backendUrl || !secret) throw new Error('BACKEND_URL and BACKEND_SECRET must be set in Script Properties.');

  var res = UrlFetchApp.fetch(backendUrl + '/chat', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-backend-secret': secret },
    payload: JSON.stringify({ message: message, sessionId: sessionId || null }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body;
  try { body = JSON.parse(res.getContentText()); }
  catch (e) { throw new Error('Backend returned a non-JSON response (HTTP ' + code + ').'); }
  if (code !== 200) throw new Error(body.error || ('Backend error (HTTP ' + code + ')'));
  return { reply: body.reply, sessionId: body.sessionId };
}
```

```javascript
// client side (inside the HTML <script>)
var sessionId = null;
google.script.run
  .withSuccessHandler(function (res) { sessionId = res.sessionId; /* show res.reply */ })
  .withFailureHandler(function (err) { /* show err.message */ })
  .sendChatMessage(userText, sessionId);
```

When you're done, list the files you changed and tell me which functions to run once (`testBackend`, then `setupKeepAlive`) and that I must create a new deployment version for the web app to pick up the changes.
