export interface TokenProb {
    token: string;
    logprob: number;
}

export interface LineProbs {
    line_number: number;
    tokens: TokenProb[];
}

export interface FileProbs {
    uri: string;
    lines: LineProbs[];
}
