"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyze = analyze;
const mockAnalyzer_1 = require("../mock/mockAnalyzer");
// Set to false when ready to use real API
const USE_MOCK = false;
const API_URL = 'http://localhost:8000/analyze';
async function analyze(code, uri) {
    if (USE_MOCK) {
        return (0, mockAnalyzer_1.analyze)(code, uri);
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
