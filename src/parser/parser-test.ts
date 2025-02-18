import { DocumentParser } from "./parser";

import { RpyProgram } from "../interpreter/program";
import { LogCategory, logCatMessage } from "../logger";
import { AST } from "./ast-nodes";
import { RenpyStatementRule } from "./renpy-grammar-rules";

export async function testParser() {
    const activeEditor = window.activeTextEditor;
    if (!activeEditor || activeEditor.document.languageId !== "renpy") {
        return;
    }

    const parser = new DocumentParser(activeEditor.document);
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

    const errors: VSRange[] = [];
    for (const error of parser.errors) {
        logCatMessage(LogLevel.Error, LogCategory.Parser, parser.getErrorMessage(error));
        errors.push(error.errorRange.toVSRange(activeEditor.document));
    }

    logCatMessage(LogLevel.Debug, LogCategory.Parser, ast.toString());

    const program = new RpyProgram();
    ast.process(program);

    for (const error of program.errorList) {
        logCatMessage(LogLevel.Error, LogCategory.Parser, error.message);

        if (error.errorLocation !== null) {
            errors.push(error.errorLocation.range);
        }
    }

    activeEditor.setDecorations(errorDecorationType, errors);
}
