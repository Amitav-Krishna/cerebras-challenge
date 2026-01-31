import { FileProbs } from '../types/logprobs';

// Sample output for test.py
export const sampleProbs: FileProbs = {
    uri: "file:///test.py",
    lines: [
        {
            line_number: 1,
            tokens: [
                { token: "def", logprob: -0.1 },
                { token: " add", logprob: -0.2 },
                { token: "(", logprob: -0.05 },
                { token: "x", logprob: -0.8 },
                { token: ",", logprob: -0.1 },
                { token: " y", logprob: -0.3 },
                { token: ":", logprob: -0.05 },
                { token: " int", logprob: -0.15 },
                { token: ")", logprob: -0.05 },
                { token: " ->", logprob: -0.4 },
                { token: " string", logprob: -2.5 },  // High confusion!
                { token: ":", logprob: -0.05 }
            ]
        },
        {
            line_number: 2,
            tokens: [
                { token: "    ", logprob: 0 },
                { token: "return", logprob: -0.1 },
                { token: " x", logprob: -0.3 },
                { token: " -", logprob: -0.5 },
                { token: " y", logprob: -0.3 },
                { token: ";", logprob: -1.2 }  // Semi-colon in Python
            ]
        }
    ]
};
