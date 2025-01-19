import { TokenPosition } from "../tokenizer/token-definitions";

/**
 * Log levels
 */
// eslint-disable-next-line no-shadow
export enum LogLevel {
    /**
     * No messages are logged with this level.
     */
    Off = 0,

    /**
     * All messages are logged with this level.
     */
    Trace = 1,

    /**
     * Messages with debug and higher log level are logged with this level.
     */
    Debug = 2,

    /**
     * Messages with info and higher log level are logged with this level.
     */
    Info = 3,

    /**
     * Messages with warning and higher log level are logged with this level.
     */
    Warning = 4,

    /**
     * Only error messages are logged with this level.
     */
    Error = 5,
}

export interface Line {
    text: string;
}

export class DocumentRange {
    start: TokenPosition;
    end: TokenPosition;

    constructor(start: TokenPosition, end: TokenPosition) {
        this.start = start;
        this.end = end;
    }

    overlaps(other: DocumentRange): boolean {
        return this.start <= other.end && other.start <= this.end;
    }

    contains(position: number): boolean {
        return position >= this.start.charStartOffset && position <= this.end.charStartOffset;
    }
}

/**
 * Represents a text document, such as a source file. Text documents have
 * {@link TextLine lines} and knowledge about an underlying resource like a file.
 */
export class TextDocument {
    text: string;
    filePath: string;
    version = 0;
    lastAccessed: number = new Date().getTime();

    constructor(doc: string, filePath: string) {
        this.text = doc;
        this.filePath = filePath;
    }

    private get lines() {
        return this.text.split("\n");
    }

    get lineCount(): number {
        return this.lines.length;
    }

    getText(range?: DocumentRange) {
        if (!range) return this.text;
        const offset = this.offsetAt(range.start);
        const length = this.offsetAt(range.end) - offset;
        return this.text.substring(offset, length);
    }

    getWordRangeAtPosition(position: TokenPosition): DocumentRange | undefined {
        const lines = this.lines;
        const line = Math.min(lines.length - 1, Math.max(0, position.line));
        const lineText = lines[line];
        const character = Math.min(lineText.length - 1, Math.max(0, position.character));

        let startChar = character;
        let startCharStartOffset = position.charStartOffset;
        while (startChar > 0 && !/\s/.test(lineText.charAt(startChar - 1))) {
            --startChar;
            --startCharStartOffset;
        }

        let endChar = character;
        let endCharStartOffset = position.charStartOffset;
        while (endChar < lineText.length - 1 && !/\s/.test(lineText.charAt(endChar))) {
            ++endChar;
            ++endCharStartOffset;
        }

        if (startChar === endChar) {
            return undefined;
        }

        return new DocumentRange(new TokenPosition(line, startChar, startCharStartOffset), new TokenPosition(line, endChar, endCharStartOffset));
    }

    lineAt(line: number): Line {
        return {
            text: this.lines[line],
        };
    }

    getPosition(offset: number): TokenPosition {
        if (offset > this.text.length) {
            throw new Error("offset " + offset + " is out of bounds. Document length was " + this.text.length);
        }
        const lines = this.lines;
        let currentOffSet = 0;
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (currentOffSet + l.length > offset) {
                return new TokenPosition(i, offset - currentOffSet, offset);
            } else {
                currentOffSet += l.length + 1;
            }
        }
        return new TokenPosition(lines.length - 1, lines[lines.length - 1].length, offset);
    }

    positionAt(offset: number): TokenPosition {
        return this.getPosition(offset);
    }

    offsetAt(position: TokenPosition): number {
        const lines = this.text.split("\n");
        let currentOffSet = 0;
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (position.line === i) {
                if (l.length < position.character) {
                    throw new Error(`Position ${JSON.stringify(position)} is out of range. Line [${i}] only has length ${l.length}.`);
                }
                return currentOffSet + position.character;
            } else {
                currentOffSet += l.length + 1;
            }
        }
        throw new Error(`Position ${JSON.stringify(position)} is out of range. Document only has ${lines.length} lines.`);
    }

    get fileName(): string {
        return this.filePath;
    }

    get isUntitled(): boolean {
        return false;
    }

    get isDirty(): boolean {
        return false;
    }
}
