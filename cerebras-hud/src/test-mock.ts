import { analyze } from './mock/mockAnalyzer';

const testCode = `def add(x, y: int) -> string:
    return x - y;`;

const result = analyze(testCode, "test.py");
console.log(JSON.stringify(result, null, 2));
