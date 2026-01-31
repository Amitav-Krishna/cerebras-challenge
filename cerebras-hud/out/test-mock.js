"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mockAnalyzer_1 = require("./mock/mockAnalyzer");
const testCode = `def add(x, y: int) -> string:
    return x - y;`;
const result = (0, mockAnalyzer_1.analyze)(testCode, "test.py");
console.log(JSON.stringify(result, null, 2));
