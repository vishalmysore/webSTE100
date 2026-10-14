# LinkedIn post

Andrej Karpathy suggests asking your LLM to write like an aircraft maintenance manual.

On Oct 2 he shared a ladder of better ways to understand LLM output. The first step is ASD-STE100, the Simplified Technical English that aerospace has used since 1986. It has 20-word sentences, one instruction per step, active voice, and one word for one thing.

I wanted to know whether it actually works. So I built webSTE100, a free tool that runs 100% in the browser:

→ The same on-device model (Qwen2.5-1.5B via WebLLM) answers twice: once with a plain prompt and once in STE
→ A deterministic linter scores both answers 0–100 and marks every rule break in the text
→ A lint-and-repair loop sends those rule breaks back to the model until the answer is clean

Live results:
• Jump-start a car: STE score 60 → 97, 430 → 32 words
• Wordy RAG explanation: STE score 0 → 99, 141 → 37 words

The less obvious finding: the model reached a high score partly by saying less. The STE answer left out which cable goes to which terminal, the most important safety detail. Style compliance is not completeness, and it is not correctness either. If you only measure style, the model will trade the other two away.

Takeaways:
1. STE as a prompt works, even on a 1.5B model.
2. Make the judge deterministic and visible, not LLM-as-judge.
3. Measure every dimension you care about.

Try it (the linter works without a GPU too): https://vishalmysore.github.io/webSTE100/
Full write-up and code (MIT): https://github.com/vishalmysore/webSTE100

Paste your own ChatGPT or Claude answer into it. What score does it get?

#AI #LLM #PromptEngineering #GenAI #WebGPU #OpenSource #Karpathy
