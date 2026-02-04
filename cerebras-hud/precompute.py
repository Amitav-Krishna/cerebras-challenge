"""
Precompute all API responses for test_preset.py to enable instant demo.
Run this once before the demo: python precompute.py
"""
import json
import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

CEREBRAS_API_URL = os.environ.get("CEREBRAS_API_URL", "https://api.cerebras.ai/v1/completions")
CEREBRAS_API_TOKEN = os.environ.get("CEREBRAS_API_TOKEN", "")

def get_prediction(prefix: str):
    """Get prediction from Cerebras API."""
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
        print(f"Error: {response.status_code} - {response.text}")
        return None
    
    return response.json()


def calculate_entropy(top_logprobs):
    """Calculate Shannon entropy."""
    import math
    
    items = list(top_logprobs.items())
    if not items:
        return 0.0
    
    max_logprob = max(v for k, v in items)
    exps = [(k, math.exp(v - max_logprob)) for k, v in items]
    total = sum(e for _, e in exps)
    probs = {k: e / total for k, e in exps}
    
    entropy = 0.0
    for p in probs.values():
        if p > 0:
            entropy -= p * math.log2(p)
    
    return entropy


def calculate_margin(top_logprobs):
    """Calculate margin between top-1 and top-2."""
    import math
    
    items = sorted(top_logprobs.items(), key=lambda x: x[1], reverse=True)
    if len(items) < 2:
        return 1.0
    
    p1 = math.exp(items[0][1])
    p2 = math.exp(items[1][1])
    total = p1 + p2
    return (p1 / total) - (p2 / total) if total > 0 else 0.0


def get_ghost_response(prefix: str):
    """Get ghost token response."""
    data = get_prediction(prefix)
    if not data:
        return None
    
    choice = data['choices'][0]
    logprobs_data = choice.get('logprobs', {})
    top_logprobs = logprobs_data.get('top_logprobs', [{}])[0] if logprobs_data.get('top_logprobs') else {}
    
    top_list = [
        {'token': k, 'logprob': v}
        for k, v in sorted(top_logprobs.items(), key=lambda x: x[1], reverse=True)
    ]
    
    if len(top_list) < 2:
        return None
    
    margin = calculate_margin(top_logprobs)
    
    return {
        'primary': top_list[0],
        'secondary': top_list[1],
        'margin': margin,
        'shouldShowGhost': margin < 0.15
    }


def get_entropy_response(prefix: str):
    """Get entropy response."""
    data = get_prediction(prefix)
    if not data:
        return None
    
    choice = data['choices'][0]
    logprobs_data = choice.get('logprobs', {})
    top_logprobs = logprobs_data.get('top_logprobs', [{}])[0] if logprobs_data.get('top_logprobs') else {}
    
    top_list = [
        {'token': k, 'logprob': v}
        for k, v in sorted(top_logprobs.items(), key=lambda x: x[1], reverse=True)
    ]
    
    return {
        'entropy': calculate_entropy(top_logprobs),
        'maxLogprob': top_list[0]['logprob'] if top_list else -10,
        'topLogprobs': top_list[:10],
        'tokenCount': len(top_list)
    }


def get_saliency_response(code: str, cursor_line: int, cursor_char: int):
    """Get saliency by removing each token and comparing predictions."""
    import re
    import math
    
    lines = code.split('\n')
    
    # Build prefix up to cursor
    if cursor_line < 1:
        prefix = ""
    elif cursor_line > len(lines):
        prefix = code
    else:
        prefix_lines = lines[:cursor_line - 1]
        prefix_lines.append(lines[cursor_line - 1][:cursor_char])
        prefix = '\n'.join(prefix_lines)
    
    # Get baseline distribution
    baseline_data = get_prediction(prefix)
    if not baseline_data:
        return None
    
    choice = baseline_data['choices'][0]
    logprobs_data = choice.get('logprobs', {})
    top_logprobs = logprobs_data.get('top_logprobs', [{}])[0] if logprobs_data.get('top_logprobs') else {}
    
    baseline_items = list(top_logprobs.items())
    max_logprob = max(v for k, v in baseline_items)
    baseline_probs = {k: math.exp(v - max_logprob) for k, v in baseline_items}
    total = sum(baseline_probs.values())
    baseline_probs = {k: v / total for k, v in baseline_probs.items()}
    
    # Find candidate tokens
    identifier_pattern = re.compile(r'\b[a-zA-Z_][a-zA-Z0-9_]*\b')
    candidates = []
    
    start_line = max(0, cursor_line - 5)
    end_line = min(len(lines), cursor_line + 2)
    
    for line_idx in range(start_line, end_line):
        line = lines[line_idx]
        for match in identifier_pattern.finditer(line):
            if len(match.group()) < 2:
                continue
            candidates.append({
                'line': line_idx + 1,
                'character': match.start(),
                'token_text': match.group()
            })
    
    # Limit candidates
    def distance_to_cursor(cand):
        line_dist = abs(cand['line'] - cursor_line)
        char_dist = abs(cand['character'] - cursor_char) if line_dist == 0 else 0
        return (line_dist, char_dist)
    
    candidates.sort(key=distance_to_cursor)
    candidates = candidates[:10]
    
    # Calculate KL for each candidate
    results = []
    
    for candidate in candidates:
        # Remove token
        target_line_idx = candidate['line'] - 1
        if target_line_idx < 0 or target_line_idx >= len(lines):
            continue
        
        target_line = lines[target_line_idx]
        char = candidate['character']
        token_text = candidate['token_text']
        end_char = char + len(token_text)
        
        new_line = target_line[:char] + target_line[end_char:]
        new_lines = lines.copy()
        new_lines[target_line_idx] = new_line
        
        # Build new prefix
        if cursor_line < 1:
            new_prefix = ""
        elif cursor_line > len(new_lines):
            new_prefix = '\n'.join(new_lines)
        else:
            new_prefix_lines = new_lines[:cursor_line - 1]
            new_prefix_lines.append(new_lines[cursor_line - 1][:cursor_char])
            new_prefix = '\n'.join(new_prefix_lines)
        
        # Get perturbed distribution
        perturbed_data = get_prediction(new_prefix)
        if not perturbed_data:
            continue
        
        choice = perturbed_data['choices'][0]
        logprobs_data = choice.get('logprobs', {})
        top_logprobs = logprobs_data.get('top_logprobs', [{}])[0] if logprobs_data.get('top_logprobs') else {}
        
        perturbed_items = list(top_logprobs.items())
        if not perturbed_items:
            continue
        
        max_logprob = max(v for k, v in perturbed_items)
        perturbed_probs = {k: math.exp(v - max_logprob) for k, v in perturbed_items}
        total = sum(perturbed_probs.values())
        perturbed_probs = {k: v / total for k, v in perturbed_probs.items()}
        
        # Calculate KL divergence
        kl = 0.0
        for token, p in baseline_probs.items():
            q = perturbed_probs.get(token, 1e-10)
            if p > 0:
                kl += p * math.log(p / q)
        
        if kl > 0.001:
            results.append({
                'line': candidate['line'],
                'character': candidate['character'],
                'tokenText': candidate['token_text'],
                'klDivergence': kl
            })
        
        time.sleep(0.1)  # Rate limiting
    
    results.sort(key=lambda x: x['klDivergence'], reverse=True)
    
    return {
        'tokens': results[:10],
        'baseEntropy': calculate_entropy(top_logprobs)
    }


def tokenize_simple(code: str):
    """Simple tokenizer."""
    import re
    tokens = []
    pos = 0
    for match in re.finditer(r'\w+|[^\w\s]', code):
        tokens.append({
            'text': match.group(),
            'start': match.start(),
            'end': match.end()
        })
    return tokens


def compute_token_ranks(code: str):
    """Compute rank for each token in the code."""
    import math
    
    tokens = tokenize_simple(code)
    results = []
    
    for i, tok in enumerate(tokens):
        # Get prefix up to this token
        prefix = code[:tok['start']]
        
        if not prefix.strip():
            # First token
            results.append({
                'token': tok['text'],
                'position': tok['start'],
                'logprob': -0.1,
                'rank': 1,
                'isInTop5': True
            })
            continue
        
        print(f"  Analyzing token {i+1}/{len(tokens)}: '{tok['text']}'")
        
        data = get_prediction(prefix)
        if not data:
            results.append({
                'token': tok['text'],
                'position': tok['start'],
                'logprob': -0.1,
                'rank': 1,
                'isInTop5': True
            })
            time.sleep(0.5)
            continue
        
        choice = data['choices'][0]
        logprobs_data = choice.get('logprobs', {})
        top_logprobs = logprobs_data.get('top_logprobs', [{}])[0] if logprobs_data.get('top_logprobs') else {}
        
        # Find rank of actual token
        actual_token = tok['text']
        rank = -1
        top_list = sorted(top_logprobs.items(), key=lambda x: x[1], reverse=True)
        
        for idx, (predicted_token, logprob) in enumerate(top_list):
            if predicted_token.strip() == actual_token.strip():
                rank = idx + 1
                actual_logprob = logprob
                break
        
        if rank == -1:
            rank = 6  # Not in top 5
            actual_logprob = -5.0
        
        results.append({
            'token': actual_token,
            'position': tok['start'],
            'logprob': actual_logprob,
            'rank': rank,
            'isInTop5': rank <= 5
        })
        
        time.sleep(0.5)  # Rate limiting between tokens
    
    return results


def main():
    print("=" * 60)
    print("Precomputing API responses for test_preset.py")
    print("=" * 60)
    
    # Read test_preset.py
    with open('/home/amitav-krishna/codage/projets/cerebras-challenge/test_preset.py', 'r') as f:
        code = f.read()
    
    print(f"\nCode to precompute:\n{code}\n")
    
    precomputed = {
        'code': code,
        'token_ranks': [],
        'ghosts': {},  # key: "line:char" -> ghost data
        'entropies': {},  # key: "line:char" -> entropy data
        'saliencies': {}  # key: "line:char" -> saliency data
    }
    
    lines = code.split('\n')
    
    # 1. Compute token ranks (for the /analyze endpoint)
    print("\n[1/4] Computing token ranks...")
    precomputed['token_ranks'] = compute_token_ranks(code)
    
    # 2. Compute ghost and entropy for every cursor position
    print("\n[2/4] Computing ghost tokens and entropy...")
    
    for line_idx, line in enumerate(lines):
        line_num = line_idx + 1
        for char_pos in range(len(line) + 1):
            key = f"{line_num}:{char_pos}"
            
            # Build prefix
            prefix_lines = lines[:line_idx]
            prefix_lines.append(line[:char_pos])
            prefix = '\n'.join(prefix_lines)
            
            ghost = get_ghost_response(prefix)
            if ghost:
                precomputed['ghosts'][key] = ghost
            
            entropy = get_entropy_response(prefix)
            if entropy:
                precomputed['entropies'][key] = entropy
            
            time.sleep(0.2)
        
        print(f"  Line {line_num}/{len(lines)} done")
    
    # 3. Compute saliency for key positions
    print("\n[3/4] Computing saliency...")
    
    # Saliency at end of each line
    for line_idx, line in enumerate(lines):
        line_num = line_idx + 1
        char_pos = len(line)
        key = f"{line_num}:{char_pos}"
        
        saliency = get_saliency_response(code, line_num, char_pos)
        if saliency:
            precomputed['saliencies'][key] = saliency
        
        print(f"  Saliency for line {line_num} done")
        time.sleep(0.5)
    
    # Save to file
    output_path = '/home/amitav-krishna/codage/projets/cerebras-challenge/cerebras-hud/precomputed.json'
    with open(output_path, 'w') as f:
        json.dump(precomputed, f, indent=2)
    
    print(f"\n[4/4] Saved precomputed data to {output_path}")
    print(f"  - {len(precomputed['token_ranks'])} token ranks")
    print(f"  - {len(precomputed['ghosts'])} ghost positions")
    print(f"  - {len(precomputed['entropies'])} entropy positions")
    print(f"  - {len(precomputed['saliencies'])} saliency positions")
    print("\n" + "=" * 60)
    print("Precomputation complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
