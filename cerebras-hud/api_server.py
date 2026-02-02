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
USE_MOCK = os.environ.get("USE_MOCK", "false").lower() == "true"

# Only use mock mode if explicitly enabled (user must set USE_MOCK=true)
MOCK_MODE = USE_MOCK

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
    if MOCK_MODE:
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
import math
from typing import Optional

# ============================================================================
# HUD Feature: Entropy Calculation
# ============================================================================

def calculate_entropy_from_logprobs(top_logprobs: List[Dict]) -> float:
    """
    Calculate Shannon entropy from top-k logprobs.
    H = -sum(p_i * log2(p_i))
    """
    if not top_logprobs:
        return 0.0
    
    # Find max logprob for numerical stability
    max_logprob = max(item.get('logprob', -100) for item in top_logprobs)
    
    # Convert to probabilities
    exps = []
    for item in top_logprobs:
        logprob = item.get('logprob', -100)
        exps.append(math.exp(logprob - max_logprob))
    
    total = sum(exps)
    probs = [e / total for e in exps]
    
    # Calculate entropy
    entropy = 0.0
    for p in probs:
        if p > 0:
            entropy -= p * math.log2(p)
    
    return entropy


def calculate_margin(top_logprobs: List[Dict]) -> float:
    """
    Calculate margin between top-1 and top-2 probabilities.
    margin = p1 - p2
    """
    if len(top_logprobs) < 2:
        return 1.0
    
    # Sort by logprob descending
    sorted_probs = sorted(top_logprobs, key=lambda x: x.get('logprob', -100), reverse=True)
    
    # Get top 2
    max_logprob = sorted_probs[0].get('logprob', -100)
    logprob2 = sorted_probs[1].get('logprob', -100)
    
    # Convert to probs (unnormalized is fine for margin ratio)
    p1 = math.exp(max_logprob)
    p2 = math.exp(logprob2)
    
    # Normalize
    total = p1 + p2
    return (p1 / total) - (p2 / total) if total > 0 else 0.0


# Closing token sets for autopanic
CLOSE_TOKENS = {
    '}', ')', ']', 'end', 'fi', 'done', ';', '\n\n',
    'pass', 'return', 'break', 'continue'
}

def detect_expecting_close(top_logprobs: List[Dict]) -> tuple[bool, List[str], float]:
    """
    Detect if model is expecting a closing token.
    Returns: (expecting_close, close_types, confidence)
    """
    if not top_logprobs:
        return False, [], 0.0
    
    # Convert to probabilities
    max_logprob = max(item.get('logprob', -100) for item in top_logprobs)
    exps = []
    for item in top_logprobs:
        logprob = item.get('logprob', -100)
        exps.append(math.exp(logprob - max_logprob))
    total = sum(exps)
    
    close_probs = []
    total_close_prob = 0.0
    
    for i, item in enumerate(top_logprobs):
        token = item.get('token', '').strip()
        prob = exps[i] / total if total > 0 else 0
        
        # Check if this is a closing token
        is_close = (
            token in CLOSE_TOKENS or
            token.startswith('}') or
            token.startswith(')') or
            token.startswith(']') or
            (token == '\n' and len([t for t in top_logprobs if t.get('token', '').strip() in ['}', ')', ']']]) > 0)
        )
        
        if is_close:
            close_probs.append((token, prob))
            total_close_prob += prob
    
    # Sort by probability
    close_probs.sort(key=lambda x: x[1], reverse=True)
    close_types = [t for t, _ in close_probs[:3]]
    
    top_close = close_probs[0] if close_probs else ('', 0.0)
    
    return total_close_prob > 0.5, close_types, total_close_prob, top_close[0], top_close[1]


# ============================================================================
# API Endpoints for HUD Features
# ============================================================================

class PrefixRequest(BaseModel):
    prefix: str
    uri: str

class CursorRequest(BaseModel):
    code: str
    uri: str
    cursorLine: int
    cursorChar: int


@app.post("/entropy")
def get_entropy(req: PrefixRequest):
    """
    Get entropy for next token prediction at cursor position.
    Returns entropy in bits and top logprobs.
    """
    if MOCK_MODE:
        # Return mock data for testing
        return {
            "entropy": 2.5,
            "maxLogprob": -0.5,
            "topLogprobs": [
                {"token": "x", "logprob": -0.5},
                {"token": "y", "logprob": -1.2},
                {"token": "z", "logprob": -2.0},
            ],
            "tokenCount": 3
        }
    
    try:
        headers = {
            "Authorization": f"Bearer {CEREBRAS_API_TOKEN}",
            "Content-Type": "application/json",
        }
        
        payload = {
            "model": "llama-3.3-70b",
            "prompt": req.prefix,
            "max_tokens": 1,
            "logprobs": 20,
            
        }
        
        response = requests.post(CEREBRAS_API_URL, headers=headers, json=payload)
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Cerebras API error: {response.text}"
            )
        
        data = response.json()
        choice = data['choices'][0]
        logprobs_data = choice.get('logprobs', {})
        top_logprobs = logprobs_data.get('top_logprobs', [{}])[0] if logprobs_data.get('top_logprobs') else {}
        
        # Convert to list format
        top_list = [
            {'token': k, 'logprob': v}
            for k, v in sorted(top_logprobs.items(), key=lambda x: x[1], reverse=True)
        ]
        
        entropy = calculate_entropy_from_logprobs(top_list)
        max_logprob = top_list[0]['logprob'] if top_list else -10
        
        return {
            "entropy": entropy,
            "maxLogprob": max_logprob,
            "topLogprobs": top_list[:10],  # Return top 10
            "tokenCount": len(top_list)
        }
        
    except Exception as e:
        print(f"Entropy calculation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ghost")
def get_ghost(req: PrefixRequest):
    """
    Get ghost token suggestion (top-2 predictions and margin).
    """
    if MOCK_MODE:
        return {
            "primary": {"token": "x", "logprob": -0.3},
            "secondary": {"token": "y", "logprob": -1.5},
            "margin": 0.65,
            "shouldShowGhost": False
        }
    
    try:
        headers = {
            "Authorization": f"Bearer {CEREBRAS_API_TOKEN}",
            "Content-Type": "application/json",
        }
        
        payload = {
            "model": "llama-3.3-70b",
            "prompt": req.prefix,
            "max_tokens": 1,
            "logprobs": 5,
            
        }
        
        response = requests.post(CEREBRAS_API_URL, headers=headers, json=payload)
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Cerebras API error: {response.text}"
            )
        
        data = response.json()
        choice = data['choices'][0]
        logprobs_data = choice.get('logprobs', {})
        top_logprobs = logprobs_data.get('top_logprobs', [{}])[0] if logprobs_data.get('top_logprobs') else {}
        
        top_list = [
            {'token': k, 'logprob': v}
            for k, v in sorted(top_logprobs.items(), key=lambda x: x[1], reverse=True)
        ]
        
        if len(top_list) < 2:
            return {
                "primary": top_list[0] if top_list else {"token": "", "logprob": -10},
                "secondary": {"token": "", "logprob": -10},
                "margin": 1.0,
                "shouldShowGhost": False
            }
        
        margin = calculate_margin(top_list[:2])
        
        return {
            "primary": top_list[0],
            "secondary": top_list[1],
            "margin": margin,
            "shouldShowGhost": margin < 0.15
        }
        
    except Exception as e:
        print(f"Ghost calculation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/autopanic")
def get_autopanic(req: PrefixRequest):
    """
    Detect if model expects a closing token (bracket autopanic).
    """
    if MOCK_MODE:
        return {
            "expectingClose": False,
            "closeTypes": [],
            "confidence": 0.0,
            "topCloseToken": "",
            "topCloseProb": 0.0
        }
    
    try:
        headers = {
            "Authorization": f"Bearer {CEREBRAS_API_TOKEN}",
            "Content-Type": "application/json",
        }
        
        payload = {
            "model": "llama-3.3-70b",
            "prompt": req.prefix,
            "max_tokens": 1,
            "logprobs": 10,
            
        }
        
        response = requests.post(CEREBRAS_API_URL, headers=headers, json=payload)
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Cerebras API error: {response.text}"
            )
        
        data = response.json()
        choice = data['choices'][0]
        logprobs_data = choice.get('logprobs', {})
        top_logprobs = logprobs_data.get('top_logprobs', [{}])[0] if logprobs_data.get('top_logprobs') else {}
        
        top_list = [
            {'token': k, 'logprob': v}
            for k, v in sorted(top_logprobs.items(), key=lambda x: x[1], reverse=True)
        ]
        
        expecting, close_types, confidence, top_token, top_prob = detect_expecting_close(top_list)
        
        return {
            "expectingClose": expecting,
            "closeTypes": close_types,
            "confidence": confidence,
            "topCloseToken": top_token,
            "topCloseProb": top_prob
        }
        
    except Exception as e:
        print(f"Autopanic calculation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Feature 4: Perturbation-based Saliency
# ============================================================================

import re

def find_candidate_tokens(code: str, cursor_line: int, cursor_char: int) -> List[Dict]:
    """
    Find candidate tokens for saliency analysis around cursor.
    Returns list of {line, character, token_text, token_type}
    """
    lines = code.split('\n')
    candidates = []
    
    # Look at lines around cursor (context window)
    start_line = max(0, cursor_line - 5)
    end_line = min(len(lines), cursor_line + 2)
    
    # Token patterns: identifiers, strings, numbers
    identifier_pattern = re.compile(r'\b[a-zA-Z_][a-zA-Z0-9_]*\b')
    
    for line_idx in range(start_line, end_line):
        line = lines[line_idx]
        for match in identifier_pattern.finditer(line):
            # Skip very short tokens
            if len(match.group()) < 2:
                continue
            
            candidates.append({
                'line': line_idx + 1,  # 1-indexed
                'character': match.start(),
                'token_text': match.group(),
                'token_type': 'identifier'
            })
    
    # Prioritize: function names, variables, then others
    # Sort by distance to cursor
    def distance_to_cursor(cand):
        line_dist = abs(cand['line'] - cursor_line)
        char_dist = abs(cand['character'] - cursor_char) if line_dist == 0 else 0
        return (line_dist, char_dist)
    
    candidates.sort(key=distance_to_cursor)
    return candidates[:15]  # Limit to avoid too many API calls


def get_next_token_distribution(prefix: str) -> Optional[Dict[str, float]]:
    """Get probability distribution over next token."""
    if MOCK_MODE:
        # Return mock distribution
        return {
            'x': 0.3, 'y': 0.25, 'z': 0.15, ' ': 0.1, 
            '\n': 0.08, '(': 0.05, '=': 0.04, ':': 0.03
        }
    
    try:
        headers = {
            "Authorization": f"Bearer {CEREBRAS_API_TOKEN}",
            "Content-Type": "application/json",
        }
        
        payload = {
            "model": "llama-3.3-70b",
            "prompt": prefix,
            "max_tokens": 1,
            "logprobs": 20,
        }
        
        response = requests.post(CEREBRAS_API_URL, headers=headers, json=payload)
        
        if response.status_code != 200:
            return None
        
        data = response.json()
        choice = data['choices'][0]
        logprobs_data = choice.get('logprobs', {})
        top_logprobs = logprobs_data.get('top_logprobs', [{}])[0] if logprobs_data.get('top_logprobs') else {}
        
        # Convert to probabilities
        items = list(top_logprobs.items())
        if not items:
            return None
        
        max_logprob = max(v for k, v in items)
        exps = [(k, math.exp(v - max_logprob)) for k, v in items]
        total = sum(e for _, e in exps)
        
        return {k: e / total for k, e in exps}
        
    except Exception as e:
        print(f"Distribution fetch error: {e}")
        return None


def calculate_kl_divergence(p: Dict[str, float], q: Dict[str, float]) -> float:
    """Calculate KL(P || Q)."""
    kl = 0.0
    for token, p_prob in p.items():
        q_prob = q.get(token, 1e-10)
        if p_prob > 0:
            kl += p_prob * math.log(p_prob / q_prob)
    return kl


def remove_token_at(code: str, line: int, char: int, token_text: str) -> str:
    """Create perturbed code with token removed."""
    lines = code.split('\n')
    if line < 1 or line > len(lines):
        return code
    
    target_line = lines[line - 1]
    end_char = char + len(token_text)
    
    # Remove the token
    new_line = target_line[:char] + target_line[end_char:]
    lines[line - 1] = new_line
    
    return '\n'.join(lines)


@app.post("/saliency")
def get_saliency(req: CursorRequest):
    """
    Compute perturbation-based saliency for tokens around cursor.
    
    For each candidate token:
    1. Get baseline next-token distribution
    2. Remove token, get perturbed distribution  
    3. Calculate KL divergence
    
    High KL = token is salient (important for prediction)
    """
    # Get cursor position and prefix
    lines = req.code.split('\n')
    cursor_line = req.cursorLine
    cursor_char = req.cursorChar
    
    # Build prefix up to cursor
    if cursor_line < 1:
        prefix = ""
    elif cursor_line > len(lines):
        prefix = req.code
    else:
        prefix_lines = lines[:cursor_line - 1]
        prefix_lines.append(lines[cursor_line - 1][:cursor_char])
        prefix = '\n'.join(prefix_lines)
    
    # Get baseline distribution
    baseline_dist = get_next_token_distribution(prefix)
    if not baseline_dist:
        # Return empty result on error
        return {
            "tokens": [],
            "baseEntropy": calculate_entropy_from_probs(baseline_dist or {})
        }
    
    base_entropy = calculate_entropy_from_probs(baseline_dist)
    
    # Find candidate tokens
    candidates = find_candidate_tokens(req.code, cursor_line, cursor_char)
    
    # Analyze each candidate
    results = []
    
    for candidate in candidates:
        # Create perturbed code
        perturbed_code = remove_token_at(
            req.code,
            candidate['line'],
            candidate['character'],
            candidate['token_text']
        )
        
        # Build perturbed prefix
        perturbed_lines = perturbed_code.split('\n')
        if cursor_line <= len(perturbed_lines):
            perturbed_prefix_lines = perturbed_lines[:cursor_line - 1]
            perturbed_prefix_lines.append(perturbed_lines[cursor_line - 1][:cursor_char])
            perturbed_prefix = '\n'.join(perturbed_prefix_lines)
        else:
            perturbed_prefix = perturbed_code
        
        # Get perturbed distribution
        perturbed_dist = get_next_token_distribution(perturbed_prefix)
        
        if perturbed_dist:
            # Calculate KL divergence
            kl = calculate_kl_divergence(baseline_dist, perturbed_dist)
            
            if kl > 0.001:  # Only include meaningful changes
                results.append({
                    "line": candidate['line'],
                    "character": candidate['character'],
                    "tokenText": candidate['token_text'],
                    "klDivergence": kl
                })
        
        # Rate limiting - small delay between calls
        if not MOCK_MODE:
            time.sleep(0.05)
    
    # Sort by KL divergence
    results.sort(key=lambda x: x['klDivergence'], reverse=True)
    
    return {
        "tokens": results[:10],
        "baseEntropy": base_entropy
    }


def calculate_entropy_from_probs(probs: Dict[str, float]) -> float:
    """Calculate entropy from probability distribution."""
    entropy = 0.0
    for p in probs.values():
        if p > 0:
            entropy -= p * math.log2(p)
    return entropy


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
    print("=" * 60)
    print("Cerebras HUD API Server")
    print("=" * 60)
    print(f"Mode: {'MOCK (testing)' if MOCK_MODE else 'LIVE (Cerebras API)'}")
    print(f"Endpoint: http://localhost:8000")
    
    if not MOCK_MODE and not CEREBRAS_API_TOKEN:
        print("\n⚠️  WARNING: No CEREBRAS_API_TOKEN set!")
        print("   Set it in .env file: CEREBRAS_API_TOKEN=csk-...")
        print("   Or run: export CEREBRAS_API_TOKEN=csk-...")
        print("\n   Get your API key from: https://cloud.cerebras.ai/")
        exit(1)
    
    if MOCK_MODE:
        print("\n🧪 Using mock data (USE_MOCK=true)")
        print("   All entropy values will be ~2.5 bits (orange)")
    else:
        print(f"\n✅ API Token: {CEREBRAS_API_TOKEN[:10]}...")
        print("   Ready to analyze code with real Cerebras inference!")
    
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000)
