const { Plugin, PluginSettingTab, Setting, Notice, TFile, TFolder, normalizePath, moment } = require('obsidian');

const DEFAULT_SETTINGS = {
  settingsVersion: 6,
  sourceNote: 'Tasks.md',
  outputFolder: 'Archive/Tasks',
  addTopicProperty: true,
  addStatusProperty: true,
  addCompletedProperty: true,
  addTypeProperty: true,
  addHeadingPathProperty: true,
  addSourceProperty: true,
  addContentProperty: true,
  includeContentInBody: true,
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
        const title = taskTitleFromBlock(datedBlock) || 'Completed task';
        const folderPath = normalizePath(this.settings.outputFolder);

        await ensureFolder(this.app, folderPath);
        const noteResult = await getOrCreateTaskNote(
          this.app,
          folderPath,
          title,
          completed,
          buildTaskNote({
            title,
            topic,
            headingPath: candidate.headingPath,
            completed,
            sourcePath,
            block: datedBlock,
            addTopicProperty: this.settings.addTopicProperty,
            addStatusProperty: this.settings.addStatusProperty,
            addCompletedProperty: this.settings.addCompletedProperty,
            addTypeProperty: this.settings.addTypeProperty,
            addHeadingPathProperty: this.settings.addHeadingPathProperty,
            addSourceProperty: this.settings.addSourceProperty,
            addContentProperty: this.settings.addContentProperty,
            includeContentInBody: this.settings.includeContentInBody
          })
        );

        const noteContent = await this.app.vault.cachedRead(noteResult.file);
        if (noteContent !== noteResult.content) {
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


    containerEl.createEl('h3', { text: 'Generated properties' });

    const propertyToggles = [
      ['addTopicProperty', 'Topic property', 'Store the nearest heading as topic.'],
      ['addStatusProperty', 'Status property', 'Store status: completed.'],
      ['addCompletedProperty', 'Completed property', 'Store the task completion date.'],
      ['addTypeProperty', 'Type property', 'Store type: task.'],
      ['addHeadingPathProperty', 'Heading path property', 'Store the full nested heading path.'],
      ['addSourceProperty', 'Source property', 'Link back to the source note and nearest heading.'],
      ['addContentProperty', 'Content property', 'Store the task text in a content property for Bases and queries.']
    ];

    for (const [key, name, description] of propertyToggles) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(description)
        .addToggle((toggle) => toggle
          .setValue(this.plugin.settings[key])
          .onChange(async (value) => {
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
          }));
    }

    containerEl.createEl('h3', { text: 'Note body' });

    new Setting(containerEl)
      .setName('Include task content in note body')
      .setDesc('Write the task as plain text in the note body, without a heading or checkbox.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.includeContentInBody)
        .onChange(async (value) => {
          this.plugin.settings.includeContentInBody = value;
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
    addTopicProperty: typeof saved.addTopicProperty === 'boolean' ? saved.addTopicProperty : DEFAULT_SETTINGS.addTopicProperty,
    addStatusProperty: typeof saved.addStatusProperty === 'boolean' ? saved.addStatusProperty : DEFAULT_SETTINGS.addStatusProperty,
    addCompletedProperty: typeof saved.addCompletedProperty === 'boolean' ? saved.addCompletedProperty : DEFAULT_SETTINGS.addCompletedProperty,
    addTypeProperty: typeof saved.addTypeProperty === 'boolean' ? saved.addTypeProperty : DEFAULT_SETTINGS.addTypeProperty,
    addHeadingPathProperty: typeof saved.addHeadingPathProperty === 'boolean'
      ? saved.addHeadingPathProperty
      : DEFAULT_SETTINGS.addHeadingPathProperty,
    addSourceProperty: typeof saved.addSourceProperty === 'boolean'
      ? saved.addSourceProperty
      : (typeof saved.addSourceLink === 'boolean' ? saved.addSourceLink : DEFAULT_SETTINGS.addSourceProperty),
    addContentProperty: typeof saved.addContentProperty === 'boolean'
      ? saved.addContentProperty
      : DEFAULT_SETTINGS.addContentProperty,
    includeContentInBody: typeof saved.includeContentInBody === 'boolean'
      ? saved.includeContentInBody
      : DEFAULT_SETTINGS.includeContentInBody,
    noticeOnConvert: typeof saved.noticeOnConvert === 'boolean'
      ? saved.noticeOnConvert
      : (typeof saved.noticeOnArchive === 'boolean' ? saved.noticeOnArchive : DEFAULT_SETTINGS.noticeOnConvert),
    debounceMs: Number.isFinite(saved.debounceMs)
      ? Math.min(2000, Math.max(50, saved.debounceMs))
      : DEFAULT_SETTINGS.debounceMs
  };
}

function buildTaskNote(options) {
  const properties = [];
  if (options.addTopicProperty) properties.push(`topic: ${yamlQuote(options.topic)}`);
  if (options.addStatusProperty) properties.push('status: completed');
  if (options.addCompletedProperty) properties.push(`completed: ${yamlQuote(options.completed)}`);
  if (options.addTypeProperty) properties.push('type: task');
  if (options.addHeadingPathProperty) properties.push(`heading-path: ${yamlQuote(options.headingPath || options.topic)}`);
  if (options.addSourceProperty) properties.push(`source: ${yamlQuote(`[[${stripMd(options.sourcePath)}#${options.topic}]]`)}`);
  if (options.addContentProperty) properties.push(`content: ${yamlQuote(options.title)}`);

  const frontmatter = properties.length > 0 ? `---\n${properties.join('\n')}\n---\n` : '';
  const body = options.includeContentInBody ? cleanTaskBody(options.block) : '';
  if (frontmatter && body) return `${frontmatter}\n${body}\n`;
  if (frontmatter) return `${frontmatter}\n`;
  if (body) return `${body}\n`;
  return '';
}

function cleanTaskBody(block) {
  const lines = block.trimEnd().split('\n');
  if (lines.length === 0) return '';

  const firstMatch = lines[0].match(/^(\s*)[-*+]\s+\[[xX]\]\s+(.*)$/);
  const baseIndent = firstMatch ? firstMatch[1] : '';
  lines[0] = (firstMatch ? firstMatch[2] : lines[0])
    .replace(/\s*✅\s*\d{4}-\d{2}-\d{2}\s*$/, '')
    .trimEnd();

  if (baseIndent) {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith(baseIndent)) lines[i] = lines[i].slice(baseIndent.length);
    }
  }

  return lines.join('\n').trim();
}

async function getOrCreateTaskNote(app, folderPath, title, completed, content) {
  const slug = taskFilenameSlug(title, 40);
  const baseName = `${completed}_${slug}`;

  // Check the base filename and numbered collision variants without ever
  // overwriting or reusing an existing task note.
  for (let index = 0; index < 10000; index++) {
    const suffix = index === 0 ? '' : `_${index}`;
    const path = normalizePath(`${folderPath}/${baseName}${suffix}.md`);
    const existing = app.vault.getAbstractFileByPath(path);

    if (!existing) {
      const created = await app.vault.create(path, content);
      return { file: created, created: true, content };
    }

    // A later task can legitimately have identical text, topic, and date.
    // Always continue to the next numeric suffix.
  }

  throw new Error(`Could not create a collision-free note for task: ${title}`);
}

function taskFilenameSlug(value, maxLength) {
  const slug = safeFilename(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'completed-task';
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


module.exports = CompletedTasksToNotes;
module.exports._test = {
  migrateSettings,
  buildTaskNote,
  cleanTaskBody,
  taskFilenameSlug,
  extractCompletedTaskBlocks,
  addDoneDate,
  taskTitleFromBlock,
  safeFilename,
  normalizeTaskBlock,
  cleanExcessBlankLines
};
