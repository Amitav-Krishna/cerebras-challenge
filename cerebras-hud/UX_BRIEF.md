# Cerebras HUD - UX Design Brief

## Project Philosophy

**Mantra:** Instead of "think, then implement", we **think and implement together**.

This is not a copilot that writes code for you. It's a **heads-up display** showing what the AI is thinking *right now* as you type. The goal is transparent, collaborative coding where you see the model's uncertainty, ambiguity, and focus in real-time.

---

## Core Technical Constraints

- **API-only:** No custom models, no training
- **Data source:** Cerebras Inference API (Llama 3.3 70B)
- **Primitive:** Token logprobs + top-k predictions only
- **Speed requirement:** Must feel instant (<200ms feedback)

From a single API call (`max_tokens=1, logprobs=20`), we derive:
- **Entropy** - Uncertainty of prediction (bits)
- **Margin** - Confidence gap between top-2 predictions
- **KL Divergence** - How much removing a token changes predictions

---

## Current Features (Implemented)

### M1: Entropy Heatmap
**What:** Shows model uncertainty as background color before cursor

**Current Implementation:**
- Range: ~100 characters before cursor
- Color: Blue (certain) → Purple → Magenta (uncertain)
- Updates: On every keystroke (debounced 150ms)
- Status bar: Shows "🔴 Entropy: 2.40 bits"

**Data:** `entropy` in bits (0 = certain, 4+ = very uncertain)

---

### M2: Ghost Tokens
**What:** Shows alternative the model was considering when uncertain

**Current Implementation:**
- Trigger: When `margin < 0.15` (p1 - p2 is small)
- Visual: Faint gray italic text after cursor
- Also: Underline on ambiguous token (red→yellow→green based on margin)
- Hover: Tooltip with "Top prediction: X, Alternative: Y, Margin: 0.08"

**Data:** 
- `primary` token (top prediction)
- `secondary` token (runner up)
- `margin` (0 = perfectly ambiguous, 1 = certain)

---

### M4: Saliency Lens
**What:** Shows which tokens in your code most influence the next prediction

**Current Implementation:**
- Trigger: Manual command (expensive analysis)
- Visual: Highlighted tokens with KL values, connector lines to cursor
- Color: Blue (low impact) → Purple → Magenta (high impact)
- Limit: Top 5 most salient tokens

**Data:** 
- For each token: `klDivergence` (how much removing it changes predictions)
- Higher KL = more important/salient

**Process:** 
1. Get baseline prediction at cursor
2. For each candidate token: remove it, get new prediction
3. Calculate KL divergence between distributions
4. Visualize tokens with high KL

---

## The UX Challenge

### Current Problems
1. **Visual clutter** - Multiple overlapping decorations
2. **No unified aesthetic** - Colors don't feel cohesive
3. **Status bar overload** - Too many indicators
4. **Discoverability** - Commands are hidden in palette
5. **No sense of "flow"** - Features feel disconnected

### Desired Feel

**"It feels like magic"**

- Predictive but not intrusive
- Informative but not distracting  
- Fast (" psychic ") but not overwhelming
- Like having a pair-programmer who occasionally points things out

### Metaphors to Consider

1. **Radar/Sonar** - Pinging the model, seeing echoes
2. **Thermal vision** - Heat maps of uncertainty
3. **Ghost trails** - Seeing "what could have been"
4. **X-ray vision** - Seeing inside the model's reasoning
5. **Seismograph** - Measuring "tremors" in prediction

---

## User Workflows

### Workflow 1: Writing New Code
User types: `def calculate(`
- **Entropy lens:** Background shows uncertainty rising (what params?)
- **Ghost token:** Faint text shows `x` or `self` (what model expects)
- User sees ambiguity → decides to add type hints → uncertainty drops

### Workflow 2: Debugging/Refactoring  
User is stuck: `return x -`
- **Ghost token:** Shows `y` but model is uncertain
- **Saliency:** User runs analysis → sees `x` is highly salient
- Realizes typo: should be `return y - x`

### Workflow 3: Learning/Unfamiliar Code
User reading: complex nested function
- **Saliency:** Highlights which variables drive the logic
- **Entropy:** Shows which parts are "hard to predict" (likely complex)

---

## Technical Limitations

1. **Rate limits** - Can't analyze every keystroke for saliency
2. **Window size** - API has context limits
3. **Token alignment** - Our simple tokenizer != model's tokenizer
4. **One cursor** - Can only analyze one position at a time

---

## Design Opportunities

### 1. Unified Visual System
- One color palette that works for entropy, margin, saliency
- Consistent opacity/transparency rules
- Clear hierarchy: what's primary info vs secondary

### 2. Contextual Modes
- **Typing mode:** Show entropy + ghosts (real-time)
- **Review mode:** Show saliency on demand
- **Focus mode:** Minimal HUD, only high-signal alerts

### 3. Progressive Disclosure
- Start minimal (just entropy bar?)
- Reveal more on hover/interaction
- Don't show ghosts until user pauses typing

### 4. The "Copilot" Problem
- Avoid looking like autocomplete (not our goal)
- Ghost tokens should feel like "FYI" not "you should type this"
- Visual distinction from IntelliSense/Copilot

### 5. Status/Presence
- How do we show the HUD is "on"?
- Activity indicator when analyzing?
- Aggregate stats (avg entropy of session)?

---

## Mockup Deliverables

### Must Have
1. **Full-screen mock** - Entropy heatmap + ghost + saliency all visible
2. **Color palette** - System that scales across all features
3. **Typography/opacity rules** - For ghost tokens, tooltips
4. **Empty/minimal state** - What it looks like when certain

### Nice to Have
1. **Animated transitions** - How decorations fade in/out
2. **Dark/light themes** - Both VS Code: variants
3. **Mobile/tablet concept** - If we ever go beyond VS Code:
4. **Competitive analysis** - How Copilot, Cursor, etc. handle similar problems

---

## Questions for UX Exploration

1. **Should entropy be a bar/gauge instead of background highlight?**
   - Current: Full background color (can be overwhelming)
   - Alternative: Sidebar heatmap or minimap visualization

2. **How to show ghost tokens without looking like autocomplete?**
   - Current: Faint text after cursor
   - Risk: Users think it's a suggestion to accept

3. **Where does saliency info live?**
   - Current: Highlighted tokens in editor
   - Alternative: Sidebar list? CodeLens? Inline icons?

4. **What's the "at a glance" view?**
   - Should there be a dashboard panel?
   - Or keep it all inline?

5. **How to handle multiple features at once?**
   - What if entropy is high AND ghost is showing AND saliency is on?
   - Prioritization rules?

---

## Reference: Current Colors

```
Entropy:  transparent → rgba(0, g, 255, 0.4) → rgba(r, g, 255, 0.4)
          (uncertain)    (low entropy)         (high entropy)

Ghost:    rgba(150, 150, 150, 0.4)  # Faint gray

Margin:   rgba(255, 0, 0, 0.6) → rgba(255, 200, 0, 0.6)  # Red to yellow

Saliency: rgba(0, 0, 255, 0.4) → rgba(255, 0, 255, 0.4)  # Blue to magenta
```

---

## Success Metrics

- User can tell at a glance if model is "confused"
- Ghost tokens feel helpful, not intrusive
- Saliency reveals insights user wouldn't have noticed
- Overall: "I code better with this" without knowing exactly why

---

## Files to Reference

- `src/features/entropyLens.ts` - Current entropy implementation
- `src/features/ghostToken.ts` - Current ghost implementation
- `src/features/saliencyLens.ts` - Current saliency implementation
- `src/utils/metrics.ts` - Color conversion functions

---

Questions? Ping the team!
