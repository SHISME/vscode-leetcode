// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import { execSync } from "child_process";
import * as fs from "fs";
import * as fse from "fs-extra";
import * as vscode from "vscode";
import { LeetCodeNode } from "../explorer/LeetCodeNode";
import { leetCodeExecutor } from "../leetCodeExecutor";
import { leetCodeManager } from "../leetCodeManager";
import { IProblem, IQuickItemEx, languages, ProblemState } from "../shared";
import { DialogOptions, DialogType, promptForOpenOutputChannel, promptForSignIn } from "../utils/uiUtils";
import { selectWorkspaceFolder } from "../utils/workspaceUtils";
import * as wsl from "../utils/wslUtils";
import * as list from "./list";

export async function showProblem(node?: LeetCodeNode): Promise<void> {
    if (!node) {
        return;
    }
    await showProblemInternal(node.id);
}

export async function searchProblem(): Promise<void> {
    if (!leetCodeManager.getUser()) {
        promptForSignIn();
        return;
    }
    const choice: IQuickItemEx<string> | undefined = await vscode.window.showQuickPick(
        parseProblemsToPicks(list.listProblems()),
        {
            matchOnDetail: true,
            placeHolder: "Select one problem",
        },
    );
    if (!choice) {
        return;
    }
    await showProblemInternal(choice.value);
}

async function showProblemInternal(id: string): Promise<void> {
    try {
        const leetCodeConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("leetcode");
        let defaultLanguage: string | undefined = leetCodeConfig.get<string>("defaultLanguage");
        if (defaultLanguage && languages.indexOf(defaultLanguage) < 0) {
            defaultLanguage = undefined;
        }
        const language: string | undefined = defaultLanguage || await vscode.window.showQuickPick(languages, { placeHolder: "Select the language you want to use" });
        if (!language) {
            return;
        }

        const outDir: string = await selectWorkspaceFolder() + `/src/${id}`;
        await fse.ensureDir(outDir);
        const result: string = await leetCodeExecutor.showProblem(id, language, outDir);
        const reg: RegExp = /\* Source Code:\s*(.*)/;
        const match: RegExpMatchArray | null = result.match(reg);
        if (match && match.length >= 2) {
            const filePath: string = wsl.useWsl() ? await wsl.toWinPath(match[1].trim()) : match[1].trim();
            const newFilePath: string = filePath.replace(
                filePath.substring(
                    filePath.lastIndexOf("/") + 1,
                    filePath.lastIndexOf("."),
                ),
                "index",
            );
            fs.renameSync(filePath, newFilePath);
            await resetProblemFileContent(newFilePath);
            await vscode.window.showTextDocument(vscode.Uri.file(newFilePath), { preview: false });
            execSync(`ts-node build.ts -i ${id}`);
        } else {
            throw new Error("Failed to fetch the problem information.");
        }

        if (!defaultLanguage && leetCodeConfig.get<boolean>("showSetDefaultLanguageHint")) {
            const choice: vscode.MessageItem | undefined = await vscode.window.showInformationMessage(
                `Would you like to set '${language}' as your default language?`,
                DialogOptions.yes,
                DialogOptions.no,
                DialogOptions.never,
            );
            if (choice === DialogOptions.yes) {
                leetCodeConfig.update("defaultLanguage", language, true /* UserSetting */);
            } else if (choice === DialogOptions.never) {
                leetCodeConfig.update("showSetDefaultLanguageHint", false, true /* UserSetting */);
            }
        }
    } catch (error) {
        await promptForOpenOutputChannel("Failed to fetch the problem information. Please open the output channel for details.", DialogType.error);
    }
}

async function parseProblemsToPicks(p: Promise<IProblem[]>): Promise<Array<IQuickItemEx<string>>> {
    return new Promise(async (resolve: (res: Array<IQuickItemEx<string>>) => void): Promise<void> => {
        const picks: Array<IQuickItemEx<string>> = (await p).map((problem: IProblem) => Object.assign({}, {
            label: `${parseProblemDecorator(problem.state, problem.locked)}${problem.id}.${problem.name}`,
            description: "",
            detail: `AC rate: ${problem.passRate}, Difficulty: ${problem.difficulty}`,
            value: problem.id,
        }));
        resolve(picks);
    });
}

function parseProblemDecorator(state: ProblemState, locked: boolean): string {
    switch (state) {
        case ProblemState.AC:
            return "$(check) ";
        case ProblemState.NotAC:
            return "$(x) ";
        default:
            return locked ? "$(lock) " : "";
    }
}

async function resetProblemFileContent(filePath: string): Promise<void> {
    const titlePattern: RegExp = /\* \[\d*\].*/g;
    const urlPattern: RegExp = /https:\/\/.*/g;
    const difficultyPatterm: RegExp = /Hard|Medium|Easy/g;
    const content: string = await readProblemFileContent(filePath);
    const url: string = (content.match(urlPattern) as string[])[0];
    const difficulty: string = (content.match(difficultyPatterm) as string[])[0];
    let title: string = (content.match(titlePattern) as string[])[0];
    const id: string = title.substring(title.indexOf("[") + 1, title.indexOf("]"));
    title = title.substring(title.indexOf("]") + 2);
    const config: string = `
module.exports = {
    id:'${id}',
    title:'${title}',
    url:'${url}',
    difficulty:'${difficulty}',
}`;
    fs.writeFileSync(filePath, content + config);
}

function readProblemFileContent(filePath: string): Promise<string> {
    return new Promise((resolve: any, reject: any): void => {
        fs.readFile(filePath, "utf8", (err: any, data: string) => {
            if (err) {
                reject();
            } else {
                resolve(data);
            }
        });
    });
}
