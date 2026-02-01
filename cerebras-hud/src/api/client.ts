import { FileProbs } from '../types/logprobs';
import { analyze as mockAnalyze } from '../mock/mockAnalyzer';

// Set to false when ready to use real API
const USE_MOCK = false;
const API_URL = 'http://localhost:8000/analyze';

export async function analyze(code: string, uri: string): Promise<FileProbs> {
    if (USE_MOCK) {
        return mockAnalyze(code, uri);
    }

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, uri })
    });

    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }

    return response.json();
}
