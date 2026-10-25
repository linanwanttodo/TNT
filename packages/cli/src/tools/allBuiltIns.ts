import {
  LIST_SUBAGENTS_TOOL_META,
  SUBAGENT_TOOL_META,
} from "../subagent/index.js";

import { applyPatchTool } from "./applyPatch.js";
import { askQuestionTool } from "./askQuestion.js";
import { browserTool } from "./browser.js";
import { checkBackgroundJobTool } from "./checkBackgroundJob.js";
import { codebaseSearchTool } from "./codebaseSearch.js";
import { completionTool } from "./completion.js";
import { deleteFileTool } from "./deleteFile.js";
import { diagnosticsTool } from "./diagnostics.js";
import { editTool } from "./edit.js";
import { exitTool } from "./exit.js";
import { fetchTool } from "./fetch.js";
import { findSymbolTool } from "./findSymbol.js";
import { globFilesTool } from "./globFiles.js";
import { hoverTool } from "./hover.js";
import { listFilesTool } from "./listFiles.js";
import { multiEditTool } from "./multiEdit.js";
import { notebookEditTool } from "./notebookEdit.js";
import { enterPlanModeTool, exitPlanModeTool } from "./planMode.js";
import { readFileTool } from "./readFile.js";
import { reportFailureTool } from "./reportFailure.js";
import { runTerminalCommandTool } from "./runTerminalCommand.js";
import { searchCodeTool } from "./searchCode.js";
import { toolSearchTool } from "./selection/search.js";
import { SKILLS_TOOL_META } from "./skills.js";
import { statusTool } from "./status.js";
import { todoTool } from "./todo.js";
import { uploadArtifactTool } from "./uploadArtifact.js";
import { viewDiffTool } from "./viewDiff.js";
import { webSearchTool } from "./webSearch.js";
import { writeChecklistTool } from "./writeChecklist.js";
import { writeFileTool } from "./writeFile.js";

// putting in here for circular import issue
export const ALL_BUILT_IN_TOOLS = [
  applyPatchTool,
  askQuestionTool,
  browserTool,
  checkBackgroundJobTool,
  codebaseSearchTool,
  completionTool,
  deleteFileTool,
  diagnosticsTool,
  editTool,
  exitTool,
  fetchTool,
  findSymbolTool,
  globFilesTool,
  enterPlanModeTool,
  exitPlanModeTool,
  hoverTool,
  listFilesTool,
  multiEditTool,
  notebookEditTool,
  readFileTool,
  reportFailureTool,
  runTerminalCommandTool,
  searchCodeTool,
  statusTool,
  todoTool,
  toolSearchTool,
  SUBAGENT_TOOL_META,
  LIST_SUBAGENTS_TOOL_META,
  SKILLS_TOOL_META,
  uploadArtifactTool,
  viewDiffTool,
  webSearchTool,
  writeChecklistTool,
  writeFileTool,
];
