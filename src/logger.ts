/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { LogLevel } from "./utilities/vscode-wrappers";

// eslint-disable-next-line no-shadow
export const enum LogCategory {
    Default,
    Status,
    Parser,
    Tokenizer,
}

function getLogCategoryPrefix(category: LogCategory): string {
    switch (category) {
        case LogCategory.Default:
            return "[Default]";
        case LogCategory.Status:
            return "[Status]";
        case LogCategory.Parser:
            return "[Parser]";
        case LogCategory.Tokenizer:
            return "[Tokenizer]";
    }
}

export function logMessage(level: LogLevel, message: string): void {
    logCatMessage(level, LogCategory.Default, message);
}

export function logCatMessage(level: LogLevel, category: LogCategory, message: string): void {
    const outputMsg = `${getLogCategoryPrefix(category)} > ${message}`;
    switch (level) {
        case LogLevel.Trace:
            console.trace(outputMsg);
            break;
        case LogLevel.Debug:
            console.debug(outputMsg);
            break;
        case LogLevel.Info:
            console.info(outputMsg);
            break;
        case LogLevel.Warning:
            console.warn(outputMsg);
            break;
        case LogLevel.Error:
            console.error(outputMsg);
            break;
    }
}

export function logToast(level: LogLevel, message: string): void {
    logMessage(level, message);

    switch (level) {
        case LogLevel.Debug:
        case LogLevel.Info:
            window.showInformationMessage(message);
            break;
        case LogLevel.Warning:
            window.showWarningMessage(message);
            break;
        case LogLevel.Error:
            window.showErrorMessage(message);
            break;
    }
}
