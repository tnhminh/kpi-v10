import { describe, expect, it } from "vitest";
import { evaluateFormula, FormulaError, validateFormulaSyntax } from "./formula";

describe("safe formula evaluator", () => {
  it("respects arithmetic precedence", () => {
    expect(evaluateFormula("1 + 2 * 3", {})).toBe(7);
    expect(evaluateFormula("(1 + 2) * 3", {})).toBe(9);
  });

  it("supports variables and unary signs", () => {
    expect(evaluateFormula("-a + b / 2", { a: 2, b: 8 })).toBe(2);
  });

  it("rejects code-like syntax", () => {
    expect(() => evaluateFormula("process.exit(1)", {})).toThrow(FormulaError);
    expect(() => evaluateFormula("value; 10", { value: 1 })).toThrow(FormulaError);
  });

  it("rejects missing variables and division by zero", () => {
    expect(() => evaluateFormula("a + b", { a: 1 })).toThrow(/Missing or invalid variable/);
    expect(() => evaluateFormula("1 / 0", {})).toThrow(/Division by zero/);
  });

  it("validates syntax without requiring runtime variables or evaluating arithmetic", () => {
    expect(() => validateFormulaSyntax("value / (target - 1)")).not.toThrow();
    expect(() => validateFormulaSyntax("value +")).toThrow(FormulaError);
    expect(() => validateFormulaSyntax("process.exit(1)")).toThrow(FormulaError);
  });
});
