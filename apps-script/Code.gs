/**
 * Website + chatbot served by Apps Script.
 *
 * Set these in Project Settings > Script Properties:
 *   BACKEND_URL    e.g. https://your-tunnel.trycloudflare.com   (no trailing slash)
 *   BACKEND_SECRET same value as BACKEND_SECRET in backend/.env
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('My Website')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Called from the browser via google.script.run.
 * The secret stays on the server side; the browser never sees it.
 */
function sendChatMessage(message, sessionId) {
  var props = PropertiesService.getScriptProperties();
  var backendUrl = props.getProperty('BACKEND_URL');
  var secret = props.getProperty('BACKEND_SECRET');

  if (!backendUrl || !secret) {
    throw new Error('BACKEND_URL and BACKEND_SECRET must be set in Script Properties.');
  }

  var response = UrlFetchApp.fetch(backendUrl + '/chat', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-backend-secret': secret },
    payload: JSON.stringify({ message: message, sessionId: sessionId || null }),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var body = {};
  try {
    body = JSON.parse(response.getContentText());
  } catch (e) {
    throw new Error('Backend returned a non-JSON response (HTTP ' + code + ').');
  }

  if (code !== 200) {
    throw new Error(body.error || ('Backend error (HTTP ' + code + ')'));
  }

  return { reply: body.reply, sessionId: body.sessionId };
}

/**
 * Keep-alive: Render's free plan sleeps after 15 minutes without traffic.
 * Run setupKeepAlive() ONCE from the editor; it pings /health every 10 minutes.
 */
function setupKeepAlive() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'keepAlive') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('keepAlive').timeBased().everyMinutes(10).create();
  keepAlive();
}

/** Run this to stop the pings. */
function stopKeepAlive() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'keepAlive') ScriptApp.deleteTrigger(t);
  });
}

function keepAlive() {
  var backendUrl = PropertiesService.getScriptProperties().getProperty('BACKEND_URL');
  if (!backendUrl) return;
  try {
    var res = UrlFetchApp.fetch(backendUrl + '/health', { muteHttpExceptions: true });
    Logger.log('keepAlive: HTTP ' + res.getResponseCode());
  } catch (e) {
    // A cold start can take ~50s; the next ping will find it awake.
    Logger.log('keepAlive failed: ' + e.message);
  }
}

/** Run this once from the editor to check the connection. */
function testBackend() {
  var result = sendChatMessage('Say hello in one short sentence.', null);
  Logger.log(result);
}
