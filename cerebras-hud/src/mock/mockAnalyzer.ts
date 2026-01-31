import { FileProbs, LineProbs, TokenProb } from '../types/logprobs';

export function analyze(code: string, uri: string): FileProbs {
    const lines = code.split('\n');
    
    return {
        uri: uri,
        lines: lines.map((line, i) => analyzeLine(line, i + 1))
    };
}

function analyzeLine(line: string, lineNum: number): LineProbs {
    const tokens = tokenize(line);
    
    return {
        line_number: lineNum,
        tokens: tokens.map((tok, i) => ({
            token: tok,
            logprob: getLogprob(tok, lineNum, i)
        }))
    };
}

function tokenize(line: string): string[] {
    // Very simple tokenizer - splits on word boundaries
    const tokens: string[] = [];
    let current = '';
    
    for (const char of line) {
        if (/\w/.test(char)) {
            current += char;
        } else {
            if (current) {
                tokens.push(current);
                current = '';
            }
            if (!/\s/.test(char)) {
                tokens.push(char);
            } else if (tokens.length > 0) {
                // Attach leading whitespace to next token for display
                current = char;
            }
        }
    }
    if (current && !/^\s+$/.test(current)) {
        tokens.push(current);
    }
    
    return tokens;
}

function getLogprob(token: string, lineNum: number, pos: number): number {
    const trimmed = token.trim();
    
    // Spread out logprobs for visible color variety
    if (trimmed === 'def') {
        return -0.1;   // Bright green - very confident
    }
    if (trimmed === 'add') {
        return -0.6;   // Light green
    }
    if (trimmed === 'x' && lineNum === 1) {
        return -1.5;   // Yellow - untyped param
    }
    if (trimmed === 'y') {
        return -0.8;   // Yellow-green
    }
    if (trimmed === 'int') {
        return -0.2;   // Green
    }
    if (trimmed === 'string') {
        return -3.0;   // Red - very confused (Python uses 'str')
    }
    if (trimmed === 'return') {
        return -0.3;   // Green
    }
    if (trimmed === '-') {
        return -0.5;   // Light green
    }
    if (trimmed === ';') {
        return -4.0;   // Dark red - semicolon in Python is weird
    }
    if (['(', ')', ':', ',', '->'].includes(trimmed)) {
        return -0.15;  // Bright green - punctuation is clear
    }
    
    return -0.7;
}
