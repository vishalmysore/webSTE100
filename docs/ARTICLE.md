---
title: "Karpathy Says Make Your LLM Write Like an Aircraft Manual. I Built a Browser Tool to Measure It."
subtitle: "ASD-STE100 Simplified Technical English as a prompt — tested live with an on-device model, a deterministic linter and a lint-and-repair loop."
description: "Andrej Karpathy suggests asking LLMs to explain things in ASD-STE100 Simplified Technical English. I built webSTE100, a free in-browser WebLLM tool that scores LLM output against STE rules and repairs it — and found where the idea works and where it breaks."
tags: [Artificial Intelligence, LLM, Prompt Engineering, WebGPU, Technical Writing]
canonical_url: https://github.com/vishalmysore/webSTE100/blob/main/docs/ARTICLE.md
---

# Karpathy Says Make Your LLM Write Like an Aircraft Manual. I Built a Browser Tool to Measure It.

### ASD-STE100 Simplified Technical English as a prompt — tested live with an on-device model, a deterministic linter, and a lint-and-repair loop.

![webSTE100 live run: the plain LLM answer scores 60, the ASD-STE100 answer scores 97](https://vishalmysore.github.io/webSTE100/docs/live-ask-jumpstart.jpg)
*A live run on my own laptop GPU. The same 1.5B model answers twice: once with a plain prompt and once in Simplified Technical English. No server and no API key are involved.*

---

**TL;DR**

- On October 2, 2026, Andrej Karpathy suggested asking LLMs to explain things in **ASD-STE100**, the controlled English used for aircraft maintenance manuals. He then listed diagrams, HTML pages and custom explainer videos as even better formats.
- I built **[webSTE100](https://vishalmysore.github.io/webSTE100/)**, a free, open-source tool that runs entirely in the browser. It compares plain LLM output with STE output, **scores both with a deterministic linter**, and runs a **lint-and-repair loop** that makes the model fix every rule it breaks.
- In two live tests, the STE score rose from **60 → 97** and from **0 → 99**, and the word count fell by **74–93%**.
- The score did not catch everything. The model reached a high score partly by **leaving out information**, and the "99" text was not real STE. This article covers both the gains and the gaps.

---

## We will spend more time reading AI output than writing it

Karpathy's post opens with a prediction: *"We'll be spending a lot more time trying to understand the outputs of language models."*

As agents write more of our code, documents and analysis, the human job moves to **oversight**: reading, checking and understanding what the model produced. The bottleneck is no longer generation. It is **comprehension**.

Default LLM prose is hard to review quickly. It tends to:

- **pad**: "Great question!", "It's important to note that…", "I hope this helps!"
- **rotate synonyms**: the same part is an *engine*, then a *motor*, then a *power unit*
- **hide the action**: one long sentence can contain three instructions and a warning

Karpathy did not suggest a better prompt template. He went back to a 1980s aerospace standard.

## What Karpathy actually advocated: a ladder of output formats

His post is a ladder, and each step is introduced with "But even better":

1. **Writing in ASD-STE100.** He said asking the LLM to explain something in ASD-STE100 had worked well for him. He noted that the spec is strict, so he sometimes asks the model to go only part of the way.
2. **Diagrams.** A diagram is often much easier to process than paragraphs.
3. **HTML.** Ask for the answer as an interactive web page.
4. **Custom explainer videos.** This is the format he was most bullish on: a 3Blue1Brown-style video generated for any topic, with synthesized narration.

The idea behind all four steps is that **code and intelligence are now cheap enough to build a disposable, custom artifact just to understand one thing**. You do not have to read a wall of text.

This article tests the first step, because it is the one you can use today in any chatbot by changing your prompt.

## What is ASD-STE100 Simplified Technical English?

**ASD-STE100** is a controlled language for technical documentation. Work on it began in 1979 at the request of European airlines, and the first version was published in 1986. Today it is maintained by ASD, the AeroSpace, Security and Defence Industries Association of Europe.

It exists because, in aircraft maintenance, an ambiguous sentence is a safety risk. Many of the people who read the manuals are not native English speakers.

STE has two parts: **writing rules** and a **controlled dictionary** of approved words. The best-known rules are:

| STE rule | Why it helps a reviewer |
|---|---|
| A procedural sentence has a maximum of **20 words**. A descriptive sentence has a maximum of **25 words**. | You can scan each sentence in one look |
| Write **one instruction per sentence** | Each step is one action, so you can verify it on its own |
| Use the **active voice** | You can always see who does what |
| Use **one word for one meaning**, and do not use synonyms | No guessing whether a *clamp* and a *clip* are different parts |
| A paragraph has a maximum of **6 sentences** | Structure is visible |
| Use **approved, simple words**: *use*, not *utilize* | Less effort to read, especially for non-native speakers |

The full specification is much more detailed and strict, which is why Karpathy suggests asking for STE only part of the way.

## The problem: "write in STE" is easy to say and hard to check

Adding "explain this in ASD-STE100" to a prompt takes five seconds. The harder question is **whether the model actually did it**. A model that sounds terse can still break most of the rules.

So I built a tool that **measures** STE compliance.

## webSTE100: plain LLM vs ASD-STE100, side by side, in your browser

**webSTE100** is a single static web page. It loads a small open model, Qwen2.5-1.5B by default, directly in the browser with **[WebLLM](https://github.com/mlc-ai/web-llm)** and **WebGPU**. Nothing is sent to a server.

The same model answers your question twice:

| Left panel | Right panel |
|---|---|
| Plain system prompt: `You are a helpful assistant.` | The **same model** with an STE system prompt, plus a lint-and-repair loop |

Because both panels use one model, **the only variable is the prompt**.

### Part 1: a deterministic STE linter

The core is `ste-checker.js`, about 300 lines of dependency-free JavaScript. It does not use a model to grade a model. The same text always gets the same score.

| Check | What it flags |
|---|---|
| Sentence length | Procedural sentences over 20 words, descriptive sentences over 25 words |
| Multiple instructions | Two actions in one step, such as "…and then connect…" |
| Passive voice | An error in procedures and a warning elsewhere |
| Complex words | `utilize → use`, `leverage → use`, `commence → start` |
| **Synonym drift** | Two or more names for one thing: `engine / motor`, `chunk / passage / snippet` |
| Filler | `Great question!`, `basically`, `it's worth noting`, `I hope this helps` |

Each answer gets a **0–100 STE score**, and every sentence is annotated in place with its word count and a tooltip for each rule it breaks.

![The linter annotates each sentence: rule breaks, complex words, synonym drift and filler](https://vishalmysore.github.io/webSTE100/docs/live-rewrite-annotations.jpg)

### Part 2: a lint-and-repair loop

In this loop the linter is the **judge** and the model is only the **rewriter**:

```
STE draft ──▶ linter ──▶ "Replace 'leverage' with 'use'.
    ▲                     You use 'chunk', 'passage', 'snippet' for the same thing. Use only 'chunk'.
    │                     The sentence 'When a question comes in…' has 47 words. Split it."
    └──── model rewrites ◀──┘     (up to 3 passes — the best-scoring version is kept)
```

Every pass is shown as a chip, such as `Draft: 83 → Pass 1: 97 → Pass 2: 83`. You can click a chip to see that version, and hover over it to see the exact fixes the model received.

### Part 3: it also works without a GPU

Without WebGPU, the page switches to **linter-only mode**. You can paste any ChatGPT, Claude or Gemini answer and see how it scores. A **Copy STE prompt** button copies the system prompt for use in any chatbot.

## Experiment 1: "How do I jump-start a car with a dead battery?"

This was a live run on the deployed site with Qwen2.5-1.5B-Instruct (4-bit), in Chrome, with 2 repair passes.

![Scorecards and the before/after comparison strip](https://vishalmysore.github.io/webSTE100/docs/live-ask-scorecards.jpg)

| | Plain prompt | STE prompt + repair loop |
|---|---|---|
| **STE score** | 60 | **97** |
| Words | 430 | **32** |
| Average words per sentence | 12.6 | 4 |
| Sentences over the limit | 5 | 0 |
| Complex words | 6 | 0 |
| Synonym drift | 1 (*engine / motor*) | 0 |
| Repair loop | — | Draft 83 → **Pass 1: 97** → Pass 2: 83 |

**What worked.** The plain answer was 430 words of headings, padding and long sentences. The linter flagged *ensure*, *attempting*, *components*, the engine/motor drift, and five sentences over the limit. The STE version was much faster to read.

**What the score did not show:**

1. **The plain answer contained errors.** It listed a jack and a "spare battery" as materials, and a step titled "Connect the Negative Cables" described the *positive* cable. STE formatting does not fix wrong facts.
2. **The STE answer left out the most important safety detail.** At 32 words it said "Connect cables to both battery terminals." It did not say which cable goes where, or in what order.
3. **More repair passes can make the result worse.** Pass 2 scored lower than Pass 1. Keeping the best-scoring version prevented a regression.

> **Lesson 1:** STE compliance is not the same as completeness or correctness. The score measures *how* the text is written, not *what* it says. A small model found the cheapest way to score well: say less.

## Experiment 2: rewriting a wordy explanation of RAG

In **Rewrite mode**, you paste existing text and the model changes only how it is written, so the facts stay fixed. I pasted a deliberately padded paragraph about Retrieval-Augmented Generation.

![Rewrite mode: the original scores 0 and the STE rewrite scores 99](https://vishalmysore.github.io/webSTE100/docs/live-rewrite-rag.jpg)

| | Original | STE rewrite |
|---|---|---|
| **STE score** | **0** | **99** |
| Words | 141 | 37 (−74%) |
| Average words per sentence | 28.2 | 9.3 |
| Synonym drift | 2 groups (*chunk / passage / snippet / segment*, *vector database / vector store*) | 0 |
| Filler words | 8 | 1 |

The annotated original shows the problem clearly: four names for one concept, a 47-word sentence, and eight filler words.

Reading the "99" rewrite closely showed new problems:

- **Missing articles and subjects.** "Converts questions to vectors…" has no subject. Real STE requires complete sentences with articles, and my linter does not check for this yet.
- **Four actions in one sentence.** My multi-instruction check only looks at command sentences, so it missed this descriptive one.
- **A misused `WARNING:`.** In STE, a warning is a safety label. The model used it as decoration.

> **Lesson 2:** A deterministic judge is only as good as its rules, and the model will find the gaps. Each gap above is a small code fix. Not knowing the gaps exist is the expensive mistake.

A published fact-check of an STE cheat sheet also showed that *approximately* is an **approved** STE word. My first version of the linter flagged it as complex. That has been fixed. A controlled language needs a controlled source of truth, not memory.

## Three takeaways for anyone who reviews AI output

**1. STE as a prompt works, even on small models.** A 1.5B model running on a laptop cut its average sentence length by two thirds and stopped using filler and rotating synonyms. For a reviewer, that is a real improvement.

**2. Make the judge deterministic and visible.** An LLM grading an LLM gives you an opinion. A linter gives you an exact list of rule breaks, shown in the text, with the same result every time. You can also feed that list back to the model as repair instructions.

**3. Measure every dimension you care about.** Style, completeness and correctness are separate measures. If you only score style, a model will trade the other two away to improve it.

## Try it in your own prompts today

This is the system prompt webSTE100 uses. Paste it into ChatGPT, Claude or Gemini:

```text
You write in ASD-STE100 Simplified Technical English.
Obey these rules:
1. Write instructions as a numbered list. Write one instruction in each step.
2. Use the command form for instructions. Example: "Remove the cap."
3. Write a maximum of 20 words in an instruction. Write a maximum of 25 words in a description.
4. Use the active voice.
5. Use one name for one thing. Use the same name every time. Do not use synonyms.
6. Use simple, common words. Do not use: utilize, ensure, facilitate, leverage, commence, terminate.
7. Write a warning before the step it applies to. Start it with "WARNING:".
8. Do not write an introduction, praise or a summary. Start with the answer.
9. Write a maximum of 6 sentences in a paragraph.
```

From my tests, add one more line, because it closes the "say less" loophole:

```text
10. Keep every fact, value, and safety step. Do not shorten the content — only the sentences.
```

## What's next

Next for webSTE100:

- A check for **missing articles and subjects**, to catch telegraphic sentences
- **Multi-instruction detection** for descriptive sentences
- A **fact-coverage check** that compares the key terms of the source with the rewrite
- A **length floor** in the repair loop, so that writing less is not the easiest way to score well

The bigger opportunity is the rest of Karpathy's ladder: the same lint-and-repair approach applied to **generated diagrams and disposable HTML explainers**.

## Frequently asked questions

**What is ASD-STE100?**
It is Simplified Technical English, a controlled language standard maintained by ASD. It was first published in 1986 for aerospace maintenance documentation. It limits sentence length, requires one instruction per sentence and the active voice, and uses a controlled dictionary of approved words.

**Does asking an LLM for STE output reduce hallucinations?**
No. STE changes how text is written, not whether it is true. In my test, the plain answer contained factual errors, and the STE answer from the same model left out important information.

**Do I need a GPU to try webSTE100?**
Only for the model. The linter works in any browser. Paste any LLM answer into *Rewrite text* and press **Lint only**.

**Is this the official ASD-STE100 standard?**
No. The linter approximates the best-known STE writing rules and uses a small word list. The official specification and dictionary are published by ASD.

---

**Try it:** [vishalmysore.github.io/webSTE100](https://vishalmysore.github.io/webSTE100/)
**Source code (MIT):** [github.com/vishalmysore/webSTE100](https://github.com/vishalmysore/webSTE100)
**Karpathy's original post:** [x.com/karpathy/status/2105819303471976479](https://x.com/karpathy/status/2105819303471976479)

If you try it on your own LLM output, I would like to see your before and after scores.

*Test setup: Qwen2.5-1.5B-Instruct-q4f16_1-MLC, WebLLM 0.2.79, Chrome with WebGPU, 2 repair passes. The results are from single live runs; sampling means your numbers will differ.*

`#AI` `#LLM` `#PromptEngineering` `#Karpathy` `#WebGPU` `#OpenSource` `#TechnicalWriting`
