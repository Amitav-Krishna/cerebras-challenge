# Cerebras HUD - API Integration Spec

## Overview
The VS Code: extension streams code to a Python API server and expects token logprobs back. This doc tells you how to implement the real Cerebras integration.

## Endpoint

```
POST /analyze
Content-Type: application/json
```

## Request Body

```json
{
  "code": "def add(x, y: int) -> string:\n    return x - y;",
  "uri": "file:///home/user/project/test.py"
}
```

## Response Format

Must return a `FileProbs` object:

```json
{
  "uri": "file:///home/user/project/test.py",
  "lines": [
    {
      "line_number": 1,
      "tokens": [
        { "token": "def", "logprob": -0.1 },
        { "token": "add", "logprob": -0.2 },
        { "token": "(", "logprob": -0.05 },
        { "token": "x", "logprob": -1.5 },
        { "token": ",", "logprob": -0.1 },
        { "token": "y", "logprob": -0.3 },
        { "token": ":", "logprob": -0.05 },
        { "token": "int", "logprob": -0.15 },
        { "token": ")", "logprob": -0.05 },
        { "token": "->", "logprob": -0.4 },
        { "token": "string", "logprob": -3.0 },
        { "token": ":", "logprob": -0.05 }
      ]
    }
  ]
}
```

## Types Reference

```python
from pydantic import BaseModel
from typing import List

class TokenProb(BaseModel):
    token: str      # The token string (e.g., "def", "x", "(")
    logprob: float  # Log probability (more negative = more confused)

class LineProbs(BaseModel):
    line_number: int
    tokens: List[TokenProb]

class FileProbs(BaseModel):
    uri: str
    lines: List[LineProbs]
```

## Logprob Interpretation

| Range | Meaning | Frontend Behavior |
|-------|---------|-------------------|
| 0 to -0.5 | Very confident | Not highlighted |
| -0.5 to -1.0 | Confident | Not highlighted |
| -1.0 to -2.0 | Slightly confused | Yellow highlight |
| -2.0 to -3.0 | Confused | Orange highlight |
| -3.0+ | Very confused | Red highlight |

**Frontend threshold is -1.0** - only tokens with logprob < -1.0 get highlighted.

## Cerebras Integration

You need to:
1. Tokenize the input code (or get tokens from Cerebras)
2. Send to Cerebras API with `logprobs=True`
3. Map the response back to our schema

### Example Pseudocode

```python
import cerebras  # or whatever SDK you're using

@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> FileProbs:
    # Option 1: If Cerebras gives per-token logprobs for input
    response = cerebras.completions.create(
        model="llama-3.1-8b",
        prompt=req.code,
        logprobs=True,
        max_tokens=1,  # We don't need completion, just logprobs
        echo=True      # Include input tokens in response
    )
    
    # Extract tokens and logprobs from response
    tokens = []
    for i, token_text in enumerate(response.tokens):
        tokens.append({
            "token": token_text,
            "logprob": response.token_logprobs[i]
        })
    
    # Group by lines (you'll need to map token positions to lines)
    lines = group_tokens_by_line(tokens, req.code)
    
    return {
        "uri": req.uri,
        "lines": lines
    }
```

## Testing

1. Run your server: `python api_server.py`
2. Test with curl:
   ```bash
   curl -X POST http://localhost:8000/analyze \
     -H "Content-Type: application/json" \
     -d '{"code": "def foo(): pass", "uri": "test.py"}'
   ```
3. In `src/api/client.ts`, set `USE_MOCK = false`
4. Reload the VS Code: extension and type!

## Performance Notes

- Frontend debounces at 300ms (waits for typing pause)
- Don't analyze on every keystroke - wait for the debounce
- Keep response time < 200ms for "real-time" feel
- Cerebras is fast - use that speed!

## Questions?

Ping the frontend dev if the schema needs changes.
