/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { ParseErrorTypeEnum } from "src/enums";
import { RpyProgram } from "../interpreter/program";
import { LogCategory, logCatMessage } from "../logger";
import { CharacterTokenType, MetaTokenType, TokenType } from "../tokenizer/renpy-tokens";
import { Token, TokenListIterator, TokenPosition, tokenTypeToStringMap } from "../tokenizer/token-definitions";
import { Tokenizer } from "../tokenizer/tokenizer";
import { Vector } from "../utilities/vector";
import { DocumentRange, LogLevel, TextDocument } from "../utilities/vscode-wrappers";
import { AST, ASTNode } from "./ast-nodes";
import { GrammarRule } from "./grammar-rules";
import { RenpyStatementRule } from "./renpy-grammar-rules";

export interface ParseError {
    type: ParseErrorTypeEnum;
    currentToken: Token;
    nextToken: Token;
    expectedTokenType: TokenType | null;
    errorRange: DocumentRange;
}

type DocumentCache = { readonly documentVersion: number; readonly program: RpyProgram };

export class Parser {
    private static _documentCache = new Map<string, DocumentCache>();

    public static async parseDocument(document: TextDocument) {
        const cachedTokens = this._documentCache.get(document.filePath);
        if (cachedTokens?.documentVersion === document.version) {
            return cachedTokens.program;
        }

        return await this.runParser(document);
    }

    private static async runParser(document: TextDocument) {
        logCatMessage(LogLevel.Info, LogCategory.Parser, `Running parser on document: "${document.filePath}"`);

        const parser = new DocumentParser(document);
        await parser.initialize();

        const statementParser = new RenpyStatementRule();
        const ast = new AST();

        while (parser.hasNext()) {
            parser.skipEmptyLines();

            if (statementParser.test(parser)) {
                ast.append(statementParser.parse(parser));
                parser.expectEOL();
            }

            if (parser.hasNext()) {
                parser.next();
            }
        }

        // TODO: Store parse errors so they can be accessed later.

        const program = new RpyProgram();
        ast.process(program);

        this._documentCache.set(document.filePath, { documentVersion: document.version, program });
        return program;
    }
}

export class DocumentParser {
    private _it: TokenListIterator = null!;
    private _document: TextDocument;
    private _currentToken: Token = null!;

    private _errors: Vector<ParseError> = new Vector<ParseError>();

    private readonly INVALID_TOKEN = new Token(MetaTokenType.Invalid, new TokenPosition(0, 0, -1), new TokenPosition(0, 0, -1));

    private _parsed = false;

    constructor(document: TextDocument) {
        this._document = document;
    }

    public get document() {
        return this._document;
    }

    public locationFromCurrent(): DocumentRange {
        return this.current().getDocumentRange();
    }

    public locationFromNext(): DocumentRange {
        return this.peekNext().getDocumentRange();
    }

    public locationFromRange(range: DocumentRange): DocumentRange {
        return range;
    }

    // TODO: This should not be user facing code, will lead to bugs. Same for the tokenizer.
    public  initialize() {
        if (this._parsed) {
            throw new Error("DocumentParser.parse() called twice.");
        }

        this._parsed = true;
        const tokens =  Tokenizer.tokenizeDocument(this._document);
        this._it = tokens.getIterator();
        this._it.setFilter(new Set([MetaTokenType.Comment, CharacterTokenType.Whitespace]));

        this._currentToken = this.INVALID_TOKEN;
    }

    public next() {
        if (!this._it.hasNext()) {
            this.addError(ParseErrorTypeEnum.UnexpectedEndOfFile);
            return;
        }
        this._currentToken = this._it.token;
        this._it.next();
    }

    public previous() {
        if (!this._it.hasPrevious()) {
            return;
        }
        this._it.previous();
        this._currentToken = this._it.token;
    }

    public hasNext(): boolean {
        return this._it.hasNext();
    }

    public currentValue(): string {
        return this.current().getValue(this._document);
    }

    public current() {
        return this._currentToken;
    }

    public peekNext() {
        return this._it.token;
    }

    public peek(tokenType: TokenType) {
        return this.peekNext().type === tokenType || this.peekNext().hasMetaToken(tokenType);
    }

    public peekAnyOf(tokenTypes: TokenType[]) {
        for (const tokenType of tokenTypes) {
            if (this.peek(tokenType)) {
                return true;
            }
        }
        return false;
    }

    public peekValue(value: string) {
        var next = this.peekNext();

        if (next.type === MetaTokenType.EOF)
            return "";

        return next.getValue(this._document) === value;
    }

    public requireToken(tokenType: TokenType) {
        if (this.peek(tokenType)) {
            this.next();
            return true;
        }
        this.addError(ParseErrorTypeEnum.UnexpectedToken, tokenType);
        return false;
    }

    public optionalToken(tokenType: TokenType) {
        if (this.peek(tokenType)) {
            this.next();
            return true;
        }
        return false;
    }

    public optional<T extends ASTNode>(rule: GrammarRule<T>): T | null {
        if (!rule.test(this)) {
            return null;
        }
        return rule.parse(this);
    }

    public require<T extends ASTNode>(rule: GrammarRule<T>): T | null {
        return rule.parse(this);
    }

    public anyOfToken(tokenTypes: TokenType[]) {
        for (const tokenType of tokenTypes) {
            if (this.peek(tokenType)) {
                this.next();
                return true;
            }
        }
        this.addError(ParseErrorTypeEnum.UnexpectedToken);
        return false;
    }

    public anyOf<T extends ASTNode>(rules: GrammarRule<T>[]): T | null {
        for (const rule of rules) {
            if (rule.test(this)) {
                return rule.parse(this);
            }
        }
        this.addError(ParseErrorTypeEnum.UnexpectedEndOfLine);
        return null;
    }

    public skipEmptyLines() {
        while (this.peek(CharacterTokenType.NewLine)) {
            this.next();
        }
    }

    public skipToEOL() {
        while (!this.peekAnyOf([CharacterTokenType.NewLine, MetaTokenType.EOF])) {
            this.next();
        }
    }

    /**
     * Expects an end of line token. If an unexpected end of line is found, an error is added to the error list.
     * @returns True if an unexpected end of line was found.
     */
    public expectEOL() {
        const isUnexpectedEndOfLine = !this.peekAnyOf([CharacterTokenType.NewLine, MetaTokenType.EOF])
        if (isUnexpectedEndOfLine) {
            const start = this.peekNext();

            this.skipToEOL();

            const end = this.current();

            this._errors.pushBack({
                type: ParseErrorTypeEnum.UnexpectedEndOfLine,
                currentToken: start,
                nextToken: end,
                expectedTokenType: null,
                errorRange: new DocumentRange(start.startPos, end.endPos),
            });
        }
        return isUnexpectedEndOfLine;
    }

    public get errors() {
        return this._errors;
    }

    public addError(errorType: ParseErrorTypeEnum, expectedToken: TokenType | null = null, errorRange: DocumentRange | null = null) {
        const nextToken = this.peekNext();
        this._errors.pushBack({
            type: errorType,
            currentToken: this.current(),
            nextToken: nextToken,
            expectedTokenType: expectedToken,
            errorRange: errorRange ?? new DocumentRange(nextToken.startPos, nextToken.endPos),
        });
    }

    public printErrors() {
        for (const error of this._errors) {
            logCatMessage(LogLevel.Error, LogCategory.Parser, this.getErrorMessage(error));
        }
    }

    /**
     * Prints all token types from the current token to the end of the line.
     */
    public debugPrintLine() {
        const itCopy = this._it.clone();
        let output = "Next line tokens: [\n";
        while (itCopy.hasNext() && itCopy.token.type !== CharacterTokenType.NewLine) {
            output += `  ${itCopy.token.toString()},\n`;
            itCopy.next();
        }
        output = output.slice(0, -2); // Remove the last comma and space.
        output += "\n]";
        logCatMessage(LogLevel.Debug, LogCategory.Parser, output);
    }

    public getErrorMessage(error: ParseError) {
        switch (error.type) {
            case ParseErrorTypeEnum.UnexpectedEndOfFile:
                return "Unexpected end of file";
            case ParseErrorTypeEnum.UnexpectedToken:
                return `Syntax error: Expected token of type '${this.getTokenTypeString(error.expectedTokenType)}', but got '${this.getTokenTypeString(error.nextToken.type)}'\n\tat: (${error.nextToken.startPos}) -> (${error.nextToken.endPos})`;
            case ParseErrorTypeEnum.UnexpectedEndOfLine:
                return `Syntax error: Unexpected end of line.\n\tat: (${error.currentToken.startPos}) -> (${error.nextToken.endPos})`;
        }
    }

    public getTokenTypeString(tokenType: TokenType | null) {
        if (tokenType === null) {
            return "None";
        }

        return tokenTypeToStringMap[tokenType];
    }
}

/*
class Parser {
    private variables: VariableBank;

    constructor(variables: VariableBank) {
        this.variables = variables;
    }

    public parse(tokens: TokenTree[], errors: ParseError[]): IExpression {
        const operandStack = new Stack<IExpression>();
        const operatorStack = new Stack<Token>();
        let tokenIndex = 0;

        while (tokenIndex < tokens.length) {
            const token = tokens[tokenIndex];

            if (token.tokenType === TokenType.OpenParentheses) {
                const subExpr = Parser.getSubExpression(tokens, tokenIndex);
                operandStack.push(this.parse(subExpr, errors));
                continue;
            } else if (token.tokenType === TokenType.CloseParentheses) {
                errors.push({ message: "Mismatched parentheses in expression", errorTokenIndex: tokenIndex });
            }

            if (Parser.isOperator(token)) {
                while (!operatorStack.isEmpty() && token.tokenType < operatorStack.peek().tokenType) {
                    const op = operatorStack.pop();

                    switch (op.tokenType) {
                        case TokenType.Not:
                        case TokenType.PlusPlus:
                        case TokenType.MinMin: {
                            const op1 = operandStack.pop();
                            const nop = new SingleValueOperationExpression();
                            nop.value = op1;
                            nop.operator = op.tokenType;
                            operandStack.push(nop);
                            break;
                        }
                        default: {
                            const arg2 = operandStack.pop();
                            const arg1 = operandStack.pop();
                            const ex = new OperationExpression();
                            ex.left = arg1;
                            ex.operator = op.tokenType;
                            ex.right = arg2;
                            operandStack.push(ex);
                            break;
                        }
                    }
                }

                operatorStack.push(token);
            } else {
                switch (token.tokenType) {
                    case TokenType.SequenceTerminator:
                        break;
                    case TokenType.Variable: {
                        const expression = new VariableParseExpression();

                        const identifiers = token.value.split(".");
                        let root = this.variables.root;

                        for (let i = 0; i < identifiers.length; ++i) {
                            const identifier = identifiers[i];

                            if (root.containsMember(identifier)) {
                                root = root[identifier];
                            } else {
                                root = null;
                                errors.push({ message: `Variable does not exist: ${identifier}`, errorTokenIndex: tokenIndex });
                            }
                        }
                        expression.variable = root;
                        operandStack.push(expression);
                        break;
                    }
                    case TokenType.Boolean:
                    case TokenType.Number:
                    case TokenType.FloatingPointNumber:
                    case TokenType.StringValue: {
                        const expression = new ValueParseExpression();
                        expression.value = token.value;
                        expression.valueType = token.tokenType;
                        operandStack.push(expression);
                        break;
                    }
                    default:
                        throw new Error(`Missing expression value type: ${token.tokenType}`);
                }
            }

            tokenIndex++;
        }

        while (!operatorStack.isEmpty()) {
            const op = operatorStack.pop();

            switch (op.tokenType) {
                case TokenType.Not:
                case TokenType.PlusPlus:
                case TokenType.MinMin: {
                    const op1 = operandStack.pop();
                    const nop = new SingleValueOperationExpression();
                    nop.value = op1;
                    nop.operator = op.tokenType;
                    operandStack.push(nop);
                    break;
                }
                default: {
                    const arg2 = operandStack.pop();
                    const arg1 = operandStack.pop();
                    const ex = new OperationExpression();
                    ex.left = arg1;
                    ex.operator = op.tokenType;
                    ex.right = arg2;
                    operandStack.push(ex);
                    break;
                }
            }
        }

        return operandStack.pop();
    }

    private static getSubExpression(tokens: Token[], index: number): Token[] {
        const subExpr: Token[] = [];
        let parenlevels = 1;

        index++;

        while (index < tokens.length && parenlevels > 0) {
            const token = tokens[index];

            if (tokens[index].tokenType === TokenType.OpenParentheses) {
                parenlevels += 1;
            }

            if (tokens[index].tokenType === TokenType.CloseParentheses) {
                parenlevels -= 1;
            }

            if (parenlevels > 0) {
                subExpr.push(token);
            }

            index += 1;
        }

        if (parenlevels > 0) {
            throw new Error("Mismatched parentheses in expression");
        }

        return subExpr;
    }

    private static isOperator(token: Token): boolean {
        return (
            token.tokenType === TokenType.Assign ||
            token.tokenType === TokenType.PlusAssign ||
            token.tokenType === TokenType.PlusPlus ||
            token.tokenType === TokenType.MinMin ||
            token.tokenType === TokenType.MinusAssign ||
            token.tokenType === TokenType.MultiplyAssign ||
            token.tokenType === TokenType.DivideAssign
        );
    }
}
*/
