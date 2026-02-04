"""
Precompute ALL data for the demo script.
This ensures instant playback without any API calls during the demo.
"""
import json
import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

CEREBRAS_API_URL = os.environ.get("CEREBRAS_API_URL", "https://api.cerebras.ai/v1/completions")
CEREBRAS_API_TOKEN = os.environ.get("CEREBRAS_API_TOKEN", "")

# The exact code that will be typed in the demo
DEMO_CODE_STATES = [
    # Progressive states
    "def calculate(x",
    "def calculate(x, y",
    "def calculate(x, y)",
    "def calculate(x, y):",
    "def calculate(x, y):\n    ",
    "def calculate(x, y):\n    return x / y",
    # After adding type hints
    "def calculate(x: int, y: int) -> int:\n    return x / y",
    # With process function
    "def calculate(x: int, y: int) -> int:\n    return x / y\n\ndef process(x):\n    return x - z",
    # Full code with analyze function
    """def calculate(x: int, y: int) -> int:
    return x / y

def process(x):
    return x - z

def analyze(data):
    result = []
    for item in data:
        if item > 0:
            result.append(item * 2)
    return result""",
]

def get_prediction(prefix: str):
    """Get prediction from Cerebras API."""
    if not prefix.strip():
        return None
        
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
    
    try:
        response = requests.post(CEREBRAS_API_URL, headers=headers, json=payload)
        if response.status_code == 200:
            return response.json()
        else:
            print(f"  Error {response.status_code}: {response.text[:100]}")
            return None
    except Exception as e:
        print(f"  Exception: {e}")
        return None

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

def main():
    print("=" * 70)
    print("Precomputing ALL Demo Data")
    print("=" * 70)
    
    precomputed = {
        "version": "1.0",
        "description": "Precomputed data for Cerebras HUD demo",
        "states": {}
    }
    
    # For each code state, precompute data at various cursor positions
    for i, code in enumerate(DEMO_CODE_STATES):
        print(f"\n[{i+1}/{len(DEMO_CODE_STATES)}] Processing code state:")
        print(f"  {code[:50].replace(chr(10), ' ')}...")
        
        state_data = {
            "code": code,
            "positions": {}
        }
        
        lines = code.split('\n')
        
        # Precompute for key positions in this state
        positions_to_compute = []
        
        # End of each line
        for line_idx, line in enumerate(lines):
            positions_to_compute.append((line_idx + 1, len(line)))
        
        # Some intermediate positions
        for line_idx, line in enumerate(lines):
            if len(line) > 5:
                positions_to_compute.append((line_idx + 1, len(line) // 2))
        
        # Remove duplicates
        positions_to_compute = list(set(positions_to_compute))
        positions_to_compute.sort()
        
        for line_num, char_pos in positions_to_compute:
            key = f"{line_num}:{char_pos}"
            
            # Build prefix
            prefix_lines = lines[:line_num - 1]
            if line_num <= len(lines):
                prefix_lines.append(lines[line_num - 1][:char_pos])
            prefix = '\n'.join(prefix_lines)
            
            if not prefix.strip():
                continue
            
            print(f"    Computing position {key}...", end=' ', flush=True)
            
            # Get prediction
            data = get_prediction(prefix)
            
            if data:
                choice = data['choices'][0]
                logprobs_data = choice.get('logprobs', {})
                top_logprobs = logprobs_data.get('top_logprobs', [{}])[0] if logprobs_data.get('top_logprobs') else {}
                
                top_list = [
                    {'token': k, 'logprob': v}
                    for k, v in sorted(top_logprobs.items(), key=lambda x: x[1], reverse=True)
                ]
                
                if len(top_list) >= 2:
                    margin = calculate_margin(top_logprobs)
                    
                    state_data["positions"][key] = {
                        "entropy": calculate_entropy(top_logprobs),
                        "maxLogprob": top_list[0]['logprob'] if top_list else -10,
                        "topLogprobs": top_list[:10],
                        "tokenCount": len(top_list),
                        "primary": top_list[0],
                        "secondary": top_list[1],
                        "margin": margin,
                        "shouldShowGhost": margin < 0.15
                    }
                    print("OK")
                else:
                    print("NO_DATA")
            else:
                print("FAILED")
            
            # Rate limiting
            time.sleep(0.3)
        
        precomputed["states"][f"state_{i}"] = state_data
    
    # Also precompute for the full final code at every position
    print("\n" + "=" * 70)
    print("Precomputing full code at EVERY cursor position...")
    print("=" * 70)
    
    final_code = DEMO_CODE_STATES[-1]
    lines = final_code.split('\n')
    
    full_precomputed = {
        "code": final_code,
        "ghosts": {},
        "entropies": {},
        "token_ranks": []
    }
    
    # Token ranks for final code
    print("\nComputing token ranks...")
    import re
    tokens = []
    for match in re.finditer(r'\w+|[^\w\s]', final_code):
        tokens.append({
            'text': match.group(),
            'start': match.start(),
            'end': match.end()
        })
    
    for j, tok in enumerate(tokens):
        prefix = final_code[:tok['start']]
        if not prefix.strip():
            full_precomputed["token_ranks"].append({
                'token': tok['text'],
                'position': tok['start'],
                'logprob': -0.1,
                'rank': 1,
                'isInTop5': True
            })
            continue
        
        print(f"  Token {j+1}/{len(tokens)}: {tok['text'][:20]}", end=' ', flush=True)
        
        data = get_prediction(prefix)
        if data:
            choice = data['choices'][0]
            logprobs_data = choice.get('logprobs', {})
            top_logprobs = logprobs_data.get('top_logprobs', [{}])[0] if logprobs_data.get('top_logprobs') else {}
            
            top_list = sorted(top_logprobs.items(), key=lambda x: x[1], reverse=True)
            
            rank = -1
            logprob = -5.0
            for idx, (predicted, lp) in enumerate(top_list):
                if predicted.strip() == tok['text'].strip():
                    rank = idx + 1
                    logprob = lp
                    break
            
            if rank == -1:
                rank = 6
            
            full_precomputed["token_ranks"].append({
                'token': tok['text'],
                'position': tok['start'],
                'logprob': logprob,
                'rank': rank,
                'isInTop5': rank <= 5
            })
            print(f"rank={rank}")
        else:
            full_precomputed["token_ranks"].append({
                'token': tok['text'],
                'position': tok['start'],
                'logprob': -0.1,
                'rank': 1,
                'isInTop5': True
            })
            print("FAILED (using default)")
        
        time.sleep(0.5)
    
    # Ghost and entropy for every position in final code
    print("\nComputing ghost and entropy for all positions...")
    for line_idx, line in enumerate(lines):
        line_num = line_idx + 1
        for char_pos in range(len(line) + 1):
            key = f"{line_num}:{char_pos}"
            
            prefix_lines = lines[:line_idx]
            prefix_lines.append(line[:char_pos])
            prefix = '\n'.join(prefix_lines)
            
            if not prefix.strip():
                continue
            
            data = get_prediction(prefix)
            if data:
                choice = data['choices'][0]
                logprobs_data = choice.get('logprobs', {})
                top_logprobs = logprobs_data.get('top_logprobs', [{}])[0] if logprobs_data.get('top_logprobs') else {}
                
                top_list = [
                    {'token': k, 'logprob': v}
                    for k, v in sorted(top_logprobs.items(), key=lambda x: x[1], reverse=True)
                ]
                
                if len(top_list) >= 2:
                    margin = calculate_margin(top_logprobs)
                    
                    full_precomputed["ghosts"][key] = {
                        "primary": top_list[0],
                        "secondary": top_list[1],
                        "margin": margin,
                        "shouldShowGhost": margin < 0.15
                    }
                    
                    full_precomputed["entropies"][key] = {
                        "entropy": calculate_entropy(top_logprobs),
                        "maxLogprob": top_list[0]['logprob'],
                        "topLogprobs": top_list[:10]
                    }
            
            time.sleep(0.2)
        
        print(f"  Line {line_num}/{len(lines)} done")
    
    # Save everything
    output_path = '/home/amitav-krishna/codage/projets/cerebras-challenge/cerebras-hud/demo_precomputed.json'
    with open(output_path, 'w') as f:
        json.dump({
            "demo_states": precomputed,
            "full_code": full_precomputed
        }, f, indent=2)
    
    print("\n" + "=" * 70)
    print(f"Saved to: {output_path}")
    print(f"  - {len(precomputed['states'])} demo states")
    print(f"  - {len(full_precomputed['token_ranks'])} token ranks")
    print(f"  - {len(full_precomputed['ghosts'])} ghost positions")
    print(f"  - {len(full_precomputed['entropies'])} entropy positions")
    print("=" * 70)

if __name__ == "__main__":
    main()
