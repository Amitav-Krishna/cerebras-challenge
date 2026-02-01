"""
Python API server for Cerebras HUD.
Predicts next tokens and compares with what user actually wrote.
"""
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict
import uvicorn
import requests
from dotenv import load_dotenv

load_dotenv()

CEREBRAS_API_URL = os.environ.get("CEREBRAS_API_URL", "https://api.cerebras.ai/v1/completions")
CEREBRAS_API_TOKEN = os.environ.get("CEREBRAS_API_TOKEN", "")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TokenProb(BaseModel):
    token: str
    logprob: float

class LineProbs(BaseModel):
    line_number: int
    tokens: List[TokenProb]

class FileProbs(BaseModel):
    uri: str
    lines: List[LineProbs]

class AnalyzeRequest(BaseModel):
    code: str
    uri: str

def get_next_token_prediction(prefix: str) -> Dict:
    """Get model's top predictions for next token."""
    if not CEREBRAS_API_TOKEN:
        raise HTTPException(status_code=500, detail="CEREBRAS_API_TOKEN not set")
    
    headers = {
        "Authorization": f"Bearer {CEREBRAS_API_TOKEN}",
        "Content-Type": "application/json",
    }
    
    payload = {
        "model": "llama-3.3-70b",
        "prompt": prefix,
        "max_tokens": 1,
        "logprobs": 5,  # Request top 5 logprobs
    }
    
    response = requests.post(CEREBRAS_API_URL, headers=headers, json=payload)
    
    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Cerebras API error: {response.text}"
        )
    
    return response.json()

def simple_tokenize(code: str) -> List[Dict]:
    """Simple tokenizer that returns tokens with positions."""
    import re
    tokens = []
    pos = 0
    # Match words or individual non-whitespace chars
    for match in re.finditer(r'\w+|[^\w\s]', code):
        tokens.append({
            'text': match.group(),
            'start': match.start(),
            'end': match.end()
        })
    return tokens

def compute_surprise_rank(actual_token: str, top_logprobs: List[Dict]) -> int:
    """
    Returns rank of actual token in model's predictions.
    1 = top prediction, 2 = second, etc.
    Returns -1 if not in top predictions.
    """
    for i, item in enumerate(top_logprobs):
        # Normalize tokens for comparison (strip whitespace)
        predicted = item.get('token', '').strip()
        if predicted == actual_token.strip():
            return i + 1
    return -1

def rank_to_logprob(rank: int) -> float:
    """
    Convert rank to fake logprob for frontend coloring.
    LOWERED THRESHOLD - show more uncertainty even for 70B model.
    """
    if rank == -1:
        return -5.0   # Not in top 5 - very confused (red)
    elif rank > 3:
        return -3.5   # Rank 4-5 - confused (orange/red)
    elif rank > 2:
        return -2.5   # Rank 3 - unsure (orange)
    elif rank > 1:
        return -1.5   # Rank 2 - slight surprise (yellow)
    else:
        return -0.3   # Rank 1 - confident (green, but not invisible)

import time

def analyze_with_predictions(code: str, uri: str) -> FileProbs:
    """
    Analyze code by comparing each token to model's predictions.
    """
    tokens = simple_tokenize(code)
    lines = code.split('\n')
    
    # Build result structure
    line_tokens_map = {i+1: [] for i in range(len(lines))}
    
    # Analyze key tokens: first few, then spread out to cover whole file
    # Prioritize tokens that might be confusing (operators, punctuation)
    total = len(tokens)
    if total <= 10:
        analyze_indices = list(range(total))
    else:
        # First 5, last 5, and spread the middle
        analyze_indices = list(range(5)) + list(range(total-5, total))
    
    for idx in analyze_indices:
        tok = tokens[idx]
        # Get prefix up to this token
        prefix = code[:tok['start']]
        
        # Skip if prefix is empty (first token) or too short
        if not prefix or len(prefix.strip()) == 0:
            # First token - assume confident
            line_num = code[:tok['start']].count('\n') + 1
            line_tokens_map[line_num].append(TokenProb(
                token=tok['text'],
                logprob=-0.1
            ))
            continue
        
        try:
            time.sleep(0.5)  # Rate limit: max 2 requests per second
            response = get_next_token_prediction(prefix)
            
            # Extract top predictions
            choice = response['choices'][0]
            logprobs_data = choice.get('logprobs', {})
            top_logprobs = logprobs_data.get('top_logprobs', [{}])[0] if logprobs_data.get('top_logprobs') else {}
            
            # Convert to list of {token, logprob}
            top_list = [
                {'token': k, 'logprob': v}
                for k, v in sorted(top_logprobs.items(), key=lambda x: x[1], reverse=True)
            ]
            
            # Find rank of actual token
            rank = compute_surprise_rank(tok['text'], top_list)
            fake_logprob = rank_to_logprob(rank)
            
        except Exception as e:
            print(f"API error for token '{tok['text']}': {e}")
            fake_logprob = -0.1  # Assume confident on error
        
        # Determine which line this token is on
        line_num = code[:tok['start']].count('\n') + 1
        line_tokens_map[line_num].append(TokenProb(
            token=tok['text'],
            logprob=fake_logprob
        ))
    
    # Build FileProbs
    line_probs_list = []
    for i, line_content in enumerate(lines):
        line_num = i + 1
        line_probs_list.append(LineProbs(
            line_number=line_num,
            tokens=line_tokens_map.get(line_num, [])
        ))
    
    return FileProbs(uri=uri, lines=line_probs_list)

@app.post("/analyze", response_model=FileProbs)
def analyze(req: AnalyzeRequest):
    """
    Analyze code by predicting next tokens and comparing to actual.
    """
    return analyze_with_predictions(req.code, req.uri)

if __name__ == "__main__":
    print("Starting API server on http://localhost:8000")
    print(f"Cerebras API configured: {'Yes' if CEREBRAS_API_TOKEN else 'No'}")
    uvicorn.run(app, host="0.0.0.0", port=8000)
