export class FormulaError extends Error {}

type Token =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "left" }
  | { type: "right" };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = expression.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
      if (!match) throw new FormulaError("Invalid number in formula.");
      const value = Number(match[0]);
      if (!Number.isFinite(value)) throw new FormulaError("Formula contains a non-finite number.");
      tokens.push({ type: "number", value });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!match) throw new FormulaError("Invalid identifier in formula.");
      tokens.push({ type: "identifier", value: match[0] });
      index += match[0].length;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "left" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "right" });
      index += 1;
      continue;
    }
    throw new FormulaError(`Unsupported character '${char}' in formula.`);
  }
  return tokens;
}

function parseFormula(expression: string, variables: Record<string, number> | null): number {
  const tokens = tokenize(expression);
  let cursor = 0;
  const syntaxOnly = variables === null;

  const peek = () => tokens[cursor];
  const consume = () => tokens[cursor++];

  const parsePrimary = (): number => {
    const token = consume();
    if (!token) throw new FormulaError("Unexpected end of formula.");
    if (token.type === "number") return syntaxOnly ? 1 : token.value;
    if (token.type === "identifier") {
      if (syntaxOnly) return 1;
      const value = variables[token.value];
      if (value === undefined || !Number.isFinite(value)) throw new FormulaError(`Missing or invalid variable '${token.value}'.`);
      return value;
    }
    if (token.type === "operator" && (token.value === "+" || token.value === "-")) {
      const value = parsePrimary();
      return syntaxOnly ? 1 : token.value === "-" ? -value : value;
    }
    if (token.type === "left") {
      const value = parseExpression();
      if (consume()?.type !== "right") throw new FormulaError("Unclosed parenthesis in formula.");
      return syntaxOnly ? 1 : value;
    }
    throw new FormulaError("Unexpected token in formula.");
  };

  const parseTerm = (): number => {
    let value = parsePrimary();
    while (true) {
      const next = peek();
      if (!next || next.type !== "operator" || (next.value !== "*" && next.value !== "/")) break;
      const operator = consume();
      const right = parsePrimary();
      if (operator.type !== "operator") throw new FormulaError("Invalid operator.");
      if (syntaxOnly) {
        value = 1;
        continue;
      }
      if (operator.value === "/" && right === 0) throw new FormulaError("Division by zero in formula.");
      value = operator.value === "*" ? value * right : value / right;
    }
    return value;
  };

  const parseExpression = (): number => {
    let value = parseTerm();
    while (true) {
      const next = peek();
      if (!next || next.type !== "operator" || (next.value !== "+" && next.value !== "-")) break;
      const operator = consume();
      const right = parseTerm();
      if (operator.type !== "operator") throw new FormulaError("Invalid operator.");
      if (syntaxOnly) {
        value = 1;
        continue;
      }
      value = operator.value === "+" ? value + right : value - right;
    }
    return value;
  };

  if (tokens.length === 0) throw new FormulaError("Formula cannot be empty.");
  const result = parseExpression();
  if (cursor !== tokens.length) throw new FormulaError("Unexpected trailing formula token.");
  if (!syntaxOnly && !Number.isFinite(result)) throw new FormulaError("Formula result must be finite.");
  return result;
}

export function validateFormulaSyntax(expression: string): void {
  parseFormula(expression, null);
}

export function evaluateFormula(expression: string, variables: Record<string, number>): number {
  return parseFormula(expression, variables);
}
