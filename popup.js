// ============================================
// FOCUS BLOCKER — popup.js
// Wires the UI to the background engine
// ============================================


// --------------------
// 1. GET UI ELEMENTS
// --------------------

const startBtn        = document.getElementById("startBtn");
const breakBtn        = document.getElementById("breakBtn");
const cancelBtn       = document.getElementById("cancelBtn");
const sessionControls = document.getElementById("sessionControls");
const duration        = document.getElementById("duration");
const timerDisplay    = document.getElementById("timerDisplay");
const siteInput       = document.getElementById("siteInput");
const addBtn          = document.getElementById("addBtn");
const blockList       = document.getElementById("blockList");

// --------------------
// DEV MODE
// Set to true to skip math challenges during testing.
// IMPORTANT: set back to false before publishing.
// --------------------
const DEV_MODE = true;

const ICON_BREAK = `<svg width="13" height="12" viewBox="0 0 13 12" fill="currentColor"><rect x="0" y="2" width="9" height="9" rx="1.5"/><path d="M9 4h1a2 2 0 010 4H9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><line x1="3" y1="1.5" x2="2.5" y2="0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="6" y1="1.5" x2="5.5" y2="0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const BREAK_MINUTES = 5;

const BUNDLES = [
  { id: "socials",  label: "📱 Socials",  sites: ["twitter.com", "x.com", "instagram.com", "facebook.com", "tiktok.com", "reddit.com", "snapchat.com", "linkedin.com"] },
  { id: "video",    label: "📺 Video",    sites: ["youtube.com", "netflix.com", "twitch.tv", "hulu.com", "disneyplus.com"] },
  { id: "news",     label: "📰 News",     sites: ["cnn.com", "bbc.com", "nytimes.com", "theguardian.com", "foxnews.com"] },
  { id: "shopping", label: "🛍 Shopping", sites: ["amazon.com", "ebay.com", "etsy.com", "aliexpress.com"] },
];


// --------------------
// 2. ON POPUP OPEN
// --------------------

document.addEventListener("DOMContentLoaded", async () => {
  checkIncognitoAccess();
  await loadSites();       // calls renderBundles internally
  await loadSession();
  await loadSessionControls();
});


// --------------------
// 3. LOADERS
// --------------------

async function loadSites() {
  const [sitesResp, sessionResp] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_SITES" }),
    chrome.runtime.sendMessage({ type: "GET_SESSION" })
  ]);
  const isLocked = !!sessionResp.session;
  renderSites(sitesResp.sites, isLocked);
  await renderBundles();
}

async function loadSession() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
  if (!resp.session) return;
  if (resp.session.onBreak) {
    startBreakCountdown(
      resp.session.breakEndsAt,
      resp.session.remainingMs,
      resp.session.minutes * 60 * 1000
    );
  } else {
    startCountdown(resp.session.endsAt, resp.session.minutes * 60 * 1000);
  }
}

async function loadSessionControls() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
  const hasSession = !!resp.session;
  sessionControls.style.display = hasSession ? "flex" : "none";
  startBtn.disabled = hasSession;
  if (hasSession) {
    breakBtn.disabled = !!resp.session.onBreak;
    timerDisplay.style.color = resp.session.onBreak ? "#f59e0b" : "#6366f1";
  }
}


// --------------------
// 4. RENDER BLOCK LIST
// --------------------

function renderSites(sites, isLocked) {
  blockList.innerHTML = "";

  if (sites.length === 0) {
    blockList.innerHTML = "<li style='color:#555; font-size:12px;'>No sites blocked yet</li>";
    return;
  }

  sites.forEach(site => {
    const li = document.createElement("li");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = site;
    li.appendChild(nameSpan);
    if (!isLocked) {
      const removeBtn = document.createElement("span");
      removeBtn.className = "remove-btn";
      removeBtn.dataset.site = site;
      removeBtn.textContent = "✕";
      li.appendChild(removeBtn);
    }
    blockList.appendChild(li);
  });

  if (!isLocked) {
    document.querySelectorAll(".remove-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const sessionResp = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
        if (sessionResp.session) { await loadSites(); return; }
        await chrome.runtime.sendMessage({ type: "REMOVE_SITE", site: btn.dataset.site });
        await loadSites();
      });
    });
  }

  const existingNotice = document.getElementById("lockNotice");
  if (existingNotice) existingNotice.remove();

  if (isLocked) {
    const notice = document.createElement("p");
    notice.id = "lockNotice";
    notice.textContent = "🔒 Locked during session — you can add but not remove sites.";
    notice.style.cssText = "font-size:11px; color:#888; margin-top:6px;";
    blockList.parentElement.appendChild(notice);
  }
}


// --------------------
// 5. BUTTON LISTENERS
// --------------------

// Add a site
addBtn.addEventListener("click", async () => {
  const site = siteInput.value.trim();
  if (!site) return;
  const resp = await chrome.runtime.sendMessage({ type: "ADD_SITE", site });
  if (!resp.added) {
    const siteError = document.getElementById("siteError");
    siteError.textContent = "Already in your block list.";
    siteInput.classList.add("input-error");
    setTimeout(() => { siteError.textContent = ""; siteInput.classList.remove("input-error"); }, 2000);
    return;
  }
  siteInput.value = "";
  await loadSites();
});

siteInput.addEventListener("keydown", e => { if (e.key === "Enter") addBtn.click(); });

// Start session
startBtn.addEventListener("click", async () => {
  const minutes = parseInt(duration.value);
  if (!minutes || minutes < 1) return;
  await chrome.runtime.sendMessage({ type: "START_SESSION", minutes });
  const sessionResp = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
  startCountdown(sessionResp.session.endsAt, sessionResp.session.minutes * 60 * 1000);
  await loadSessionControls();
  await loadSites();
});

// Break — earn it by solving 1 problem
breakBtn.addEventListener("click", () => {
  showMathModal({
    problemCount: 1,
    title: `Earn a ${BREAK_MINUTES}-min break — solve this:`,
    onSuccess: async () => {
      await chrome.runtime.sendMessage({ type: "START_BREAK", breakMinutes: BREAK_MINUTES });
      const sessionResp = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
      startBreakCountdown(
        sessionResp.session.breakEndsAt,
        sessionResp.session.remainingMs,
        sessionResp.session.minutes * 60 * 1000
      );
      await loadSessionControls();
      await loadSites();
    }
  });
});

// Cancel — prove it by solving 3 problems
cancelBtn.addEventListener("click", () => {
  showMathModal({
    problemCount: 3,
    title: "Solve 3 problems to cancel.",
    onSuccess: async () => {
      if (window._countdownInterval) clearInterval(window._countdownInterval);
      await chrome.runtime.sendMessage({ type: "CANCEL_SESSION" });
      timerDisplay.textContent = "No active session";
      timerDisplay.style.color = "#6366f1";
      document.getElementById("progressTrack").style.display = "none";
      await loadSessionControls();
      await loadSites();
    }
  });
});


// --------------------
// 6. COUNTDOWN TIMERS
// --------------------

function startCountdown(endsAt, totalMs) {
  if (window._countdownInterval) clearInterval(window._countdownInterval);

  const progressTrack = document.getElementById("progressTrack");
  const progressBar   = document.getElementById("progressBar");
  progressTrack.style.display = "block";
  progressBar.style.transition = "none";
  timerDisplay.style.color = "#6366f1";

  function update() {
    const remaining = endsAt - Date.now();
    if (remaining <= 0) {
      timerDisplay.textContent = "No active session";
      timerDisplay.style.color = "#6366f1";
      progressBar.style.width = "0%";
      clearInterval(window._countdownInterval);
      setTimeout(() => { progressTrack.style.display = "none"; }, 600);
      sessionControls.style.display = "none";
      startBtn.disabled = false;
      showToast("Session complete! 🎉");
      loadSites();
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    timerDisplay.textContent = `⏱ ${mins}:${secs.toString().padStart(2, "0")} remaining`;
    if (totalMs) progressBar.style.width = `${(remaining / totalMs) * 100}%`;
  }

  update();
  requestAnimationFrame(() => { progressBar.style.transition = "width 1s linear"; });
  window._countdownInterval = setInterval(update, 1000);
}

function startBreakCountdown(breakEndsAt, sessionRemainingMs, sessionTotalMs) {
  if (window._countdownInterval) clearInterval(window._countdownInterval);

  const progressTrack = document.getElementById("progressTrack");
  const progressBar   = document.getElementById("progressBar");
  progressTrack.style.display = "block";
  progressBar.style.transition = "none";
  // Bar stays frozen at the session's remaining percentage during break
  progressBar.style.width = `${(sessionRemainingMs / sessionTotalMs) * 100}%`;
  timerDisplay.style.color = "#f59e0b"; // amber

  function update() {
    const remaining = breakEndsAt - Date.now();
    if (remaining <= 0) {
      clearInterval(window._countdownInterval);
      // End break — background alarm may have already done this; endBreak is idempotent
      chrome.runtime.sendMessage({ type: "END_BREAK" }).then(async () => {
        const sessionResp = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
        if (sessionResp.session && !sessionResp.session.onBreak) {
          startCountdown(sessionResp.session.endsAt, sessionResp.session.minutes * 60 * 1000);
        }
        await loadSessionControls();
        await loadSites();
      });
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    timerDisplay.textContent = `☕ Break — ${mins}:${secs.toString().padStart(2, "0")} left`;
  }

  update();
  window._countdownInterval = setInterval(update, 1000);
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}


// --------------------
// 7. MATH CHALLENGE
// --------------------

let mathModalState = null;

function generateMathProblem() {
  const type = Math.floor(Math.random() * 4);
  switch (type) {
    case 0: { // two-digit multiplication
      const a = Math.floor(Math.random() * 20) + 12; // 12–31
      const b = Math.floor(Math.random() * 14) + 8;  // 8–21
      return { question: `${a} × ${b}`, answer: a * b };
    }
    case 1: { // clean division
      const divisor  = Math.floor(Math.random() * 8)  + 4;  // 4–11
      const quotient = Math.floor(Math.random() * 15) + 8;  // 8–22
      return { question: `${divisor * quotient} ÷ ${divisor}`, answer: quotient };
    }
    case 2: { // percentage
      const pcts = [15, 20, 25, 30, 35, 40];
      const pct  = pcts[Math.floor(Math.random() * pcts.length)];
      const val  = (Math.floor(Math.random() * 10) + 2) * 20; // multiples of 20
      return { question: `${pct}% of ${val}`, answer: (pct * val) / 100 };
    }
    default: { // algebra: ax + b = c, find x
      const a = Math.floor(Math.random() * 5) + 2;  // 2–6
      const x = Math.floor(Math.random() * 10) + 3; // 3–12
      const b = Math.floor(Math.random() * 15) + 5; // 5–19
      return { question: `${a}x + ${b} = ${a * x + b},  find x`, answer: x };
    }
  }
}

function showMathModal({ problemCount, title, onSuccess }) {
  if (DEV_MODE) { onSuccess(); return; }
  mathModalState = {
    problems: Array.from({ length: problemCount }, generateMathProblem),
    current: 0,
    onSuccess
  };
  document.getElementById("mathModalTitle").textContent = title;
  document.getElementById("mathModal").style.display = "flex";
  renderMathProblem();
}

function renderMathProblem() {
  const { problems, current } = mathModalState;
  document.getElementById("mathStep").textContent =
    problems.length > 1 ? `Problem ${current + 1} of ${problems.length}` : "";
  document.getElementById("mathQuestion").textContent = problems[current].question;
  document.getElementById("mathFeedback").textContent = "";
  const input = document.getElementById("mathInput");
  input.value = "";
  input.focus();
}

function checkMathAnswer() {
  if (!mathModalState) return;
  const { problems, current, onSuccess } = mathModalState;
  const input  = document.getElementById("mathInput");
  const answer = parseFloat(input.value);
  if (isNaN(answer)) return;

  if (answer === problems[current].answer) {
    if (current + 1 < problems.length) {
      mathModalState.current++;
      renderMathProblem();
    } else {
      closeMathModal();
      onSuccess();
    }
  } else {
    document.getElementById("mathFeedback").textContent = "Not quite — try again.";
    input.value = "";
    input.focus();
  }
}

function closeMathModal() {
  mathModalState = null;
  document.getElementById("mathModal").style.display = "none";
}

document.getElementById("mathCheck").addEventListener("click", checkMathAnswer);
document.getElementById("mathInput").addEventListener("keydown", e => { if (e.key === "Enter") checkMathAnswer(); });
document.getElementById("mathAbort").addEventListener("click", closeMathModal);


// --------------------
// 8. BUNDLES
// --------------------

async function renderBundles() {
  const [sitesResp, sessionResp] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_SITES" }),
    chrome.runtime.sendMessage({ type: "GET_SESSION" })
  ]);
  const blocked  = new Set(sitesResp.sites);
  const isLocked = !!sessionResp.session;
  const container = document.getElementById("bundleChips");
  container.innerHTML = "";

  BUNDLES.forEach(bundle => {
    const allAdded  = bundle.sites.every(s => blocked.has(s));
    const someAdded = !allAdded && bundle.sites.some(s => blocked.has(s));

    let cls = "bundle-chip";
    if (allAdded)       cls += " added";
    else if (someAdded) cls += " partial";
    if (allAdded && isLocked) cls += " locked";

    const chip = document.createElement("button");
    chip.className = cls;
    chip.textContent = bundle.label;
    chip.title = bundle.sites.join(", ");

    chip.addEventListener("click", async () => {
      const [sr, sessionR] = await Promise.all([
        chrome.runtime.sendMessage({ type: "GET_SITES" }),
        chrome.runtime.sendMessage({ type: "GET_SESSION" })
      ]);
      const currentBlocked  = new Set(sr.sites);
      const currentAllAdded = bundle.sites.every(s => currentBlocked.has(s));
      if (currentAllAdded && !!sessionR.session) return; // locked during session

      if (currentAllAdded) {
        for (const site of bundle.sites) await chrome.runtime.sendMessage({ type: "REMOVE_SITE", site });
      } else {
        for (const site of bundle.sites) await chrome.runtime.sendMessage({ type: "ADD_SITE", site });
      }
      await loadSites();
    });

    container.appendChild(chip);
  });
}


// --------------------
// 9. INCOGNITO CHECK
// --------------------

function checkIncognitoAccess() {
  chrome.extension.isAllowedIncognitoAccess(isAllowed => {
    if (!isAllowed) document.getElementById("incognitoWarning").style.display = "block";
  });
}
