// ============================================
// FOCUS BLOCKER — background.js
// Runs silently in the background at all times
// ============================================


// --------------------
// 1. CONSTANTS
// --------------------

const RULE_ID_START = 1; // Each blocked site needs a unique rule ID


// --------------------
// 2. LOAD STATE ON STARTUP
// --------------------
// When Chrome starts or the extension reloads,
// re-apply whatever rules were saved previously.

chrome.runtime.onStartup.addListener(() => {
  rebuildRules();
});

chrome.runtime.onInstalled.addListener(() => {
  rebuildRules();
});


// --------------------
// 3. MESSAGE LISTENER
// --------------------
// popup.js can't touch the block rules directly.
// It sends messages here and we handle them.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "ADD_SITE") {
    addSite(message.site).then(added => sendResponse({ added }));
    return true; // keeps the channel open for async response
  }

  if (message.type === "REMOVE_SITE") {
    removeSite(message.site).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "GET_SITES") {
    getSites().then(sites => sendResponse({ sites }));
    return true;
  }

  if (message.type === "SET_BLOCKING") {
    setBlocking(message.enabled).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "START_SESSION") {
    startSession(message.minutes).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "GET_SESSION") {
    getSession().then(session => sendResponse({ session }));
    return true;
  }

  if (message.type === "PAUSE_SESSION") {
    pauseSession().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "RESUME_SESSION") {
    resumeSession(message.remainingMs).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "CANCEL_SESSION") {
    cancelSession().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "START_BREAK") {
    startBreak(message.breakMinutes).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "END_BREAK") {
    endBreak().then(() => sendResponse({ success: true }));
    return true;
  }

});


// --------------------
// 4. STORAGE HELPERS
// --------------------
// All data is saved in Chrome's built-in storage
// so settings persist when the popup closes.

async function getSites() {
  const data = await chrome.storage.local.get("blockedSites");
  return data.blockedSites || [];
}

async function saveSites(sites) {
  await chrome.storage.local.set({ blockedSites: sites });
}

async function isBlockingEnabled() {
  const data = await chrome.storage.local.get("blockingEnabled");
  return data.blockingEnabled || false;
}

async function setBlocking(enabled) {
  await chrome.storage.local.set({ blockingEnabled: enabled });
  await rebuildRules();
}


// --------------------
// 5. ADD / REMOVE SITES
// --------------------

async function addSite(site) {
  const sites = await getSites();
  const cleaned = site.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (!cleaned || sites.includes(cleaned)) return false;
  sites.push(cleaned);
  await saveSites(sites);
  await rebuildRules();
  return true;
}

async function removeSite(site) {
  let sites = await getSites();
  sites = sites.filter(s => s !== site);
  await saveSites(sites);
  await rebuildRules();
}


// --------------------
// 6. THE BLOCK RULES ENGINE
// --------------------
// This is the core — it tells Chrome which URLs to block.
// We clear all old rules and rebuild fresh every time.

async function rebuildRules() {
  const enabled = await isBlockingEnabled();
  const sites = await getSites();

  // Remove all existing rules first
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const existingIds = existingRules.map(r => r.id);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingIds
  });

  // If blocking is off, stop here — don't add any new rules
  if (!enabled || sites.length === 0) return;

  // Build one rule per blocked site
  const rules = sites.map((site, index) => ({
    id: RULE_ID_START + index,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        url: chrome.runtime.getURL("blocked.html") + "?site=" + encodeURIComponent(site)
      }
    },
    condition: {
      urlFilter: `||${site}`,
      resourceTypes: ["main_frame"] // only block full page loads, not images/scripts
    }
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: rules
  });
}


// --------------------
// 7. SESSION TIMER
// --------------------
// Uses Chrome's alarms API — survives even if the popup closes.

async function startSession(minutes) {
  const endsAt = Date.now() + minutes * 60 * 1000;
  await chrome.storage.local.set({ session: { endsAt, minutes } });
  await setBlocking(true);

  // Clear any old alarm, set a new one
  await chrome.alarms.clear("sessionEnd");
  await chrome.alarms.create("sessionEnd", { delayInMinutes: minutes });
}

async function getSession() {
  const data = await chrome.storage.local.get("session");
  return data.session || null;
}

// When the alarm fires, turn off blocking automatically
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "sessionEnd") {
    await setBlocking(false);
    await chrome.storage.local.remove("session");
  }
  if (alarm.name === "breakEnd") {
    await endBreak();
  }
});

async function pauseSession() {
  const data = await chrome.storage.local.get("session");
  if (!data.session) return;
  const remainingMs = data.session.endsAt - Date.now();
  await chrome.storage.local.set({
    session: { ...data.session, paused: true, remainingMs }
  });
  await chrome.alarms.clear("sessionEnd");
  await setBlocking(false);
}

async function resumeSession(remainingMs) {
  const data = await chrome.storage.local.get("session");
  if (!data.session) return;
  const endsAt = Date.now() + remainingMs;
  await chrome.storage.local.set({
    session: { ...data.session, paused: false, remainingMs: null, endsAt }
  });
  await chrome.alarms.create("sessionEnd", { delayInMinutes: remainingMs / 60000 });
  await setBlocking(true);
}

async function cancelSession() {
  await chrome.alarms.clear("sessionEnd");
  await chrome.alarms.clear("breakEnd");
  await chrome.storage.local.remove("session");
  await setBlocking(false);
}

async function startBreak(breakMinutes) {
  const data = await chrome.storage.local.get("session");
  if (!data.session) return;
  const remainingMs = data.session.endsAt - Date.now();
  const breakEndsAt = Date.now() + breakMinutes * 60 * 1000;
  await chrome.storage.local.set({
    session: { ...data.session, onBreak: true, remainingMs, breakEndsAt }
  });
  await chrome.alarms.clear("sessionEnd");
  await chrome.alarms.create("breakEnd", { delayInMinutes: breakMinutes });
  await setBlocking(false);
}

async function endBreak() {
  const data = await chrome.storage.local.get("session");
  if (!data.session?.onBreak) return; // idempotent — safe to call twice
  const endsAt = Date.now() + data.session.remainingMs;
  await chrome.storage.local.set({
    session: { ...data.session, onBreak: false, breakEndsAt: null, endsAt }
  });
  await chrome.alarms.create("sessionEnd", { delayInMinutes: data.session.remainingMs / 60000 });
  await setBlocking(true);
}