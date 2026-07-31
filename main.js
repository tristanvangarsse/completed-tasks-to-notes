const { Plugin, PluginSettingTab, Setting, Notice, TFile, TFolder, normalizePath, moment } = require('obsidian');

const DEFAULT_SETTINGS = {
  settingsVersion: 3,
  sourceNote: 'Tasks.md',
  outputFolder: 'Archive/Tasks',
  organizeByDate: true,
  addSourceProperty: true,
  addHeadingPathProperty: true,
  noticeOnConvert: true,
  debounceMs: 120
};

class CompletedTasksToNotes extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = migrateSettings(saved || {});
    await this.saveData(this.settings);

    this.processing = false;
    this.pendingRun = false;
    this.timer = null;

    this.addSettingTab(new CompletedTasksToNotesSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on('editor-change', (_editor, info) => {
      if (info && info.file && info.file.path === normalizePath(this.settings.sourceNote)) {
        this.scheduleConversion();
      }
    }));

    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (file instanceof TFile && file.path === normalizePath(this.settings.sourceNote)) {
        this.scheduleConversion();
      }
    }));

    this.addCommand({
      id: 'convert-completed-tasks-now',
      name: 'Convert completed tasks to notes now',
      callback: () => void this.convertCompletedTasks()
    });
  }

  onunload() {
    window.clearTimeout(this.timer);
  }

  scheduleConversion() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.convertCompletedTasks(), this.settings.debounceMs);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async convertCompletedTasks() {
    if (this.processing) {
      this.pendingRun = true;
      return;
    }

    this.processing = true;
    try {
      const sourcePath = normalizePath(this.settings.sourceNote);
      const source = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(source instanceof TFile)) return;

      const original = await this.app.vault.cachedRead(source);
      const candidates = extractCompletedTaskBlocks(original);
      if (candidates.length === 0) return;

      const convertedKeys = new Set();
      let createdCount = 0;

      for (const candidate of candidates) {
        const completed = candidate.doneDate || moment().format('YYYY-MM-DD');
        const datedBlock = addDoneDate(candidate.block, completed);
        const topic = candidate.heading || 'Uncategorized';
        const noteId = await stableId(`${sourcePath}\n${candidate.identityKey}`);
        const marker = `<!-- completed-task-note-id: ${noteId} -->`;
        const title = taskTitleFromBlock(datedBlock) || 'Completed task';
        const folderPath = getOutputFolder(this.settings.outputFolder, completed, this.settings.organizeByDate);

        await ensureFolder(this.app, folderPath);
        const noteResult = await getOrCreateTaskNote(
          this.app,
          folderPath,
          title,
          noteId,
          marker,
          buildTaskNote({
            title,
            topic,
            headingPath: candidate.headingPath,
            completed,
            sourcePath,
            block: datedBlock,
            marker,
            addSourceProperty: this.settings.addSourceProperty,
            addHeadingPathProperty: this.settings.addHeadingPathProperty
          })
        );

        const noteContent = await this.app.vault.cachedRead(noteResult.file);
        if (!noteContent.includes(marker)) {
          throw new Error(`Could not verify created note: ${noteResult.file.path}`);
        }

        if (noteResult.created) createdCount += 1;
        convertedKeys.add(candidate.identityKey);
      }

      let removedCount = 0;
      await this.app.vault.process(source, (current) => {
        const currentCandidates = extractCompletedTaskBlocks(current);
        const removable = currentCandidates.filter((candidate) => convertedKeys.has(candidate.identityKey));
        if (removable.length === 0) return current;

        let next = current;
        for (const candidate of removable.sort((a, b) => b.startOffset - a.startOffset)) {
          next = next.slice(0, candidate.startOffset) + next.slice(candidate.endOffset);
          removedCount += 1;
        }
        return cleanExcessBlankLines(next);
      });

      if (this.settings.noticeOnConvert) {
        const changedCount = candidates.length - removedCount;
        if (changedCount > 0) {
          new Notice(`Created ${createdCount} task note${createdCount === 1 ? '' : 's'}; ${changedCount} changed during conversion and remained in ${sourcePath}.`);
        } else if (removedCount > 0) {
          new Notice(`Converted ${removedCount} completed task${removedCount === 1 ? '' : 's'} to note${removedCount === 1 ? '' : 's'}.`);
        }
      }
    } catch (error) {
      console.error('Completed Tasks to Notes:', error);
      new Notice(`Task conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.processing = false;
      if (this.pendingRun) {
        this.pendingRun = false;
        this.scheduleConversion();
      }
    }
  }
}

class CompletedTasksToNotesSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Completed Tasks to Notes' });

    new Setting(containerEl)
      .setName('Source task note')
      .setDesc('The note containing the active tasks to monitor.')
      .addText((text) => text
        .setPlaceholder('Tasks.md')
        .setValue(this.plugin.settings.sourceNote)
        .onChange(async (value) => {
          this.plugin.settings.sourceNote = value.trim() || DEFAULT_SETTINGS.sourceNote;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Completed task notes folder')
      .setDesc('The base folder where individual completed-task notes are created.')
      .addText((text) => text
        .setPlaceholder('Archive/Tasks')
        .setValue(this.plugin.settings.outputFolder)
        .onChange(async (value) => {
          this.plugin.settings.outputFolder = value.trim() || DEFAULT_SETTINGS.outputFolder;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Organize notes by year and month')
      .setDesc('Store notes in YYYY/MM subfolders while keeping topic information in properties.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.organizeByDate)
        .onChange(async (value) => {
          this.plugin.settings.organizeByDate = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Add source property')
      .setDesc('Add a link to the source note and nearest heading.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.addSourceProperty)
        .onChange(async (value) => {
          this.plugin.settings.addSourceProperty = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Add heading path property')
      .setDesc('Add the full nested heading path as a property, in addition to the nearest topic.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.addHeadingPathProperty)
        .onChange(async (value) => {
          this.plugin.settings.addHeadingPathProperty = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Conversion delay')
      .setDesc('Milliseconds to wait after an edit. Values from 100 to 150 ms usually feel immediate.')
      .addText((text) => text
        .setPlaceholder('120')
        .setValue(String(this.plugin.settings.debounceMs))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.debounceMs = Number.isFinite(parsed)
            ? Math.min(2000, Math.max(50, parsed))
            : DEFAULT_SETTINGS.debounceMs;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show conversion notice')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.noticeOnConvert)
        .onChange(async (value) => {
          this.plugin.settings.noticeOnConvert = value;
          await this.plugin.saveSettings();
        }));
  }
}

function migrateSettings(saved) {
  return {
    settingsVersion: DEFAULT_SETTINGS.settingsVersion,
    sourceNote: saved.sourceNote || DEFAULT_SETTINGS.sourceNote,
    outputFolder: saved.outputFolder || saved.archiveFolder || DEFAULT_SETTINGS.outputFolder,
    organizeByDate: typeof saved.organizeByDate === 'boolean' ? saved.organizeByDate : DEFAULT_SETTINGS.organizeByDate,
    addSourceProperty: typeof saved.addSourceProperty === 'boolean'
      ? saved.addSourceProperty
      : (typeof saved.addSourceLink === 'boolean' ? saved.addSourceLink : DEFAULT_SETTINGS.addSourceProperty),
    addHeadingPathProperty: typeof saved.addHeadingPathProperty === 'boolean'
      ? saved.addHeadingPathProperty
      : DEFAULT_SETTINGS.addHeadingPathProperty,
    noticeOnConvert: typeof saved.noticeOnConvert === 'boolean'
      ? saved.noticeOnConvert
      : (typeof saved.noticeOnArchive === 'boolean' ? saved.noticeOnArchive : DEFAULT_SETTINGS.noticeOnConvert),
    debounceMs: Number.isFinite(saved.debounceMs)
      ? Math.min(2000, Math.max(50, saved.debounceMs))
      : DEFAULT_SETTINGS.debounceMs
  };
}

function buildTaskNote(options) {
  const properties = [
    '---',
    `topic: ${yamlQuote(options.topic)}`,
    'status: completed',
    `completed: ${yamlQuote(options.completed)}`,
    'type: task'
  ];

  if (options.addHeadingPathProperty) {
    properties.push(`heading-path: ${yamlQuote(options.headingPath || options.topic)}`);
  }
  if (options.addSourceProperty) {
    properties.push(`source: ${yamlQuote(`[[${stripMd(options.sourcePath)}#${options.topic}]]`)}`);
  }

  properties.push('---');
  return `${properties.join('\n')}\n\n# ${options.title}\n\n${options.block.trimEnd()}\n\n${options.marker}\n`;
}

async function getOrCreateTaskNote(app, folderPath, title, noteId, marker, content) {
  const baseName = safeFilename(title).slice(0, 120) || 'Completed task';
  const paths = [
    normalizePath(`${folderPath}/${baseName}.md`),
    normalizePath(`${folderPath}/${baseName}--${noteId.slice(0, 8)}.md`)
  ];

  for (const path of paths) {
    const existing = app.vault.getAbstractFileByPath(path);
    if (!existing) {
      const created = await app.vault.create(path, content);
      return { file: created, created: true };
    }
    if (!(existing instanceof TFile)) continue;
    const existingContent = await app.vault.cachedRead(existing);
    if (existingContent.includes(marker)) return { file: existing, created: false };
  }

  const fallbackPath = normalizePath(`${folderPath}/${baseName}--${noteId}.md`);
  const fallback = app.vault.getAbstractFileByPath(fallbackPath);
  if (!fallback) {
    const created = await app.vault.create(fallbackPath, content);
    return { file: created, created: true };
  }
  if (fallback instanceof TFile) {
    const existingContent = await app.vault.cachedRead(fallback);
    if (existingContent.includes(marker)) return { file: fallback, created: false };
  }

  throw new Error(`Could not create a collision-free note for task: ${title}`);
}

function getOutputFolder(baseFolder, completed, organizeByDate) {
  const base = normalizePath(baseFolder);
  if (!organizeByDate) return base;
  const [year, month] = completed.split('-');
  return normalizePath(`${base}/${year}/${month}`);
}

function extractCompletedTaskBlocks(text) {
  const lines = text.split('\n');
  const offsets = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }

  const headingStack = [];
  const results = [];
  const occurrenceCounts = new Map();
  let fence = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const token = fenceMatch[1];
      if (!fence) fence = token[0];
      else if (token[0] === fence) fence = null;
      continue;
    }
    if (fence) continue;

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      headingStack.splice(level - 1);
      headingStack[level - 1] = headingMatch[2].replace(/\s+#+\s*$/, '').trim();
      continue;
    }

    const taskMatch = line.match(/^(\s*)[-*+]\s+\[[xX]\]\s+/);
    if (!taskMatch) continue;

    const baseIndent = visualIndent(taskMatch[1]);
    let end = i + 1;
    let blockFence = null;
    while (end < lines.length) {
      const next = lines[end];
      const nestedFence = next.match(/^\s*(`{3,}|~{3,})/);
      if (nestedFence) {
        const token = nestedFence[1];
        if (!blockFence) blockFence = token[0];
        else if (token[0] === blockFence) blockFence = null;
        end += 1;
        continue;
      }
      if (blockFence) {
        end += 1;
        continue;
      }
      if (/^#{1,6}\s+/.test(next)) break;
      if (next.trim() === '') {
        const afterBlank = lines[end + 1];
        if (afterBlank === undefined) { end += 1; break; }
        const nextTask = afterBlank.match(/^(\s*)[-*+]\s+\[[ xX-]\]\s+/);
        const nextList = afterBlank.match(/^(\s*)[-*+]\s+/);
        if ((nextTask || nextList) && visualIndent((nextTask || nextList)[1]) <= baseIndent) break;
        end += 1;
        continue;
      }
      const siblingTask = next.match(/^(\s*)[-*+]\s+\[[ xX-]\]\s+/);
      const siblingList = next.match(/^(\s*)[-*+]\s+/);
      if ((siblingTask || siblingList) && visualIndent((siblingTask || siblingList)[1]) <= baseIndent) break;
      const nextIndent = visualIndent((next.match(/^(\s*)/) || ['', ''])[1]);
      if (nextIndent <= baseIndent && !/^\s{2,}/.test(next)) break;
      end += 1;
    }

    const startOffset = offsets[i];
    const endOffset = end < lines.length ? offsets[end] : text.length;
    const block = text.slice(startOffset, endOffset).replace(/\n+$/, '\n');
    const nearestHeading = [...headingStack].reverse().find(Boolean) || 'Uncategorized';
    const headingPath = headingStack.filter(Boolean).join(' > ') || 'Uncategorized';
    const doneMatch = block.match(/✅\s*(\d{4}-\d{2}-\d{2})/);
    const fingerprint = `${headingPath}\n${normalizeTaskBlock(block)}`;
    const occurrenceIndex = occurrenceCounts.get(fingerprint) || 0;
    occurrenceCounts.set(fingerprint, occurrenceIndex + 1);
    const identityKey = `${fingerprint}\noccurrence:${occurrenceIndex}`;

    results.push({
      block,
      heading: nearestHeading,
      headingPath,
      doneDate: doneMatch ? doneMatch[1] : null,
      identityKey,
      startOffset,
      endOffset
    });
    i = end - 1;
  }
  return results;
}

function normalizeTaskBlock(block) {
  return block.replace(/✅\s*\d{4}-\d{2}-\d{2}/g, '').replace(/[ \t]+$/gm, '').trimEnd();
}

function addDoneDate(block, date) {
  if (/✅\s*\d{4}-\d{2}-\d{2}/.test(block)) return block.trimEnd();
  const lines = block.trimEnd().split('\n');
  lines[0] = `${lines[0]} ✅ ${date}`;
  return lines.join('\n');
}

function taskTitleFromBlock(block) {
  const firstLine = block.split('\n')[0] || '';
  return firstLine
    .replace(/^\s*[-*+]\s+\[[xX]\]\s+/, '')
    .replace(/✅\s*\d{4}-\d{2}-\d{2}\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function ensureFolder(app, folderPath) {
  const normalized = normalizePath(folderPath);
  if (!normalized || app.vault.getAbstractFileByPath(normalized)) return;
  const parts = normalized.split('/');
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (!existing) await app.vault.createFolder(current);
    else if (!(existing instanceof TFolder)) throw new Error(`${current} exists and is not a folder.`);
  }
}

function safeFilename(value) {
  const cleaned = value
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, alias) => alias || target)
    .replace(/[*_`~]/g, '')
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || 'Completed task';
}

function yamlQuote(value) {
  return JSON.stringify(String(value));
}

function stripMd(path) {
  return path.replace(/\.md$/i, '');
}

function visualIndent(spaces) {
  return spaces.replace(/\t/g, '    ').length;
}

function cleanExcessBlankLines(text) {
  return text.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s*$/, '\n');
}

async function stableId(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

module.exports = CompletedTasksToNotes;
module.exports._test = {
  migrateSettings,
  buildTaskNote,
  getOutputFolder,
  extractCompletedTaskBlocks,
  addDoneDate,
  taskTitleFromBlock,
  safeFilename,
  normalizeTaskBlock,
  cleanExcessBlankLines
};
