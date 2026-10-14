/**
 * ste-checker.js — a deterministic, dependency-free linter for
 * ASD-STE100-style Simplified Technical English.
 *
 * It approximates the best-known STE writing rules. It is NOT the official
 * ASD-STE100 specification or dictionary (that document is published by ASD).
 *
 *   LENGTH        procedural sentence > 20 words, descriptive sentence > 25 words
 *   MULTI_ACTION  more than one instruction in one procedural sentence
 *   PASSIVE       passive voice (error in procedures, warning in descriptions)
 *   WORD          complex word or phrase that has a simple alternative
 *   DRIFT         two or more names for the same thing (engine / motor)
 *   ING           sentence starts with an -ing form ("Using the tool, …")
 *   FLUFF         filler, praise, hedging and chat padding
 *   PARAGRAPH     paragraph with more than 6 sentences
 *
 * Pure ES module: runs in the browser and in Node (node --test).
 */

export const LIMITS = { procedural: 20, descriptive: 25, paragraph: 6 };

// ── Vocabulary ────────────────────────────────────────────────────────────────

// Base form → simple alternative. Inflections (-s, -es, -ed, -d, -ing) are
// matched by baseForms().
export const UNAPPROVED = {
  utilize: "use", utilise: "use", utilization: "use",
  leverage: "use", employ: "use",
  commence: "start", initiate: "start",
  terminate: "stop", cease: "stop",
  ensure: "make sure", facilitate: "help", assist: "help", assistance: "help",
  additional: "more", additionally: "also",
  subsequently: "then", subsequent: "next",
  numerous: "many", sufficient: "enough", insufficient: "not enough",
  obtain: "get", purchase: "buy", attempt: "try", endeavor: "try", endeavour: "try",
  demonstrate: "show", indicate: "show", modify: "change", eliminate: "remove",
  perform: "do", possess: "have", require: "need", regarding: "about",
  however: "but", therefore: "thus / so", consequently: "so",
  optimal: "best", optimum: "best", inoperative: "does not operate",
  verify: "make sure / check", validate: "check", determine: "find",
  accomplish: "do", adequate: "enough", component: "part",
  functionality: "function", methodology: "method", optimize: "improve",
  optimise: "improve", individual: "each / one", various: "different",
};

export const PHRASES = {
  "prior to": "before",
  "in order to": "to",
  "due to the fact that": "because",
  "a number of": "some",
  "in the event that": "if",
  "at this point in time": "now",
  "with regard to": "about",
  "with respect to": "about",
  "is able to": "can",
  "are able to": "can",
  "make use of": "use",
  "in addition": "also",
  "as well as": "and",
  "take into account": "think about",
  "a large number of": "many",
  "in the process of": "(delete)",
};

export const FLUFF = [
  "great question", "good question", "it is important to note", "it's important to note",
  "it is worth noting", "it's worth noting", "keep in mind", "in conclusion", "in summary",
  "to summarize", "overall", "basically", "essentially", "simply", "just", "really",
  "actually", "very", "quite", "delve", "crucial", "seamless", "seamlessly", "robust",
  "comprehensive", "furthermore", "moreover", "i hope this helps", "hope this helps",
  "feel free to", "let me know", "certainly", "absolutely", "of course", "landscape",
  "tapestry", "plethora", "myriad", "game-changer", "game changer", "unlock",
  "dive into", "deep dive", "it's essential", "it is essential", "navigate",
];

// Each group = several names a writer tends to rotate for ONE thing.
export const DRIFT_GROUPS = [
  ["engine", "motor", "powerplant", "propulsion unit"],
  ["car", "vehicle", "automobile"],
  ["cable", "wire", "cord"],
  ["clamp", "clip", "jaw"],
  ["screw", "bolt", "fastener"],
  ["error", "fault", "defect", "bug"],
  ["folder", "directory"],
  ["setting", "option", "parameter", "configuration"],
  ["user", "customer", "end user"],
  ["function", "method", "subroutine"],
  ["chunk", "passage", "snippet", "segment"],
  ["vector database", "vector store", "vector db"],
  ["learning rate", "step size"],
  ["loss", "cost function", "objective function"],
  ["tube", "inner tube", "bladder"],
  ["tire", "tyre"],
  ["rim", "wheel rim"],
  ["router", "access point"],
  ["start", "begin", "launch", "commence", "initiate"],
  ["stop", "halt", "terminate", "cease"],
  ["check", "verify", "validate", "inspect", "examine"],
  ["remove", "delete", "erase"],
];

const IMPERATIVE = new Set((
  "add adjust apply attach calculate change check choose clean click close compare configure " +
  "connect copy create cut delete detach disable disconnect divide do don't download drain " +
  "enable enter examine find fill fit get give go hold inflate insert install keep let lift " +
  "load look loosen lower make measure monitor mount move multiply note open plug pour press " +
  "pull pump push put raise read record refer release remove repeat replace reset restart " +
  "return rotate run save select send set slide start stop switch take tap test tighten " +
  "touch try turn type unplug unscrew update use wait wash wear write always never"
).split(/\s+/));

const IRREGULAR_PP = new Set((
  "known done made given taken shown seen written built set put kept found held run sent " +
  "told left lost paid sold brought bought caught thought taught driven broken chosen frozen " +
  "spoken stolen worn torn shaken hidden forgotten gotten begun drawn grown thrown blown flown " +
  "cut hit let shut split spread fed led meant understood undone"
).split(/\s+/));

const ED_NOT_PASSIVE = new Set((
  "interested excited tired concerned supposed complicated sophisticated detailed limited " +
  "advanced red bed need speed feed seed shed hundred bred indeed"
).split(/\s+/));

const ING_OK = new Set((
  "during nothing something anything everything thing things string strings bring king " +
  "ring spring morning evening ceiling warning warnings bearing bearings wing wiring"
).split(/\s+/));

// ── Helpers ───────────────────────────────────────────────────────────────────

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termRe = t => new RegExp(`\\b${escRe(t).replace(/\s+/g, "\\s+")}(?:s|es)?\\b`, "gi");

export function countWords(s) {
  return (s.match(/[A-Za-z0-9][A-Za-z0-9'’\-./]*/g) || []).length;
}

function baseForms(w) {
  const f = new Set([w]);
  if (w.endsWith("s")) f.add(w.slice(0, -1));
  if (w.endsWith("es")) f.add(w.slice(0, -2));
  if (w.endsWith("ed")) { f.add(w.slice(0, -2)); f.add(w.slice(0, -1)); }
  if (w.endsWith("ing")) { f.add(w.slice(0, -3)); f.add(w.slice(0, -3) + "e"); }
  if (w.endsWith("ly")) f.add(w.slice(0, -2));
  return [...f];
}

function cleanInline(s) {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\s)\*(\S[^*]*\S)\*(?=\s|$|[.,;:!?])/g, "$1$2");
}

const ABBREV = /\b(e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|approx|Fig|No|St)\./g;
export function splitSentences(text) {
  const guarded = text.replace(ABBREV, m => m.replace(/\./g, "․"));
  return guarded
    .split(/(?<=[.!?])\s+(?=["'(\[]?[A-Z0-9])/)
    .map(s => s.replace(/․/g, ".").trim())
    .filter(s => countWords(s) > 0);
}

// ── Segmentation ──────────────────────────────────────────────────────────────

/**
 * Splits text into display lines and checkable sentence units.
 * lines: [{type:'blank'|'code'|'heading'|'text', raw?, text?, prefix?, label?, unitIds?}]
 * units: [{id, text, words, isStep, procedural, para, issues:[]}]
 */
export function segment(text) {
  const lines = [], units = [];
  let inCode = false, para = 0, prevType = "blank";

  for (const rawLine of String(text || "").replace(/\r/g, "").split("\n")) {
    if (/^\s*```/.test(rawLine)) { inCode = !inCode; lines.push({ type: "code", raw: rawLine }); continue; }
    if (inCode) { lines.push({ type: "code", raw: rawLine }); continue; }
    if (!rawLine.trim()) { lines.push({ type: "blank" }); if (prevType !== "blank") para++; prevType = "blank"; continue; }

    const trimmed = rawLine.trim();
    if (/^#{1,6}\s+/.test(trimmed) || /^\*\*[^*]+\*\*:?$/.test(trimmed)) {
      lines.push({ type: "heading", text: cleanInline(trimmed.replace(/^#{1,6}\s+/, "")) });
      para++; prevType = "heading"; continue;
    }

    let body = cleanInline(trimmed);
    let prefix = "", isStep = false, isList = false, label = "";
    let m;
    if ((m = body.match(/^(?:step\s+\d+\s*[:.\-–]\s*|\d+[.)]\s+)/i))) { prefix = m[0]; isStep = true; }
    else if ((m = body.match(/^(?:[-*•+]|[a-z][.)])\s+/))) { prefix = m[0]; isList = true; }
    body = body.slice(prefix.length);
    if ((m = body.match(/^(WARNING|CAUTION|NOTE)\s*[:\-–]\s*/i))) { label = m[0]; body = body.slice(label.length); }

    // Short label line such as "What you need:" → heading.
    if (!prefix && !label && /:$/.test(body) && countWords(body) <= 8) {
      lines.push({ type: "heading", text: body }); para++; prevType = "heading"; continue;
    }

    if (isStep || isList || prevType !== "text") para++;
    const unitIds = [];
    for (const s of splitSentences(body)) {
      const first = (s.match(/[A-Za-z']+/) || [""])[0].toLowerCase();
      const procedural = isStep || IMPERATIVE.has(first) || /^do not\b/i.test(s);
      const id = units.length;
      units.push({ id, text: s, words: countWords(s), isStep, procedural, para, issues: [] });
      unitIds.push(id);
    }
    lines.push({ type: "text", prefix, label, unitIds });
    prevType = isStep || isList ? "list" : "text";
  }
  return { lines, units };
}

// ── Checks ────────────────────────────────────────────────────────────────────

const VERB_ALT = [...IMPERATIVE].filter(v => !["always", "never", "do", "don't"].includes(v)).join("|");
const MULTI_RE = new RegExp(`(?:\\b(?:and|then)\\b|;)\\s+(?:then\\s+)?(${VERB_ALT})\\b`, "i");
const PASSIVE_RE = /\b(am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?([a-z]+)\b/gi;

function checkUnit(u) {
  const lower = u.text.toLowerCase();
  const limit = u.procedural ? LIMITS.procedural : LIMITS.descriptive;

  if (u.words > limit) {
    u.issues.push({ type: "LENGTH", severity: "error",
      msg: `${u.words} words — max ${limit} for a ${u.procedural ? "procedural" : "descriptive"} sentence` });
  }

  if (u.procedural) {
    const mm = u.text.match(MULTI_RE);
    if (mm) u.issues.push({ type: "MULTI_ACTION", severity: "error", term: mm[1],
      msg: `More than one instruction ("… ${mm[0].trim()} …") — write one instruction per sentence` });
  }

  for (const pm of u.text.matchAll(PASSIVE_RE)) {
    const pp = pm[2].toLowerCase();
    const isPP = (pp.endsWith("ed") && !ED_NOT_PASSIVE.has(pp)) || IRREGULAR_PP.has(pp);
    if (isPP) {
      u.issues.push({ type: "PASSIVE", severity: u.procedural ? "error" : "warn", term: `${pm[1]} ${pm[2]}`,
        msg: `Passive voice ("${pm[0]}") — use the active voice` });
      break;
    }
  }

  const firstWord = (u.text.match(/^[^A-Za-z]*([A-Za-z]+)/) || [])[1] || "";
  if (/ing$/i.test(firstWord) && firstWord.length > 4 && !ING_OK.has(firstWord.toLowerCase())) {
    u.issues.push({ type: "ING", severity: "warn", term: firstWord,
      msg: `Starts with an -ing form ("${firstWord}") — STE avoids -ing constructions` });
  }

  const seen = new Set();
  for (const tok of u.text.match(/[A-Za-z]+/g) || []) {
    const low = tok.toLowerCase();
    if (seen.has(low)) continue;
    const hit = baseForms(low).find(f => UNAPPROVED[f]);
    if (hit) {
      seen.add(low);
      u.issues.push({ type: "WORD", severity: "error", term: tok, suggest: UNAPPROVED[hit],
        msg: `"${tok}" → use "${UNAPPROVED[hit]}"` });
    }
  }
  for (const [ph, alt] of Object.entries(PHRASES)) {
    if (termRe(ph).test(lower)) u.issues.push({ type: "WORD", severity: "error", term: ph, suggest: alt,
      msg: `"${ph}" → use "${alt}"` });
  }

  const fluffHits = [];
  for (const f of [...FLUFF].sort((a, b) => b.length - a.length)) {
    if (fluffHits.some(h => h.includes(f))) continue; // "hope this helps" inside "i hope this helps"
    const re = new RegExp(`(^|[^a-z'])${escRe(f)}(?![a-z])`, "i");
    if (re.test(lower) && fluffHits.push(f)) u.issues.push({ type: "FLUFF", severity: "warn", term: f,
      msg: `Filler: "${f}" — delete it` });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function lint(text) {
  const { lines, units } = segment(text);
  units.forEach(checkUnit);

  // Synonym drift (document level)
  const all = units.map(u => u.text).join(" ");
  const docIssues = [];
  for (const group of DRIFT_GROUPS) {
    const counts = {};
    for (const term of group) {
      // Do not count a short member inside a longer member ("tube" in "inner tube").
      let src = all;
      for (const longer of group) if (longer !== term && longer.includes(term)) src = src.replace(termRe(longer), " ");
      const n = (src.match(termRe(term)) || []).length;
      if (n) counts[term] = n;
    }
    const used = Object.keys(counts);
    if (used.length >= 2) {
      const keep = used.sort((a, b) => counts[b] - counts[a])[0];
      docIssues.push({ type: "DRIFT", severity: "error", terms: counts, keep,
        msg: `Synonym drift: ${used.map(t => `"${t}" ×${counts[t]}`).join(", ")} — use only "${keep}"` });
      for (const u of units) for (const t of used) {
        if (t === keep) continue;
        const m = u.text.match(termRe(t));
        if (m) u.issues.push({ type: "DRIFT_TERM", severity: "warn", term: m[0], suggest: keep,
          msg: `"${m[0]}" is another name for "${keep}" — use "${keep}"` });
      }
    }
  }

  // Paragraph length (plain text paragraphs only)
  const byPara = {};
  for (const u of units) if (!u.isStep) (byPara[u.para] ||= []).push(u);
  for (const list of Object.values(byPara)) {
    if (list.length > LIMITS.paragraph) docIssues.push({ type: "PARAGRAPH", severity: "warn", count: list.length,
      msg: `Paragraph has ${list.length} sentences — max ${LIMITS.paragraph}` });
  }

  // Metrics
  const n = units.length;
  const words = units.reduce((a, u) => a + u.words, 0);
  const has = (u, t) => u.issues.some(i => i.type === t);
  const metrics = {
    words,
    sentences: n,
    procedural: units.filter(u => u.procedural).length,
    avgWords: n ? +(words / n).toFixed(1) : 0,
    maxWords: n ? Math.max(...units.map(u => u.words)) : 0,
    overLimit: units.filter(u => has(u, "LENGTH")).length,
    multiAction: units.filter(u => has(u, "MULTI_ACTION")).length,
    passive: units.filter(u => has(u, "PASSIVE")).length,
    unapproved: units.reduce((a, u) => a + u.issues.filter(i => i.type === "WORD").length, 0),
    drift: docIssues.filter(i => i.type === "DRIFT").length,
    fluff: units.reduce((a, u) => a + u.issues.filter(i => i.type === "FLUFF").length, 0),
    ing: units.filter(u => has(u, "ING")).length,
    longParas: docIssues.filter(i => i.type === "PARAGRAPH").length,
  };

  // Score: share of sentences with no error-level issue, minus document penalties.
  const clean = units.filter(u => !u.issues.some(i => i.severity === "error")).length;
  const base = n ? (clean / n) * 100 : 0;
  const penalty = 6 * metrics.drift + Math.min(15, 1.5 * metrics.fluff) + 3 * metrics.longParas;
  const score = n ? Math.max(0, Math.min(100, Math.round(base - penalty))) : 0;
  const grade = score >= 90 ? "STE-ready" : score >= 70 ? "Close" : score >= 40 ? "Needs work" : "Not STE";

  return { lines, units, docIssues, metrics, score, grade };
}

/** Converts lint findings into short, STE-style fix instructions for a repair prompt. */
export function repairInstructions(result, max = 12) {
  const out = [], seen = new Set();
  const push = s => { if (!seen.has(s) && out.length < max) { seen.add(s); out.push(s); } };
  const head = t => t.split(/\s+/).slice(0, 7).join(" ") + "…";

  for (const d of result.docIssues) {
    if (d.type === "DRIFT") push(`You use ${Object.keys(d.terms).map(t => `"${t}"`).join(", ")} for the same thing. Use only "${d.keep}".`);
  }
  for (const u of result.units) for (const i of u.issues) {
    if (i.type === "LENGTH") push(`The sentence "${head(u.text)}" has ${u.words} words. Split it into sentences of ${u.procedural ? 20 : 25} words or less.`);
    if (i.type === "MULTI_ACTION") push(`The sentence "${head(u.text)}" has more than one instruction. Write one instruction per sentence.`);
    if (i.type === "PASSIVE" && u.procedural) push(`The sentence "${head(u.text)}" uses the passive voice. Use the active, command form.`);
    if (i.type === "WORD") push(`Replace "${i.term}" with "${i.suggest}".`);
  }
  for (const u of result.units) for (const i of u.issues) if (i.type === "FLUFF") push(`Delete the filler word "${i.term}".`);
  for (const d of result.docIssues) if (d.type === "PARAGRAPH") push(`A paragraph has ${d.count} sentences. Use 6 sentences or less.`);
  return out;
}
