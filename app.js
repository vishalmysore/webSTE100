/**
 * app.js — webSTE100
 *
 * Left panel  — the model with a plain system prompt (or the user's original text).
 * Right panel — the SAME model with an ASD-STE100 system prompt, then a
 *               lint-and-repair loop: a deterministic linter lists every rule
 *               break, the model rewrites, and the best-scoring draft is kept.
 *
 * One MLCEngine is shared by both panels, so the only variable is the prompt.
 */

// Same pinned runtime as webSLMDemo. Imported lazily on "Load model", so the
// linter works even without WebGPU or a network connection to the CDN.
const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.79";
let webllm = null;
import { lint, repairInstructions } from "./ste-checker.js";

// ── Models ────────────────────────────────────────────────────────────────────
const MODELS = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 1.5B ✓ recommended", size: "~1.1 GB", safe: true },
  { id: "Qwen2-0.5B-Instruct-q4f16_1-MLC",   label: "Qwen2 0.5B (fast, weaker rule-following)", size: "~400 MB", safe: true },
  { id: "Llama-3.2-1B-Instruct-q4f32_1-MLC", label: "Llama 3.2 1B", size: "~0.9 GB", safe: true },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "⚠ Llama 3.2 3B (best output)", size: "~2 GB", safe: false },
];

// ── Prompts ───────────────────────────────────────────────────────────────────
const PLAIN_SYSTEM = "You are a helpful assistant.";

export const STE_SYSTEM = `You write in ASD-STE100 Simplified Technical English.
Obey these rules:
1. Write instructions as a numbered list. Write one instruction in each step.
2. Use the command form for instructions. Example: "Remove the cap."
3. Write a maximum of 20 words in an instruction. Write a maximum of 25 words in a description.
4. Use the active voice.
5. Use one name for one thing. Use the same name every time. Do not use synonyms.
6. Use simple, common words. Do not use: utilize, ensure, facilitate, leverage, commence, terminate, approximately, prior to, in order to.
7. Write a warning before the step it applies to. Start it with "WARNING:".
8. Do not write an introduction, praise or a summary. Start with the answer.
9. Write a maximum of 6 sentences in a paragraph.`;

const rewriteUser = text =>
  `Rewrite this text in ASD-STE100 Simplified Technical English. Keep every technical fact. Output only the rewritten text.\n\nTEXT:\n${text}`;

const repairUser = fixes =>
  `Your text breaks these STE rules:\n${fixes.map(f => `- ${f}`).join("\n")}\n\n` +
  `Rewrite the full text. Fix all of these problems. Keep every technical fact. Output only the rewritten text.`;

// ── Examples ──────────────────────────────────────────────────────────────────
const ASK_EXAMPLES = [
  "How do I jump-start a car with a dead battery?",
  "How do I replace a bicycle inner tube?",
  "How does the learning rate affect gradient descent?",
  "How does a RAG pipeline find the right chunks for a question?",
  "How do I reset a home Wi-Fi router to factory settings?",
];

const REWRITE_EXAMPLES = [
  { label: "Chatty LLM answer — jump-start", text:
`Great question! Jump-starting a car is actually quite simple, but it's important to note that you should always ensure safety first.

1. First, you'll want to position the donor vehicle close to your car and make sure both engines are turned off before you utilize the jumper cables.
2. Attach the red clamp to the positive terminal of the dead battery, and then connect the other red clip to the donor's positive terminal.
3. Next, the black cable should be connected to the donor's negative terminal, and the final clamp is attached to an unpainted metal surface on the dead automobile, away from the battery.
4. Start the motor of the working vehicle and let it run for approximately five minutes prior to attempting to start the disabled car.

I hope this helps! Let me know if you have any other questions.` },
  { label: "Chatty LLM answer — RAG", text:
`Retrieval-Augmented Generation (RAG) is a really powerful technique that essentially allows a language model to leverage external knowledge. When a question comes in, it is first converted into an embedding, which is basically a vector that captures its meaning, and this vector is then compared against the vectors of all the passages stored in the vector database in order to find the most relevant chunks. Subsequently, the top snippets are retrieved from the vector store and inserted into the prompt, which enables the model to generate an answer that is grounded in the retrieved segments. It's worth noting that the quality of the chunking strategy is crucial, because if the passages are too long, the retrieval can become noisy, and if they are too short, important context may be lost. Overall, RAG provides a robust and comprehensive way to reduce hallucinations.` },
];

// ── State ─────────────────────────────────────────────────────────────────────
let engine = null, ready = false, loadedId = null;
let mode = "ask";
let busy = false, stopRequested = false;
let lastLeft = null, lastRight = null;

const $ = id => document.getElementById(id);
const el = {
  modelSelect: $("modelSelect"), modelNote: $("modelNote"), loadBtn: $("loadBtn"), loadProg: $("loadProg"),
  repairSelect: $("repairSelect"), settingsToggle: $("settingsToggle"), settingsPanel: $("settingsPanel"),
  modeToggle: $("modeToggle"), copyPromptBtn: $("copyPromptBtn"),
  input: $("queryInput"), sendBtn: $("sendBtn"), lintBtn: $("lintBtn"), exampleBtns: $("exampleBtns"),
  delta: $("deltaStrip"), toast: $("toast"),
  statusL: $("statusL"), statusR: $("statusR"), progressL: $("progressL"), progressR: $("progressR"),
  bodyL: $("bodyL"), bodyR: $("bodyR"),
  badgeL: $("badgeL"), titleL: $("titleL"), subL: $("subL"),
};
let webgpuOK = false;

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // navigator.gpu can exist with no usable adapter (headless, blocklisted GPU).
  try { webgpuOK = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { webgpuOK = false; }

  MODELS.forEach(m => {
    const o = document.createElement("option");
    o.value = m.id; o.textContent = `${m.label} (${m.size})`;
    el.modelSelect.appendChild(o);
  });
  el.modelSelect.addEventListener("change", () => {
    updateModelNote();
    if (engine && el.modelSelect.value !== loadedId) {
      ready = false; setStatus("Model changed — click Load model.", 0); updateButtons();
    }
  });
  updateModelNote();

  el.loadBtn.addEventListener("click", loadModel);
  el.settingsToggle.addEventListener("click", () => el.settingsPanel.classList.toggle("open"));
  el.modeToggle.querySelectorAll("button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
  el.copyPromptBtn.addEventListener("click", copyPrompt);
  el.sendBtn.addEventListener("click", () => (busy ? requestStop() : handleSend()));
  el.lintBtn.addEventListener("click", lintOnly);
  el.input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && mode === "ask") { e.preventDefault(); if (!busy) handleSend(); }
  });

  if (!webgpuOK) {
    el.modelSelect.disabled = true; el.loadBtn.disabled = true;
    el.modelNote.textContent = "WebGPU is not available in this browser. Use Chrome or Edge 113+. The linter still works: switch to Rewrite text and press Lint only.";
    el.modelNote.style.color = "#f85149";
    setStatus("WebGPU not available — linter-only mode.", 0);
    setMode("rewrite");
    el.input.value = REWRITE_EXAMPLES[0].text;
    lintOnly();
  } else {
    renderExamples();
  }
  updateButtons();
}

function updateModelNote() {
  if (!webgpuOK) return;
  const m = MODELS.find(x => x.id === el.modelSelect.value);
  el.modelNote.textContent = m.safe ? "Downloads once, then loads from the browser cache." : `⚠ ${m.size} — needs a GPU with enough VRAM. If it crashes, use Qwen2.5 1.5B.`;
  el.modelNote.style.color = m.safe ? "" : "#d29922";
}

function updateButtons() {
  el.sendBtn.disabled = !busy && !ready;
  el.sendBtn.textContent = busy ? "Stop" : (mode === "ask" ? "Send" : "Rewrite");
  el.sendBtn.classList.toggle("stop", busy);
  el.lintBtn.disabled = busy;
  el.loadBtn.disabled = busy || !webgpuOK;
}

function setStatus(text, pct, side = "both") {
  if (side !== "R") { el.statusL.textContent = text; if (pct != null) el.progressL.style.width = pct + "%"; }
  if (side !== "L") { el.statusR.textContent = text; if (pct != null) el.progressR.style.width = pct + "%"; }
}

// ── Mode ──────────────────────────────────────────────────────────────────────
function setMode(m) {
  if (busy) return;
  mode = m;
  el.modeToggle.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.mode === m));
  const rewrite = m === "rewrite";
  el.lintBtn.style.display = rewrite ? "" : "none";
  el.input.rows = rewrite ? 7 : 1;
  el.input.placeholder = rewrite
    ? "Paste any text — an LLM answer, a README, a runbook. Lint only scores it now; Rewrite turns it into STE…"
    : "Ask a technical question — both panels answer with the same model…";
  el.badgeL.textContent = rewrite ? "Original" : "Plain";
  el.titleL.textContent = rewrite ? "Your original text" : "Default LLM output";
  el.subL.textContent = rewrite ? "No model — linted as pasted" : 'System prompt: "You are a helpful assistant."';
  el.input.value = "";
  renderExamples();
  updateButtons();
}

function renderExamples() {
  el.exampleBtns.innerHTML = "";
  const list = mode === "ask" ? ASK_EXAMPLES.map(q => ({ label: q, text: q })) : REWRITE_EXAMPLES;
  for (const ex of list) {
    const b = document.createElement("button");
    b.className = "example-btn"; b.textContent = ex.label;
    b.addEventListener("click", () => {
      el.input.value = ex.text; el.input.focus();
      if (mode === "rewrite") lintOnly();
    });
    el.exampleBtns.appendChild(b);
  }
}

// ── Model ─────────────────────────────────────────────────────────────────────
async function loadModel() {
  const id = el.modelSelect.value;
  const label = MODELS.find(m => m.id === id).label;
  ready = false; el.loadBtn.disabled = true; updateButtons();
  setStatus(`Loading ${label}…`, 0);
  const onProgress = r => {
    const pct = Math.round((r.progress || 0) * 100);
    setStatus(r.text, pct); el.loadProg.textContent = r.text;
  };
  try {
    webllm ||= await import(WEBLLM_URL);
    if (engine) { await engine.unload?.(); engine = null; }
    engine = new webllm.MLCEngine({ initProgressCallback: onProgress });
    await engine.reload(id);
    loadedId = id; ready = true;
    setStatus(`✓ ${label} — ready`, 100);
    el.loadProg.textContent = "";
    el.settingsPanel.classList.remove("open");
  } catch (err) {
    setStatus(`Failed: ${err.message}`, 0);
    el.loadProg.textContent = "";
    console.error(err);
  } finally {
    el.loadBtn.disabled = false; updateButtons();
  }
}

function requestStop() {
  stopRequested = true;
  try { engine?.interruptGenerate(); } catch { /* ignore */ }
}

async function generate(messages, outEl, scrollEl, opts = {}) {
  const stream = await engine.chat.completions.create({
    messages, stream: true,
    temperature: opts.temperature ?? 0.5, top_p: 0.9, max_tokens: opts.max_tokens ?? 640,
  });
  let text = "";
  outEl.classList.add("streaming");
  for await (const chunk of stream) {
    text += chunk.choices[0]?.delta?.content || "";
    outEl.textContent = text;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }
  outEl.classList.remove("streaming");
  return text.trim();
}

// ── Flows ─────────────────────────────────────────────────────────────────────
function lintOnly() {
  const text = el.input.value.trim();
  if (!text) return;
  const r = lint(text);
  lastLeft = r; lastRight = null;
  el.bodyL.innerHTML = "";
  el.bodyL.appendChild(scorecard(r));
  el.bodyL.appendChild(legend());
  el.bodyL.appendChild(annotated(r));
  el.bodyR.innerHTML = `<p class="empty">${ready ? "Press Rewrite to turn this text into STE." : "Load a model in Settings, then press Rewrite to turn this text into STE."}</p>`;
  renderDelta();
}

async function handleSend() {
  const input = el.input.value.trim();
  if (!input || busy || !ready) return;
  busy = true; stopRequested = false; updateButtons();
  lastLeft = lastRight = null; renderDelta();
  el.bodyL.innerHTML = ""; el.bodyR.innerHTML = "";

  try {
    let steUserMsg;
    if (mode === "ask") {
      el.bodyL.appendChild(bubble(input)); el.bodyR.appendChild(bubble(input));
      steUserMsg = input;

      // Left — plain prompt
      setStatus("Generating plain answer…", null, "L");
      const outL = outputBox(el.bodyL);
      const plain = await generate([{ role: "system", content: PLAIN_SYSTEM }, { role: "user", content: input }], outL, el.bodyL);
      lastLeft = lint(plain);
      showResult(el.bodyL, outL, lastLeft);
      setStatus(`Plain answer — STE score ${lastLeft.score}`, 100, "L");
      if (stopRequested) throw new Error("stopped");
    } else {
      lastLeft = lint(input);
      el.bodyL.appendChild(scorecard(lastLeft)); el.bodyL.appendChild(legend()); el.bodyL.appendChild(annotated(lastLeft));
      setStatus(`Original text — STE score ${lastLeft.score}`, 100, "L");
      steUserMsg = rewriteUser(input);
    }

    // Right — STE prompt + lint-and-repair loop
    const passes = +el.repairSelect.value;
    const history = [];
    const passBar = document.createElement("div"); passBar.className = "passes";
    const cardSlot = document.createElement("div");
    el.bodyR.appendChild(cardSlot); el.bodyR.appendChild(passBar);

    setStatus("Generating STE draft…", 0, "R");
    let out = outputBox(el.bodyR);
    let text = await generate([{ role: "system", content: STE_SYSTEM }, { role: "user", content: steUserMsg }], out, el.bodyR, { temperature: 0.4 });
    let r = lint(text);
    history.push({ name: "Draft", text, r });
    out.remove();

    for (let p = 1; p <= passes && !stopRequested; p++) {
      const best = bestOf(history);
      const fixes = repairInstructions(best.r);
      if (!fixes.length || best.r.score >= 98) break;
      renderPasses(passBar, history, cardSlot, null);
      setStatus(`Repair pass ${p}/${passes} — fixing ${fixes.length} rule break${fixes.length > 1 ? "s" : ""}…`, Math.round((p / (passes + 1)) * 100), "R");
      out = outputBox(el.bodyR);
      text = await generate([
        { role: "system", content: STE_SYSTEM },
        { role: "user", content: steUserMsg },
        { role: "assistant", content: best.text },
        { role: "user", content: repairUser(fixes) },
      ], out, el.bodyR, { temperature: 0.3 });
      out.remove();
      history.push({ name: `Pass ${p}`, text, r: lint(text), fixes });
    }

    const best = bestOf(history);
    lastRight = best.r;
    renderPasses(passBar, history, cardSlot, best);
    setStatus(`STE answer — score ${best.r.score} (${best.name})${stopRequested ? " — stopped" : ""}`, 100, "R");
    renderDelta();
  } catch (err) {
    if (err.message !== "stopped") {
      const p = document.createElement("p"); p.className = "empty"; p.textContent = `⚠ ${err.message}`;
      el.bodyR.appendChild(p); console.error(err);
    }
    setStatus(stopRequested ? "Stopped." : `Error: ${err.message}`, null, "R");
  } finally {
    busy = false; updateButtons();
  }
}

// Highest score wins; on a tie, the later (repaired) version wins.
const bestOf = h => h.reduce((a, b) => (b.r.score >= a.r.score ? b : a));

function renderPasses(bar, history, cardSlot, show) {
  const best = bestOf(history);
  const view = show || history[history.length - 1];
  bar.innerHTML = history.length > 1 || show ? "<span>Repair loop:</span>" : "";
  history.forEach((h, i) => {
    if (i) bar.insertAdjacentHTML("beforeend", "<span>→</span>");
    const c = document.createElement("span");
    c.className = "pass-chip" + (h === best ? " best" : "") + (h === view ? " viewing" : "");
    c.textContent = `${h.name}: ${h.r.score}`;
    c.title = h.fixes ? `Fixes sent:\n- ${h.fixes.join("\n- ")}` : "First draft from the STE prompt";
    c.addEventListener("click", () => renderPasses(bar, history, cardSlot, h));
    bar.appendChild(c);
  });
  cardSlot.innerHTML = "";
  cardSlot.appendChild(scorecard(view.r));
  // Replace the output below the pass bar.
  let next = bar.nextSibling;
  while (next) { const n = next.nextSibling; next.remove(); next = n; }
  el.bodyR.appendChild(legend());
  el.bodyR.appendChild(annotated(view.r));
}

// ── Rendering ─────────────────────────────────────────────────────────────────
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function bubble(text) { const d = document.createElement("div"); d.className = "question"; d.textContent = text; return d; }

function outputBox(parent) {
  const d = document.createElement("div"); d.className = "output streaming";
  d.innerHTML = '<div class="thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
  parent.appendChild(d); return d;
}

function showResult(body, outEl, r) {
  const card = scorecard(r);
  body.insertBefore(card, outEl);
  body.insertBefore(legend(), outEl);
  outEl.replaceWith(annotated(r));
}

function legend() {
  const d = document.createElement("div"); d.className = "legend";
  d.innerHTML = `
    <span><i class="sw" style="background:rgba(248,81,73,.35)"></i>rule break in sentence</span>
    <span><i class="sw" style="background:#f85149"></i>complex word</span>
    <span><i class="sw" style="background:#d29922"></i>synonym drift</span>
    <span><i class="sw" style="background:#8b949e"></i>filler</span>
    <span><b style="font-size:9px">²³</b> word count</span>`;
  return d;
}

function scoreColor(s) { return s >= 90 ? "var(--green)" : s >= 70 ? "var(--ste)" : s >= 40 ? "var(--amber)" : "var(--red)"; }

function scorecard(r) {
  const m = r.metrics;
  const metric = (k, v, bad) => `<div class="metric ${bad == null ? "" : bad ? "bad" : "ok"}"><span class="v">${v}</span><span class="k">${k}</span></div>`;
  const all = [
    ...r.docIssues.map(i => ({ ...i, where: "Whole text" })),
    ...r.units.flatMap(u => u.issues.map(i => ({ ...i, where: `S${u.id + 1}` }))),
  ];
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="scorecard">
      <div class="score-big">
        <span class="score-num" style="color:${scoreColor(r.score)}">${r.score}</span>
        <span class="score-grade" style="color:${scoreColor(r.score)}">${r.grade}</span>
      </div>
      <div class="metrics">
        ${metric("words", m.words)}
        ${metric("avg words / sent.", m.avgWords, m.avgWords > 20)}
        ${metric("over limit", m.overLimit, m.overLimit > 0)}
        ${metric("multi-action", m.multiAction, m.multiAction > 0)}
        ${metric("complex words", m.unapproved, m.unapproved > 0)}
        ${metric("synonym drift", m.drift, m.drift > 0)}
        ${metric("passive", m.passive, m.passive > 0)}
        ${metric("filler", m.fluff, m.fluff > 0)}
      </div>
    </div>
    ${all.length ? `<details class="findings"><summary>${all.length} finding${all.length > 1 ? "s" : ""}</summary><ul>
      ${all.map(i => `<li class="${i.severity === "error" ? "e" : "w"}"><b>${i.where}</b> · ${esc(i.msg)}</li>`).join("")}
    </ul></details>` : ""}`;
  wrap.style.display = "flex"; wrap.style.flexDirection = "column"; wrap.style.gap = "6px";
  return wrap;
}

function markTerms(html, issues) {
  const cls = { WORD: "m-word", DRIFT_TERM: "m-drift", FLUFF: "m-fluff" };
  const terms = issues.filter(i => cls[i.type] && i.term)
    .sort((a, b) => b.term.length - a.term.length);
  const done = new Set();
  for (const i of terms) {
    const key = i.term.toLowerCase();
    if (done.has(key)) continue; done.add(key);
    const re = new RegExp(`(^|[^A-Za-z'>])(${esc(i.term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")})(?![A-Za-z])(?![^<]*>)`, "gi");
    const title = esc(i.msg);
    html = html.replace(re, `$1<mark class="${cls[i.type]}" title="${title}">$2</mark>`);
  }
  return html;
}

function annotated(r) {
  const box = document.createElement("div"); box.className = "output";
  const parts = [];
  for (const line of r.lines) {
    if (line.type === "blank") { parts.push('<div class="blank"></div>'); continue; }
    if (line.type === "code") { parts.push(`<div class="code">${esc(line.raw)}</div>`); continue; }
    if (line.type === "heading") { parts.push(`<div class="ln hd">${esc(line.text)}</div>`); continue; }
    const sents = line.unitIds.map(id => {
      const u = r.units[id];
      const err = u.issues.some(i => i.severity === "error");
      const warn = !err && u.issues.some(i => i.severity === "warn");
      const limit = u.procedural ? 20 : 25;
      const title = u.issues.length ? u.issues.map(i => "• " + i.msg).join("\n") : `OK — ${u.procedural ? "procedural" : "descriptive"}, ${u.words} words`;
      return `<span class="s ${err ? "s-err" : warn ? "s-warn" : ""}" title="${esc(title)}">${markTerms(esc(u.text), u.issues)}</span>` +
             `<span class="wc ${u.words > limit ? "over" : ""}">${u.words}</span>`;
    }).join(" ");
    parts.push(`<div class="ln">${line.prefix ? `<span class="pfx">${esc(line.prefix)}</span>` : ""}${line.label ? `<span class="lbl">${esc(line.label)}</span>` : ""}${sents}</div>`);
  }
  box.innerHTML = parts.join("");
  return box;
}

function renderDelta() {
  if (!lastLeft || !lastRight) { el.delta.classList.remove("show"); el.delta.innerHTML = ""; return; }
  const a = lastLeft.metrics, b = lastRight.metrics;
  const pct = a.words ? Math.round((1 - b.words / a.words) * 100) : 0;
  const chip = (k, x, y, extra = "") => `<span class="delta-chip">${k} <span class="from">${x}</span> → <span class="to">${y}</span>${extra}</span>`;
  el.delta.innerHTML = [
    chip("<b>STE score</b>", lastLeft.score, lastRight.score),
    chip("Words", a.words, b.words, pct > 0 ? ` <span class="good">(−${pct}%)</span>` : ""),
    chip("Avg words/sentence", a.avgWords, b.avgWords),
    chip("Sentences over limit", a.overLimit, b.overLimit),
    chip("Synonym drift", a.drift, b.drift),
    chip("Complex words", a.unapproved, b.unapproved),
    chip("Filler", a.fluff, b.fluff),
  ].join("");
  el.delta.classList.add("show");
}

// ── Misc ──────────────────────────────────────────────────────────────────────
async function copyPrompt() {
  try { await navigator.clipboard.writeText(STE_SYSTEM); toast("STE prompt copied — paste it into any chatbot."); }
  catch {
    const t = document.createElement("textarea"); t.value = STE_SYSTEM; document.body.appendChild(t);
    t.select(); try { document.execCommand("copy"); toast("STE prompt copied."); } catch { toast("Copy failed."); }
    t.remove();
  }
}

function toast(msg) {
  el.toast.textContent = msg; el.toast.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => el.toast.classList.remove("show"), 2200);
}

init().catch(console.error);
