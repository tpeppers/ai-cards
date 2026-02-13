import {
  StrategyAST, PlaySection, RuleBlock, Rule, Action,
  Expression, BinaryExpr, UnaryExpr, VariableExpr,
  LiteralExpr, FunctionCallExpr, PropertyAccessExpr,
  PlayAction, BidAction, PassAction, ChooseAction,
  KeepAction, DropAction,
} from './types.ts';

// ── Tokenizer ───────────────────────────────────────────────────────

interface Token {
  type: 'keyword' | 'ident' | 'number' | 'string' | 'op' | 'colon' | 'dot' | 'lparen' | 'rparen' | 'comma' | 'newline' | 'indent' | 'dedent' | 'eof';
  value: string;
  line: number;
}

const KEYWORDS = new Set([
  'strategy', 'game', 'play', 'bid', 'trump', 'discard', 'leading', 'following', 'void',
  'when', 'default', 'pass', 'choose', 'keep', 'drop', 'suit', 'direction',
  'and', 'or', 'not', 'true', 'false',
]);

function tokenize(source: string): Token[] {
  const lines = source.split('\n');
  const tokens: Token[] = [];
  const indentStack: number[] = [0];

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const rawLine = lines[lineNum];
    // Strip comments
    const commentIdx = rawLine.indexOf('#');
    const line = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;

    // Skip blank lines
    if (line.trim().length === 0) continue;

    // Calculate indentation (number of leading spaces)
    const indent = line.length - line.trimStart().length;
    const currentIndent = indentStack[indentStack.length - 1];

    if (indent > currentIndent) {
      indentStack.push(indent);
      tokens.push({ type: 'indent', value: '', line: lineNum });
    } else {
      while (indent < indentStack[indentStack.length - 1]) {
        indentStack.pop();
        tokens.push({ type: 'dedent', value: '', line: lineNum });
      }
    }

    // Tokenize the line content
    const trimmed = line.trimStart();
    let pos = 0;

    while (pos < trimmed.length) {
      // Skip whitespace
      if (trimmed[pos] === ' ' || trimmed[pos] === '\t') {
        pos++;
        continue;
      }

      // String literal
      if (trimmed[pos] === '"') {
        let str = '';
        pos++; // skip opening quote
        while (pos < trimmed.length && trimmed[pos] !== '"') {
          str += trimmed[pos];
          pos++;
        }
        pos++; // skip closing quote
        tokens.push({ type: 'string', value: str, line: lineNum });
        continue;
      }

      // Number
      if (/[0-9]/.test(trimmed[pos]) || (trimmed[pos] === '-' && pos + 1 < trimmed.length && /[0-9]/.test(trimmed[pos + 1]))) {
        let num = '';
        if (trimmed[pos] === '-') {
          num += '-';
          pos++;
        }
        while (pos < trimmed.length && /[0-9]/.test(trimmed[pos])) {
          num += trimmed[pos];
          pos++;
        }
        tokens.push({ type: 'number', value: num, line: lineNum });
        continue;
      }

      // Operators
      if (trimmed[pos] === '=' && trimmed[pos + 1] === '=') {
        tokens.push({ type: 'op', value: '==', line: lineNum });
        pos += 2;
        continue;
      }
      if (trimmed[pos] === '!' && trimmed[pos + 1] === '=') {
        tokens.push({ type: 'op', value: '!=', line: lineNum });
        pos += 2;
        continue;
      }
      if (trimmed[pos] === '>' && trimmed[pos + 1] === '=') {
        tokens.push({ type: 'op', value: '>=', line: lineNum });
        pos += 2;
        continue;
      }
      if (trimmed[pos] === '<' && trimmed[pos + 1] === '=') {
        tokens.push({ type: 'op', value: '<=', line: lineNum });
        pos += 2;
        continue;
      }
      if (trimmed[pos] === '>') {
        tokens.push({ type: 'op', value: '>', line: lineNum });
        pos++;
        continue;
      }
      if (trimmed[pos] === '<') {
        tokens.push({ type: 'op', value: '<', line: lineNum });
        pos++;
        continue;
      }

      // Arithmetic operators
      if (trimmed[pos] === '+') { tokens.push({ type: 'op', value: '+', line: lineNum }); pos++; continue; }
      if (trimmed[pos] === '-') {
        // Treat as minus operator if the previous token is a value-like token
        const lastTok = tokens.length > 0 ? tokens[tokens.length - 1] : null;
        if (lastTok && ['number', 'rparen', 'ident'].includes(lastTok.type)) {
          tokens.push({ type: 'op', value: '-', line: lineNum }); pos++; continue;
        }
      }

      // Single-char tokens
      if (trimmed[pos] === ':') { tokens.push({ type: 'colon', value: ':', line: lineNum }); pos++; continue; }
      if (trimmed[pos] === '.') { tokens.push({ type: 'dot', value: '.', line: lineNum }); pos++; continue; }
      if (trimmed[pos] === '(') { tokens.push({ type: 'lparen', value: '(', line: lineNum }); pos++; continue; }
      if (trimmed[pos] === ')') { tokens.push({ type: 'rparen', value: ')', line: lineNum }); pos++; continue; }
      if (trimmed[pos] === ',') { tokens.push({ type: 'comma', value: ',', line: lineNum }); pos++; continue; }

      // Identifiers and keywords
      if (/[a-zA-Z_]/.test(trimmed[pos])) {
        let ident = '';
        while (pos < trimmed.length && /[a-zA-Z0-9_]/.test(trimmed[pos])) {
          ident += trimmed[pos];
          pos++;
        }
        // Handle hyphenated keywords like downtown-noaces
        if (trimmed[pos] === '-' && pos + 1 < trimmed.length && /[a-zA-Z]/.test(trimmed[pos + 1])) {
          ident += '-';
          pos++;
          while (pos < trimmed.length && /[a-zA-Z0-9_]/.test(trimmed[pos])) {
            ident += trimmed[pos];
            pos++;
          }
        }
        if (KEYWORDS.has(ident)) {
          tokens.push({ type: 'keyword', value: ident, line: lineNum });
        } else {
          tokens.push({ type: 'ident', value: ident, line: lineNum });
        }
        continue;
      }

      // Unknown character - skip
      pos++;
    }

    tokens.push({ type: 'newline', value: '', line: lineNum });
  }

  // Close remaining indentation
  while (indentStack.length > 1) {
    indentStack.pop();
    tokens.push({ type: 'dedent', value: '', line: lines.length });
  }

  tokens.push({ type: 'eof', value: '', line: lines.length });
  return tokens;
}

// ── Parser ──────────────────────────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos] || { type: 'eof', value: '', line: -1 };
  }

  private advance(): Token {
    const tok = this.tokens[this.pos];
    this.pos++;
    return tok;
  }

  private expect(type: string, value?: string): Token {
    const tok = this.advance();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new Error(`Parse error at line ${tok.line + 1}: expected ${type}${value ? ` "${value}"` : ''}, got ${tok.type} "${tok.value}"`);
    }
    return tok;
  }

  private skipNewlines(): void {
    while (this.peek().type === 'newline') {
      this.advance();
    }
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'eof';
  }

  parse(): StrategyAST {
    const ast: StrategyAST = { name: '', game: '' };

    this.skipNewlines();

    // Parse strategy name
    if (this.peek().type === 'keyword' && this.peek().value === 'strategy') {
      this.advance();
      ast.name = this.expect('string').value;
      this.skipNewlines();
    }

    // Parse game type
    if (this.peek().type === 'keyword' && this.peek().value === 'game') {
      this.advance();
      this.expect('colon');
      ast.game = this.expect('ident').value;
      this.skipNewlines();
    }

    // Parse sections
    while (!this.isAtEnd()) {
      this.skipNewlines();
      if (this.isAtEnd()) break;

      const tok = this.peek();
      if (tok.type === 'keyword' && tok.value === 'play') {
        this.advance();
        this.expect('colon');
        this.skipNewlines();
        ast.play = this.parsePlaySection();
      } else if (tok.type === 'keyword' && tok.value === 'bid') {
        this.advance();
        this.expect('colon');
        this.skipNewlines();
        ast.bid = this.parseRuleBlock();
      } else if (tok.type === 'keyword' && tok.value === 'trump') {
        this.advance();
        this.expect('colon');
        this.skipNewlines();
        ast.trump = this.parseRuleBlock();
      } else if (tok.type === 'keyword' && tok.value === 'discard') {
        this.advance();
        this.expect('colon');
        this.skipNewlines();
        ast.discard = this.parseRuleBlock();
      } else {
        this.advance(); // skip unknown
      }
    }

    return ast;
  }

  private parsePlaySection(): PlaySection {
    const section: PlaySection = {};

    this.expect('indent');
    this.skipNewlines();

    while (this.peek().type !== 'dedent' && !this.isAtEnd()) {
      this.skipNewlines();
      if (this.peek().type === 'dedent' || this.isAtEnd()) break;

      const tok = this.peek();
      if (tok.type === 'keyword' || tok.type === 'ident') {
        const name = tok.value;
        this.advance();
        this.expect('colon');
        this.skipNewlines();

        if (name === 'leading') {
          section.leading = this.parseRuleBlock();
        } else if (name === 'following') {
          section.following = this.parseRuleBlock();
        } else if (name === 'void') {
          section.void = this.parseRuleBlock();
        }
      } else {
        this.advance();
      }
    }

    if (this.peek().type === 'dedent') {
      this.advance();
    }

    return section;
  }

  private parseRuleBlock(): RuleBlock {
    const block: RuleBlock = { rules: [] };

    this.expect('indent');
    this.skipNewlines();

    while (this.peek().type !== 'dedent' && !this.isAtEnd()) {
      this.skipNewlines();
      if (this.peek().type === 'dedent' || this.isAtEnd()) break;

      const tok = this.peek();

      if (tok.type === 'keyword' && tok.value === 'when') {
        this.advance();
        const condition = this.parseExpression();
        this.expect('colon');
        this.skipNewlines();

        // The action may be indented (block) or on the same line
        if (this.peek().type === 'indent') {
          this.advance();
          this.skipNewlines();
          const action = this.parseAction();
          this.skipNewlines();
          // Skip any additional lines in this block
          while (this.peek().type !== 'dedent' && !this.isAtEnd() && this.peek().type !== 'keyword') {
            if (this.peek().type === 'newline') { this.advance(); continue; }
            break;
          }
          if (this.peek().type === 'dedent') this.advance();
          block.rules.push({ condition, action });
        } else {
          const action = this.parseAction();
          block.rules.push({ condition, action });
        }
      } else if (tok.type === 'keyword' && tok.value === 'default') {
        this.advance();
        this.expect('colon');
        this.skipNewlines();

        if (this.peek().type === 'indent') {
          this.advance();
          this.skipNewlines();
          block.defaultAction = this.parseAction();
          this.skipNewlines();
          while (this.peek().type !== 'dedent' && !this.isAtEnd() && this.peek().type !== 'keyword') {
            if (this.peek().type === 'newline') { this.advance(); continue; }
            break;
          }
          if (this.peek().type === 'dedent') this.advance();
        } else {
          block.defaultAction = this.parseAction();
        }
      } else {
        this.advance();
      }

      this.skipNewlines();
    }

    if (this.peek().type === 'dedent') {
      this.advance();
    }

    return block;
  }

  private parseAction(): Action {
    const tok = this.peek();

    if (tok.type === 'keyword' && tok.value === 'play') {
      this.advance();
      const cardExpr = this.parseExpression();
      this.skipNewlines();
      return { type: 'play', cardExpr } as PlayAction;
    }

    if (tok.type === 'keyword' && tok.value === 'bid') {
      this.advance();
      const next = this.peek();
      if (next.type === 'ident' && next.value === 'take') {
        this.advance();
        this.skipNewlines();
        return { type: 'bid', amountExpr: { type: 'literal', value: -1 } } as BidAction;
      }
      const amountExpr = this.parseExpression();
      this.skipNewlines();
      return { type: 'bid', amountExpr } as BidAction;
    }

    if (tok.type === 'keyword' && tok.value === 'pass') {
      this.advance();
      this.skipNewlines();
      return { type: 'pass' } as PassAction;
    }

    if (tok.type === 'keyword' && tok.value === 'keep') {
      this.advance();
      const cardSetExpr = this.parseExpression();
      this.skipNewlines();
      return { type: 'keep', cardSetExpr } as KeepAction;
    }

    if (tok.type === 'keyword' && tok.value === 'drop') {
      this.advance();
      const cardSetExpr = this.parseExpression();
      this.skipNewlines();
      return { type: 'drop', cardSetExpr } as DropAction;
    }

    if (tok.type === 'keyword' && tok.value === 'choose') {
      this.advance();
      // choose suit: <expr> direction: <expr>
      this.expect('keyword', 'suit');
      this.expect('colon');
      const suitExpr = this.parseExpression();
      this.expect('keyword', 'direction');
      this.expect('colon');
      const directionExpr = this.parseExpression();
      this.skipNewlines();
      return { type: 'choose', suitExpr, directionExpr } as ChooseAction;
    }

    throw new Error(`Parse error at line ${tok.line + 1}: expected action (play/bid/pass/choose/keep/drop), got ${tok.type} "${tok.value}"`);
  }

  // ── Expression Parsing (precedence climbing) ──────────────────────

  private parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let left = this.parseAnd();
    while (this.peek().type === 'keyword' && this.peek().value === 'or') {
      this.advance();
      const right = this.parseAnd();
      left = { type: 'binary', op: 'or', left, right } as BinaryExpr;
    }
    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseComparison();
    while (this.peek().type === 'keyword' && this.peek().value === 'and') {
      this.advance();
      const right = this.parseComparison();
      left = { type: 'binary', op: 'and', left, right } as BinaryExpr;
    }
    return left;
  }

  private parseComparison(): Expression {
    let left = this.parseAdditive();
    const ops = ['==', '!=', '>', '<', '>=', '<='];
    while (this.peek().type === 'op' && ops.includes(this.peek().value)) {
      const op = this.advance().value as BinaryExpr['op'];
      const right = this.parseAdditive();
      left = { type: 'binary', op, left, right } as BinaryExpr;
    }
    return left;
  }

  private parseAdditive(): Expression {
    let left = this.parseUnary();
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.advance().value as BinaryExpr['op'];
      const right = this.parseUnary();
      left = { type: 'binary', op, left, right } as BinaryExpr;
    }
    return left;
  }

  private parseUnary(): Expression {
    if (this.peek().type === 'keyword' && this.peek().value === 'not') {
      this.advance();
      const operand = this.parseUnary();
      return { type: 'unary', op: 'not', operand } as UnaryExpr;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expression {
    let expr = this.parsePrimary();

    while (true) {
      if (this.peek().type === 'dot') {
        this.advance();
        const prop = this.advance();
        if (prop.type !== 'ident' && prop.type !== 'keyword') {
          throw new Error(`Parse error at line ${prop.line + 1}: expected property name after '.', got ${prop.type} "${prop.value}"`);
        }

        // Check for method call: .method(args)
        if (this.peek().type === 'lparen') {
          this.advance(); // skip (
          const args: Expression[] = [];
          if (this.peek().type !== 'rparen') {
            args.push(this.parseExpression());
            while (this.peek().type === 'comma') {
              this.advance();
              args.push(this.parseExpression());
            }
          }
          this.expect('rparen');
          expr = { type: 'property', object: expr, property: prop.value, args } as PropertyAccessExpr;
        } else {
          expr = { type: 'property', object: expr, property: prop.value } as PropertyAccessExpr;
        }
      } else {
        break;
      }
    }

    return expr;
  }

  private parsePrimary(): Expression {
    const tok = this.peek();

    // Parenthesized expression
    if (tok.type === 'lparen') {
      this.advance();
      const expr = this.parseExpression();
      this.expect('rparen');
      return expr;
    }

    // Number literal
    if (tok.type === 'number') {
      this.advance();
      return { type: 'literal', value: parseInt(tok.value, 10) } as LiteralExpr;
    }

    // String literal
    if (tok.type === 'string') {
      this.advance();
      return { type: 'literal', value: tok.value } as LiteralExpr;
    }

    // Boolean literals
    if (tok.type === 'keyword' && tok.value === 'true') {
      this.advance();
      return { type: 'literal', value: true } as LiteralExpr;
    }
    if (tok.type === 'keyword' && tok.value === 'false') {
      this.advance();
      return { type: 'literal', value: false } as LiteralExpr;
    }

    // Identifier (variable or function call)
    if (tok.type === 'ident' || tok.type === 'keyword') {
      const name = tok.value;
      this.advance();

      // Function call
      if (this.peek().type === 'lparen') {
        this.advance(); // skip (
        const args: Expression[] = [];
        if (this.peek().type !== 'rparen') {
          args.push(this.parseExpression());
          while (this.peek().type === 'comma') {
            this.advance();
            args.push(this.parseExpression());
          }
        }
        this.expect('rparen');
        return { type: 'call', name, args } as FunctionCallExpr;
      }

      return { type: 'variable', name } as VariableExpr;
    }

    throw new Error(`Parse error at line ${tok.line + 1}: unexpected token ${tok.type} "${tok.value}"`);
  }
}

// ── Public API ──────────────────────────────────────────────────────

export function parseStrategy(source: string): StrategyAST {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parse();
}
