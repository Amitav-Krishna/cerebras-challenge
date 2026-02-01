"""
Python API server for Cerebras HUD.
"""
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import uvicorn
import requests
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# --- Configuration ---
# Replace with your actual Cerebras API endpoint and token
CEREBRAS_API_URL = os.environ.get("CEREBRAS_API_URL", "https://api.cerebras.com/v1/completions")
CEREBRAS_API_TOKEN = os.environ.get("CEREBRAS_API_TOKEN", "YOUR_CEREBRAS_API_TOKEN")

# --- Pydantic Models ---
# Based on API_INTEGRATION_SPEC.md

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

# --- FastAPI App ---
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allows all origins
    allow_credentials=True,
    allow_methods=["*"], # Allows all methods
    allow_headers=["*"], # Allows all headers
)

# --- Cerebras API Integration ---

def get_cerebras_logprobs(code: str):
    """
    Calls the Cerebras API to get logprobs for the given code.
    """
    if not CEREBRAS_API_TOKEN or CEREBRAS_API_TOKEN == "YOUR_CEREBRAS_API_TOKEN":
        raise HTTPException(
            status_code=500,
            detail="Cerebras API token is not configured. Please set the CEREBRAS_API_TOKEN environment variable."
        )
        
    headers = {
        "Authorization": f"Bearer {CEREBRAS_API_TOKEN}",
        "Content-Type": "application/json",
    }
    
    # Payload to get logprobs for the input prompt tokens
    # 'echo=True' includes the prompt tokens in the response
    # 'max_tokens=1' ensures we only get logprobs for the prompt, not a completion
    payload = {
        "model": "llama-3.1-8b", # Or your desired model
        "prompt": code,
        "logprobs": True,
        "max_tokens": 1,
        "echo": True
    }
    
    response = requests.post(CEREBRAS_API_URL, headers=headers, json=payload)
    
    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Error from Cerebras API: {response.text}"
        )
        
    return response.json()

def map_to_file_probs(uri: str, code: str, cerebras_response: dict) -> FileProbs:
    """
    Maps the flat list of token logprobs from Cerebras to the line-based
    FileProbs structure required by the frontend.
    """
    if not cerebras_response or 'choices' not in cerebras_response or not cerebras_response['choices']:
        raise HTTPException(status_code=500, detail="Invalid response from Cerebras API")

    logprobs_data = cerebras_response['choices'][0].get('logprobs', {})
    tokens_text = logprobs_data.get('tokens', [])
    token_logprobs = logprobs_data.get('token_logprobs', [])

    # Filter out the special end-of-text token if present
    if tokens_text and tokens_text[-1] == '<|endoftext|>':
        tokens_text = tokens_text[:-1]
        token_logprobs = token_logprobs[:-1]

    lines = code.split('\n')
    line_probs_list: List[LineProbs] = []
    
    current_token_index = 0
    for i, line_content in enumerate(lines):
        line_number = i + 1
        line_tokens: List[TokenProb] = []
        
        line_len_processed = 0
        while current_token_index < len(tokens_text):
            token_str = tokens_text[current_token_index]
            logprob = token_logprobs[current_token_index]

            line_tokens.append(TokenProb(token=token_str, logprob=logprob))
            
            line_len_processed += len(token_str)
            current_token_index += 1

            # If we have processed all characters in the current line, move to the next line
            if line_len_processed >= len(line_content):
                break
                
        line_probs_list.append(LineProbs(line_number=line_number, tokens=line_tokens))

    return FileProbs(uri=uri, lines=line_probs_list)


@app.post("/analyze", response_model=FileProbs)
def analyze(req: AnalyzeRequest):
    """
    Analyzes code by fetching logprobs from the Cerebras API and
    returns them in the format expected by the VS Code extension.
    """

    cerebras_response = get_cerebras_logprobs(req.code)
    file_probs = map_to_file_probs(req.uri, req.code, cerebras_response)
    
    return file_probs

if __name__ == "__main__":
    print("Starting API server on http://localhost:8000")
    print("NOTE: Set the CEREBRAS_API_TOKEN environment variable.")
    uvicorn.run(app, host="0.0.0.0", port=8000)
