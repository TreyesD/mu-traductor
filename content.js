// Inline chat translation (incoming) + ES->PT helper (outgoing).
(() => {
  if (window.__muTranslatorLoaded) return;
  window.__muTranslatorLoaded = true;

  const OWN_LANG = "es";
  const TARGET_OUT = "pt";
  // Matches "[Channel] [TAG] Name: message" and "[Channel] Name: message".
  const CHAT_RE = /^\s*\[[^\]]{1,24}\]\s*(?:\[[^\]]{1,24}\]\s*)?[^:\[\]\n]{1,32}:\s+([\s\S]+)$/;
  const SKIP_CHANNELS = /^\s*\[(Sistema|Aviso)\]/i;

  const ask = (text, sl, tl) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "translate", text, sl, tl }, (r) =>
          resolve(r && r.ok ? r : null)
        );
      } catch (_) {
        resolve(null);
      }
    });

  const style = document.createElement("style");
  style.textContent = `
    .mu-tr{display:block;color:#ffd75e;font-size:.85em;line-height:1.2;
      opacity:.95;margin-top:1px;pointer-events:none}
    #mu-tr-box{position:fixed;left:12px;bottom:70px;z-index:2147483647;
      display:none;width:340px;font:14px sans-serif}
    #mu-tr-box input{width:100%;box-sizing:border-box;padding:7px 9px;
      border:1px solid #ffd75e;border-radius:6px;background:#1b1209;color:#fff}
    #mu-tr-box small{display:block;color:#ffd75e;margin-top:3px}
  `;
  document.documentElement.appendChild(style);

  // ---------- Incoming ----------
  const done = new WeakSet();

  function candidateLine(el) {
    if (done.has(el) || el.closest(".mu-tr")) return null;
    if (el.children.length > 6) return null;
    const txt = el.textContent || "";
    if (txt.length < 8 || txt.length > 600) return null;
    if (SKIP_CHANNELS.test(txt)) return null;
    const m = CHAT_RE.exec(txt);
    return m ? m[1].trim() : null;
  }

  async function handle(el) {
    const body = candidateLine(el);
    if (!body) return;
    // Prefer the deepest matching element: skip if a child already matches.
    for (const c of el.children) if (candidateLine(c)) return;
    done.add(el);
    const r = await ask(body, "auto", OWN_LANG);
    if (!r || !r.text) { stats.fail++; return; }
    stats.ok++;
    if (r.lang === OWN_LANG) return;
    if (r.text.trim().toLowerCase() === body.toLowerCase()) return;
    const out = document.createElement("span");
    out.className = "mu-tr";
    out.textContent = "↳ " + r.text;
    el.appendChild(out);
  }

  function scan(root) {
    if (root.nodeType !== 1) {
      if (root.parentElement) handle(root.parentElement);
      return;
    }
    handle(root);
    root.querySelectorAll("*").forEach(handle);
    if (root.parentElement) handle(root.parentElement);
  }

  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.target && m.target.closest && m.target.closest(".mu-tr")) continue;
      m.addedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.classList.contains("mu-tr")) return;
        scan(n);
      });
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  // Periodic deep scan (also walks open shadow roots), as a safety net.
  const stats = { seen: 0, ok: 0, fail: 0 };
  const badge = document.createElement("div");
  badge.style.cssText =
    "position:fixed;right:6px;bottom:4px;z-index:2147483647;font:11px sans-serif;" +
    "color:#ffd75e;background:rgba(0,0,0,.6);padding:2px 6px;border-radius:4px;pointer-events:none";
  document.documentElement.appendChild(badge);

  function walk(root, fn) {
    const els = root.querySelectorAll("*");
    for (const el of els) {
      fn(el);
      if (el.shadowRoot) walk(el.shadowRoot, fn);
    }
  }
  function deepScan() {
    walk(document, (el) => {
      if (candidateLine(el)) stats.seen++;
      handle(el);
    });
    badge.textContent =
      "MU-T: lines " + stats.seen + " | ok " + stats.ok + " | err " + stats.fail;
  }
  setInterval(deepScan, 1500);

  // ---------- Outgoing ----------
  const box = document.createElement("div");
  box.id = "mu-tr-box";
  box.innerHTML =
    '<input type="text" placeholder="Escribe en español → Enter" />' +
    "<small></small>";
  document.documentElement.appendChild(box);
  const boxInput = box.querySelector("input");
  const boxNote = box.querySelector("small");

  function setNativeValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function findGameInput() {
    const all = document.querySelectorAll("input[type=text],input:not([type]),textarea");
    for (const i of all) {
      if (i === boxInput) continue;
      const ph = (i.placeholder || "").toLowerCase();
      if (/enter|hablar|falar|chat/.test(ph)) return i;
    }
    return null;
  }

  async function translateOut(text) {
    const r = await ask(text, OWN_LANG, TARGET_OUT);
    return r && r.text ? r.text : null;
  }

  // Floating box: Alt+T toggles; Enter translates and fills the game chat.
  document.addEventListener(
    "keydown",
    async (e) => {
      if (e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        const show = box.style.display !== "block";
        box.style.display = show ? "block" : "none";
        if (show) boxInput.focus();
        return;
      }
      if (e.target === boxInput) {
        e.stopPropagation();
        if (e.key === "Escape") {
          box.style.display = "none";
        } else if (e.key === "Enter") {
          e.preventDefault();
          const txt = boxInput.value.trim();
          if (!txt) return;
          boxNote.textContent = "...";
          const pt = await translateOut(txt);
          if (!pt) {
            boxNote.textContent = "Translation failed";
            return;
          }
          try { await navigator.clipboard.writeText(pt); } catch (_) {}
          const gi = findGameInput();
          if (gi) {
            setNativeValue(gi, pt);
            gi.focus();
            boxNote.textContent = pt + "  (listo: Enter para enviar)";
          } else {
            boxNote.textContent = pt + "  (copiado: Ctrl+V en el chat)";
          }
          boxInput.value = "";
          box.style.display = gi ? "none" : "block";
        }
        return;
      }
      // Ctrl+Enter inside the game chat input: translate its content in place.
      if (e.ctrlKey && e.key === "Enter" && e.target && e.target.tagName === "INPUT") {
        e.preventDefault();
        e.stopPropagation();
        const inp = e.target;
        const txt = inp.value.trim();
        if (!txt) return;
        const pt = await translateOut(txt);
        if (pt) setNativeValue(inp, pt);
      }
    },
    true
  );
})();
