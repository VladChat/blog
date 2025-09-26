import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(repoRoot, 'config', 'news.config.json');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-blog.yml');

function warnAndExit(message) {
  console.warn(`[update-workflow] ${message}`);
  process.exitCode = 0;
}

async function readScheduleCron() {
  let rawConfig;
  try {
    rawConfig = await readFile(configPath, 'utf8');
  } catch (error) {
    warnAndExit(`Unable to read configuration at ${configPath}: ${error.message}`);
    return null;
  }

  let config;
  try {
    config = JSON.parse(rawConfig);
  } catch (error) {
    warnAndExit(`Invalid JSON in ${configPath}: ${error.message}`);
    return null;
  }

  const scheduleCron = config?.scheduleCron;
  if (typeof scheduleCron !== 'string' || !scheduleCron.trim()) {
    warnAndExit('Missing or empty "scheduleCron" value in config/news.config.json.');
    return null;
  }

  const parts = scheduleCron.trim().split(/\s+/);
  if (parts.length !== 5) {
    warnAndExit(
      `Invalid cron expression "${scheduleCron}". Expected 5 fields but received ${parts.length}.`
    );
    return null;
  }

  return scheduleCron.trim();
}

async function updateWorkflowCron(cronExpression) {
  let workflowContent;
  try {
    workflowContent = await readFile(workflowPath, 'utf8');
  } catch (error) {
    warnAndExit(`Unable to read workflow file at ${workflowPath}: ${error.message}`);
    return false;
  }

  const cronRegex = /(on:\s*\n\s*schedule:\s*\n\s*-\s*cron:\s*")(.*?)("\s*)/;
  const match = workflowContent.match(cronRegex);

  if (!match) {
    warnAndExit('Could not locate a cron schedule definition in the workflow file.');
    return false;
  }

  if (match[2] === cronExpression) {
    console.log('[update-workflow] Workflow cron already matches configuration.');
    return false;
  }

  const updatedContent = workflowContent.replace(cronRegex, `$1${cronExpression}$3`);
  await writeFile(workflowPath, updatedContent);
  console.log(`[update-workflow] Updated workflow cron to "${cronExpression}".`);
  return true;
}

async function commitChangesIfNeeded() {
  try {
    await execFileAsync('git', ['config', 'user.name', 'github-actions[bot]']);
    await execFileAsync('git', [
      'config',
      'user.email',
      '41898282+github-actions[bot]@users.noreply.github.com'
    ]);
    await execFileAsync('git', ['add', '.github/workflows/auto-blog.yml']);
    await execFileAsync('git', ['commit', '-m', 'chore(auto): sync workflow cron from config']);
    console.log('[update-workflow] Committed updated workflow schedule.');
  } catch (error) {
    if (error.code === 1) {
      console.log('[update-workflow] No commit created (likely no changes to add).');
    } else {
      warnAndExit(`Failed to create commit: ${error.message}`);
    }
  }
}

async function main() {
  const cronExpression = await readScheduleCron();
  if (!cronExpression) {
    return;
  }

  const updated = await updateWorkflowCron(cronExpression);
  if (!updated) {
    return;
  }

  await commitChangesIfNeeded();
}

await main();
