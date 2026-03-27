# Wrench Model Training

Transparency document for the Wrench model — the fine-tuned LLM that powers Clank's agent behavior.

> **Deployment Note:** Clank and the Wrench model are designed to run on dedicated hardware (dev machine, VM, or container) due to the agent's full system access model. See the [Threat Model](THREAT_MODEL.md) for details.

## Overview

Wrench is a family of fine-tuned models trained to be better coding agents. The goal is a model that reliably uses tools, follows system prompts, recovers from errors, knows when to stop, and doesn't hallucinate capabilities it doesn't have.

The flagship model is based on Qwen3.5-35B-A3B (MoE, 16GB VRAM). The compact model is based on Qwen3.5-9B (dense, 8GB VRAM) for lower-end hardware.

All training data is hand-crafted. No synthetic generation, no scraping. Every example was written to teach a specific behavior or correct a specific failure mode observed during real usage.

## Base Models

### Wrench 35B (Flagship)

| Property | Value |
|----------|-------|
| **Model** | Qwen3.5-35B-A3B |
| **Architecture** | Mixture of Experts (MoE) |
| **Total parameters** | 35B |
| **Active parameters** | ~3B per token |
| **License** | Apache 2.0 |
| **Creator** | Alibaba Cloud |

The MoE architecture is the key choice here. 35B total parameters means the model has significant capacity, but only 3B are active per forward pass, making it feasible to run locally on consumer hardware. After quantization it fits comfortably in ~20GB of VRAM.

### Wrench 9B (Compact)

| Property | Value |
|----------|-------|
| **Model** | Qwen3.5-9B |
| **Architecture** | Dense transformer |
| **Total parameters** | 9B |
| **Active parameters** | 9B per token |
| **License** | Apache 2.0 |
| **Creator** | Alibaba Cloud |

The compact variant for machines with limited VRAM. Dense architecture means all parameters are active every forward pass, but at 9B total it quantizes down to ~5GB GGUF — comfortably within 8GB VRAM cards.

## Dataset

**1,147 hand-crafted examples** across 15 categories:

| Category | Purpose |
|----------|---------|
| `tool-calling` | Correct tool use syntax and parameter formatting |
| `error-recovery` | Graceful handling of failed tool calls and unexpected outputs |
| `multi-step-chains` | Multi-turn tool sequences where each step depends on the last |
| `multi-step-chains-v2` | More complex chains with branching logic |
| `agent-behavior` | General agent conduct — tone, structure, knowing its role |
| `coding-knowledge` | Language-specific patterns, best practices, idiomatic code |
| `advanced-coding-2` | Harder problems — architecture, debugging, system design |
| `debugging-mastery` | Diagnosing failures from logs, stack traces, and error messages |
| `concise-direct` | Avoiding filler, getting to the point |
| `system-prompt-following` | Respecting constraints and instructions from the system prompt |
| `knowing-when-to-stop` | Recognizing when a task is done and not over-acting |
| `sub-agents` | Spawning, managing, and communicating with sub-agents |
| `always-use-tools` | Preferring tool use over guessing or reciting from memory |
| `destructive-action-caution` | Pausing before irreversible operations (rm -rf, DROP TABLE, etc.) |
| `tool-restraint` | Knowing when NOT to use a tool — the counter-balance to `always-use-tools` |

Every example follows the ChatML format with system, user, and assistant turns. Tool calls and tool responses are embedded inline using Qwen's native tool-call format.

## Training Process

**Method:** LoRA fine-tuning (Low-Rank Adaptation)

| Parameter | Value |
|-----------|-------|
| **Framework** | HuggingFace Transformers + PEFT + Trainer |
| **LoRA rank** | 64 |
| **LoRA alpha** | 128 |
| **Batch size** | 1 |
| **Gradient accumulation steps** | 8 |
| **Effective batch size** | 8 |
| **Epochs** | 2 |
| **Learning rate** | 1e-4 |
| **Scheduler** | Cosine |
| **Precision** | bf16 |
| **Optimizer** | AdamW 8-bit |

**Hardware:** 2x NVIDIA H100 80GB on RunPod. Each training run takes roughly 1 hour and costs approximately $5.

**Quantization:** After training, LoRA adapters are merged back into the base model and quantized to Q4_K_M GGUF format (~20GB). This is the format served by Ollama in production.

## Version History

### v1 — Proof of Concept
- **Examples:** 174
- **Epochs:** 3
- **Final loss:** 0.1471
- **Notes:** Proved the approach works. The model showed clear behavioral improvement over base Qwen on tool-calling and agent tasks. Small dataset, but enough to validate the pipeline.

### v2 — Scale Up
- **Examples:** 1,003
- **Epochs:** 2
- **Final loss:** 0.377
- **Benchmark:** 67/75
- **Notes:** Massive dataset expansion. Higher loss is expected with 5x more diverse examples. Benchmark suite introduced — 75 hand-written test scenarios covering all categories.

### v3 — Regression
- **Examples:** 1,083
- **Epochs:** 2
- **Final loss:** 0.1338
- **Benchmark:** 66/75
- **Notes:** Added 80 examples in the `always-use-tools` category to fix cases where the model would answer from memory instead of using available tools. The loss dropped, but benchmark performance regressed. The model started *inventing fake tools* that didn't exist — it learned "always use a tool" without learning "only use tools that exist." This was the most important lesson of the project (see Lessons Learned).

### v4 — Recovery
- **Examples:** 1,113
- **Epochs:** 2
- **Final loss:** 0.1479
- **Benchmark:** 72/75 (Sonnet-tier on 25-prompt suite)
- **Notes:** Added 30 `tool-restraint` examples that explicitly demonstrate when NOT to call a tool. This fixed the hallucinated-tool problem from v3 and pushed benchmark scores to their highest point. The model now reliably uses tools when appropriate and declines to when they aren't available.

### v5 — Expanded Benchmark (Current — 35B)
- **Examples:** 1,147
- **Epochs:** 2
- **Final loss:** 0.1452
- **Benchmark:** 113/120 (Sonnet-tier on 40-prompt suite across 8 categories)
- **Notes:** Expanded benchmark from 25 prompts / 5 categories to 40 prompts / 8 categories, adding Planning & Reasoning, Tool Format Correctness, and Safety & Restraint. Added 34 new training examples targeting the new categories. Category scores: Basic Tool Use 15/15, Multi-Step Tasks 14/15, Error Recovery 13/15, Response Quality 15/15, System Prompt Following 14/15, Planning & Reasoning 14/15, Tool Format Correctness 13/15, Safety & Restraint 15/15.

### Wrench 9B v1 (Current)
- **Base model:** Qwen3.5-9B
- **Examples:** 1,251
- **Epochs:** 2
- **Benchmark:** 105/120 (87.5% on same 40-prompt suite)
- **Format:** Q4_K_M GGUF (~5GB)
- **Min GPU:** 8GB VRAM
- **Notes:** Same training methodology and LoRA hyperparameters as the 35B, applied to a dense 9B model for lower-end hardware. Uses an expanded dataset (1,251 examples vs 1,147 for 35B v5). Scores lower than the 35B as expected from the smaller parameter count, but still solid agentic performance for the weight class.

## How to Reproduce

### Requirements
- 2x 80GB GPUs (H100, A100, or equivalent)
- Python 3.10+
- `transformers`, `peft`, `trl`, `bitsandbytes`, `datasets`
- Base model: `Qwen/Qwen3.5-35B-A3B` from HuggingFace
- `llama.cpp` for GGUF conversion

### Steps

1. **Prepare dataset** — Format examples as ChatML JSONL with tool definitions in the system message.

2. **Train LoRA adapters:**
   ```bash
   python train.py \
     --model_name Qwen/Qwen3.5-35B-A3B \
     --dataset ./data/wrench_v5.jsonl \
     --lora_rank 64 \
     --lora_alpha 128 \
     --batch_size 1 \
     --gradient_accumulation_steps 8 \
     --num_epochs 2 \
     --learning_rate 1e-4 \
     --lr_scheduler cosine \
     --bf16 \
     --optimizer adamw_8bit
   ```

3. **Merge adapters** back into the base model.

4. **Convert to GGUF:**
   ```bash
   python llama.cpp/convert_hf_to_gguf.py ./merged_model --outtype f16
   llama.cpp/build/bin/llama-quantize ./merged_model.gguf ./wrench-q4km.gguf Q4_K_M
   ```

5. **Load into Ollama** with a Modelfile and test against the benchmark suite.

## Lessons Learned

### Train both sides of every behavioral boundary

This is the single most important takeaway from the project.

In v3, we added examples that said "always use tools instead of guessing." The model learned that lesson — too well. It started fabricating tool calls to functions that didn't exist, because it had learned that tool use is always correct, but had no counter-examples showing when tool use is wrong.

The fix in v4 was adding `tool-restraint` examples: scenarios where the correct answer is to *not* call a tool. "Here are your available tools. The user asked X. None of your tools can do X. Respond without a tool call."

**If you teach a model to always do X, you must also teach it when not to do X.** One-sided behavioral training creates overcorrection. Both the positive and negative cases need representation in the dataset.

### Low loss does not mean better performance

v3 had the lowest training loss (0.1338) and the worst benchmark score. Loss measures how well the model fits the training data, not how well it generalizes. A model can perfectly memorize your examples and still behave incorrectly on novel inputs — especially if the training data has a distributional bias (like being skewed toward "always use tools").

### Hand-crafted data beats scale

1,147 examples is tiny by industry standards. But because every example targets a specific, observed failure mode, the signal-to-noise ratio is extremely high. Each example teaches exactly one thing. No padding, no filler, no duplicates.

### MoE models are underrated for fine-tuning

The 35B-total / 3B-active architecture means you get the capacity of a large model with the inference cost of a small one. LoRA training is also faster because fewer parameters are active per step. The result is a model that punches well above its weight class.

---

## License

The Wrench model and its training methodology are part of the Clank project, licensed under [Apache 2.0](../LICENSE).

The base model (Qwen3.5-35B-A3B) is also Apache 2.0, licensed by Alibaba Cloud.
