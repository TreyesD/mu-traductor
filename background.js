// Translation service worker: Gemini (with game context) first,
// then Google (unofficial) and MyMemory as fallbacks.
const DEFAULT_MODEL = "gemini-flash-lite-latest";
const cache = new Map();
const thinkingVariant = {};

const GLOSSARY = `Game: MU Online (OpenMU server, Season 6), Brazilian players, chat in Brazilian Portuguese gamer slang.
Common terms: pt/party = group; gr/grupo = party; guild/gremio = guild; siege = castle siege (guild war);
buffar/bufa/buffer = give buffs (Elf buffer); bless/soul/chaos = jewels (Jewel of Bless/Soul/Chaos);
zen = in-game money; drop = item drop; farmar/farm = grind monsters; lvl/lv = level; res/reset = reset;
bc = Blood Castle; cc = Chaos Castle; ds = Devil Square; kalima, lorencia, noria, devias, atlans, tarkan = maps;
sm = Soul Master, bk = Blade Knight, me/elf = Muse Elf, mg = Magic Gladiator, dl = Dark Lord, sum = Summoner, rf = Rage Fighter;
exc = excellent item; anc = ancient item; +11/+13 = item level; vip = premium status.
Chat slang: vc = voce, pq = porque, blz = beleza (ok), tmj = estamos juntos (thanks/bro), vlw = valeu (thanks),
fds = (vulgar) damn, kkk/rs = laughter, bora = let's go, mano/cara = dude, tá = ok, tô = I am, pra = para, n/nao = no,
s/sim = yes, flw = see you, brb = already back soon, afk = away, noob/lixo = bad player, ksk/krl = expletives.`;

async function getSettings() {
  const s = await chrome.storage.local.get(["geminiKey", "geminiModel", "useLocal"]);
  return {
    key: s.geminiKey || "",
    model: s.geminiModel || DEFAULT_MODEL,
    useLocal: s.useLocal === true, // local mode (agy CLI) is slow; off unless enabled
  };
}

function buildSystem(incoming) {
  return incoming
    ? `${GLOSSARY}

You translate chat lines from a Brazilian MU Online server into natural Latin American Spanish.
Convey the real meaning (expand slang and abbreviations), keep it short, keep player names and item names as is.
Use the previous chat lines only as context to understand references. Reply with ONLY the Spanish translation.
If the message is already in Spanish, reply with exactly "=".`
    : `${GLOSSARY}

You translate Spanish chat messages written by a player into natural Brazilian Portuguese as a MU Online player would type it
(casual, short, common gamer abbreviations are fine, keep game terms like party, siege, drop, buff). Reply with ONLY the Portuguese text.`;
}

async function viaGemini(text, sl, tl, context, settings) {
  const incoming = tl === "es";
  const system = buildSystem(incoming);

  const ctx = context && context.length ? "Previous chat lines:\n" + context.join("\n") + "\n\n" : "";
  const prompt = ctx + (incoming ? "Message to translate:\n" : "Message to translate:\n") + text;

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(settings.model) + ":generateContent";
  const call = (genCfg) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": settings.key },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: genCfg,
      }),
    });
  // Thinking off = much faster. Retry without it if the model rejects the option.
  // Remember which thinking option this model accepts, to avoid retry latency.
  const base = { temperature: 0.2, maxOutputTokens: 300 };
  const variants = [
    { thinkingConfig: { thinkingBudget: 0 } },
    { thinkingConfig: { thinkingLevel: "minimal" } },
    {},
  ];
  const t0 = Date.now();
  let r;
  for (let n = thinkingVariant[settings.model] ?? 0; n < variants.length; n++) {
    r = await call({ ...base, ...variants[n] });
    if (r.status !== 400) {
      thinkingVariant[settings.model] = n;
      break;
    }
  }
  const ms = Date.now() - t0;
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json()).error.message; } catch (_) {}
    throw new Error("gemini " + r.status + " " + detail);
  }
  const j = await r.json();
  const out = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!out) throw new Error("gemini empty response");
  if (incoming && out === "=") return { text: text, lang: "es", engine: "gemini", ms };
  return { text: out, lang: incoming ? "pt" : "es", engine: "gemini", ms };
}

// Traductor local (MU Translator.bat): usa Antigravity CLI con la suscripcion de Google.
const LOCAL_URL = "http://127.0.0.1:3777/translate";

async function viaLocal(text, sl, tl, context) {
  const incoming = tl === "es";
  const t0 = Date.now();
  const r = await fetch(LOCAL_URL, {
    signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system: buildSystem(incoming), context: context || [], text }),
  });
  let j = {};
  try { j = await r.json(); } catch (_) {}
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  const out = (j.translation || "").trim();
  if (!out) throw new Error("respuesta vacia");
  const ms = Date.now() - t0;
  if (incoming && out === "=") return { text: text, lang: "es", engine: "local", ms };
  return { text: out, lang: incoming ? "pt" : "es", engine: "local", ms };
}

async function viaGoogle(text, sl, tl) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=" +
    sl + "&tl=" + tl + "&q=" + encodeURIComponent(text);
  const r = await fetch(url);
  if (!r.ok) throw new Error("google " + r.status);
  const j = await r.json();
  return { text: j[0].map((s) => s[0]).join(""), lang: j[2] || sl, engine: "google" };
}

async function viaMyMemory(text, sl, tl) {
  const src = sl === "auto" ? "pt" : sl;
  const dst = tl === "pt" ? "pt-BR" : tl;
  const url =
    "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(text) + "&langpair=" + src + "|" + dst;
  const r = await fetch(url);
  if (!r.ok) throw new Error("mymemory " + r.status);
  const j = await r.json();
  if (j.responseStatus !== 200) throw new Error("mymemory " + j.responseStatus);
  return { text: j.responseData.translatedText, lang: src, engine: "mymemory" };
}

async function translate(text, sl, tl, context) {
  const key = sl + ">" + tl + ":" + text;
  if (cache.has(key)) return cache.get(key);
  const settings = await getSettings();
  let res;
  let geminiError = "";
  if (settings.useLocal) {
    try {
      res = await viaLocal(text, sl, tl, context);
    } catch (e) {
      geminiError = "local: " + String(e);
    }
  }
  if (!res && settings.key) {
    try {
      res = await viaGemini(text, sl, tl, context, settings);
    } catch (e) {
      geminiError = (geminiError ? geminiError + " | " : "") + String(e);
    }
  }
  if (!res) {
    try {
      res = await viaGoogle(text, sl, tl);
    } catch (_) {
      res = await viaMyMemory(text, sl, tl);
    }
    if (geminiError) res.geminiError = geminiError;
  }
  if (!res.geminiError) {
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    cache.set(key, res);
  }
  return res;
}

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "translate") {
    translate(msg.text, msg.sl, msg.tl, msg.context || [])
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
});

// One-time migration on update: the slow local mode and the heavier model
// were the old defaults; move existing installs to the fast setup.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "update") return;
  const s = await chrome.storage.local.get(["geminiModel", "migratedFast"]);
  if (s.migratedFast) return;
  const patch = { useLocal: false, migratedFast: true };
  if (!s.geminiModel || s.geminiModel === "gemini-flash-latest") patch.geminiModel = DEFAULT_MODEL;
  await chrome.storage.local.set(patch);
});
