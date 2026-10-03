I have an existing Google Apps Script web app with a chatbot. Change the chatbot so it gets its replies from my own backend server: a Node.js service on Render that talks to Claude (Claude Agent SDK, my Claude Max plan). The backend is already deployed and tested; it works.

Keep my existing UI, styling, page structure and other features. Only change how the bot gets its answers, plus the small additions listed below. Read my current files first and adapt to my existing function names and HTML.

## Backend API

Base URL: https://claude-chat-backend-igt5.onrender.com

1. POST /chat
   - Headers: Content-Type: application/json and x-backend-secret: <secret>
   - Body: { "message": "<user text>", "sessionId": "<id or null>" }
   - Success (HTTP 200): { "reply": "<Claude's answer>", "sessionId": "<id>" }
   - Errors (always JSON { "error": "..." }):
     - 400: message is empty or longer than 8000 characters
     - 401: wrong or missing secret
     - 502: Claude failed
2. GET /health (no auth) returns { "ok": true, "auth": "...", "model": "..." }

Conversation memory uses sessionId:
- Send null for a new chat.
- The backend returns a sessionId. Send it back with every later message in the same chat.
- The backend stores the history itself, so do NOT resend earlier messages.
- If the server restarted and the old session is gone, the backend starts a new session automatically and returns the new sessionId. Always store the latest sessionId from each response.

## Configuration: Script Properties (already set by me, never hardcode)

- BACKEND_URL = https://claude-chat-backend-igt5.onrender.com
- BACKEND_SECRET = (already set by me in Project Settings → Script Properties)

Read both with PropertiesService.getScriptProperties(). Do NOT write the secret into any file, and do NOT create a function that sets it.

## Rules

1. The secret must never reach the browser.
   - Call the backend only from server-side .gs code using UrlFetchApp.
   - The browser calls that .gs function through google.script.run.
   - Never put the backend URL or secret in HTML or client-side JS.
2. In UrlFetchApp.fetch, use muteHttpExceptions: true. Parse the JSON, and if the status isn't 200, throw new Error(body.error) so the client's withFailureHandler can show it in the chat.
3. Keep sessionId in a client-side JS variable for the current chat. Add a "New chat" button if there isn't one; it sets sessionId to null and clears the messages.
4. Replies can take 5–30 seconds, so while waiting:
   - show a "Thinking…" indicator
   - disable the send button
   - Enter sends the message and Shift+Enter adds a new line
5. Render's free plan sleeps after 15 minutes idle. Add these server-side functions:
   - keepAlive(): GET BACKEND_URL + '/health' inside try/catch, logging the status code.
   - setupKeepAlive(): delete any existing triggers for 'keepAlive', then ScriptApp.newTrigger('keepAlive').timeBased().everyMinutes(10).create(), then call keepAlive() once.
   - stopKeepAlive(): delete the 'keepAlive' triggers.
   - testBackend(): call the chat function with "Say hello in one short sentence." and Logger.log the result.
6. In appsscript.json, if oauthScopes is listed, make sure it includes:
   - https://www.googleapis.com/auth/script.external_request
   - https://www.googleapis.com/auth/script.scriptapp
   Keep the scopes my project already uses.
7. Show replies with textContent, not innerHTML, to prevent HTML injection. Simple markdown (bold, line breaks, code) is fine only if the text is HTML-escaped first.
8. Don't remove or break anything unrelated to the chatbot.

## Reference implementation (adapt names to my project)

```javascript
// Code.gs (server side)
function sendChatMessage(message, sessionId) {
  var props = PropertiesService.getScriptProperties();
  var backendUrl = props.getProperty('BACKEND_URL');
  var secret = props.getProperty('BACKEND_SECRET');
  if (!backendUrl || !secret) {
    throw new Error('BACKEND_URL and BACKEND_SECRET must be set in Script Properties.');
  }

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

function keepAlive() {
  var url = PropertiesService.getScriptProperties().getProperty('BACKEND_URL');
  if (!url) return;
  try {
    var res = UrlFetchApp.fetch(url + '/health', { muteHttpExceptions: true });
    Logger.log('keepAlive: HTTP ' + res.getResponseCode());
  } catch (e) {
    Logger.log('keepAlive failed: ' + e.message);
  }
}

function setupKeepAlive() {
  stopKeepAlive();
  ScriptApp.newTrigger('keepAlive').timeBased().everyMinutes(10).create();
  keepAlive();
}

function stopKeepAlive() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'keepAlive') ScriptApp.deleteTrigger(t);
  });
}

function testBackend() {
  Logger.log(sendChatMessage('Say hello in one short sentence.', null));
}
```

```javascript
// Client side (inside the HTML <script>)
var sessionId = null;

function sendToBot(userText) {
  // show user message, show "Thinking…", disable send button
  google.script.run
    .withSuccessHandler(function (res) {
      sessionId = res.sessionId;
      // remove "Thinking…", show res.reply using textContent, re-enable send
    })
    .withFailureHandler(function (err) {
      // remove "Thinking…", show err.message as an error, re-enable send
    })
    .sendChatMessage(userText, sessionId);
}

function newChat() {
  sessionId = null;
  // clear the chat messages
}
```

## When you're done, tell me

1. Which files you changed and what changed in each.
2. To run testBackend once from the editor (and approve the permissions); the log should show Claude's reply.
3. To run setupKeepAlive once, then check the Triggers page shows keepAlive every 10 minutes.
4. To go to Deploy → Manage deployments → Edit → New version → Deploy, so the web app picks up the changes.
