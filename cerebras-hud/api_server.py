"""
Simple Python API server for Cerebras HUD.
Your teammate implements the actual Cerebras calls here.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

app = FastAPI()

# Allow VS Code: extension to call this
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalyzeRequest(BaseModel):
    code: str
    uri: str

# TODO: Replace this with real Cerebras API calls
def mock_analyze(code: str, uri: str):
    """Mock analysis - replace with real Cerebras calls"""
    lines = []
    for i, line in enumerate(code.split('\n'), 1):
        tokens = []
        # Very simple tokenization - improve as needed
        import re
        for match in re.finditer(r'\w+|[^\w\s]', line):
            tok = match.group()
            # Simple mock logic - replace with real logprobs
            logprob = -0.1  # confident by default
            if tok == 'string':
                logprob = -3.0  # confused
            elif tok == ';':
                logprob = -4.0  # very confused
            elif tok == 'x':
                logprob = -1.5
            tokens.append({"token": tok, "logprob": logprob})
        lines.append({"line_number": i, "tokens": tokens})
    
    return {"uri": uri, "lines": lines}

@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    """
    Analyze code and return token logprobs.
    Returns FileProbs schema matching the TypeScript types.
    """
    # TODO: Call Cerebras API here
    # For now, use mock data
    return mock_analyze(req.code, req.uri)

if __name__ == "__main__":
    print("Starting API server on http://localhost:8000")
    uvicorn.run(app, host="localhost", port=8000)
