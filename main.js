const { Plugin, PluginSettingTab, Setting, Notice, TFile, TFolder, normalizePath, moment } = require('obsidian');

const DEFAULT_SETTINGS = {
  settingsVersion: 2,
  sourceNote: 'Tasks.md',
  archiveFolder: 'Archive/Tasks',
  addSourceLink: true,
  monthHeadings: true,
  noticeOnArchive: true,
  debounceMs: 120
};

class TopicTaskArchiver extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
    if (!saved || !saved.settingsVersion) {
      this.settings.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
      this.settings.debounceMs = DEFAULT_SETTINGS.debounceMs;
      await this.saveData(this.settings);
    }

    this.processing = false;
    this.pendingRun = false;
    this.timer = null;

    this.addSettingTab(new TopicTaskArchiverSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on('editor-change', (_editor, info) => {
      if (info && info.file && info.file.path === normalizePath(this.settings.sourceNote)) {
        this.scheduleArchive();
      }
    }));

    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (file instanceof TFile && file.path === normalizePath(this.settings.sourceNote)) {
        this.scheduleArchive();
      }
    }));

    this.addCommand({
      id: 'archive-completed-tasks-now',
      name: 'Archive completed tasks now',
      callback: () => void this.archiveCompletedTasks()
    });
  }

  onunload() {
    window.clearTimeout(this.timer);
  }

  scheduleArchive() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.archiveCompletedTasks(), this.settings.debounceMs);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async archiveCompletedTasks() {
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

      await ensureFolder(this.app, this.settings.archiveFolder);

      const archivedKeys = new Set();
      let archiveWrites = 0;

      for (const candidate of candidates) {
        const doneDate = candidate.doneDate || moment().format('YYYY-MM-DD');
        const datedBlock = addDoneDate(candidate.block, doneDate);
        const topic = candidate.heading || 'Uncategorized';
        const archiveId = await stableId(`${sourcePath}\n${candidate.identityKey}`);
        const marker = `<!-- topic-task-archive-id: ${archiveId} -->`;
        const archiveFile = await getOrCreateTopicArchive(this.app, this.settings.archiveFolder, topic);
        const childIndent = `${getTaskIndent(datedBlock)}  `;
        const sourceLink = this.settings.addSourceLink
          ? `\n${childIndent}- Source: [[${stripMd(sourcePath)}#${escapeHeading(topic)}]]`
          : '';
        const entry = `${datedBlock}${sourceLink}\n${marker}`;

        let inserted = false;
        await this.app.vault.process(archiveFile, (currentArchive) => {
          if (currentArchive.includes(marker)) return currentArchive;
          inserted = true;
          return insertArchiveEntry(currentArchive, entry, doneDate, this.settings.monthHeadings);
        });

        if (inserted) archiveWrites += 1;
        archivedKeys.add(candidate.identityKey);
      }

      let removedCount = 0;
      await this.app.vault.process(source, (current) => {
        const currentCandidates = extractCompletedTaskBlocks(current);
        const removable = currentCandidates.filter((candidate) => archivedKeys.has(candidate.identityKey));
        if (removable.length === 0) return current;

        let next = current;
        for (const candidate of removable.sort((a, b) => b.startOffset - a.startOffset)) {
          next = next.slice(0, candidate.startOffset) + next.slice(candidate.endOffset);
          removedCount += 1;
        }
        return cleanExcessBlankLines(next);
      });

      if (this.settings.noticeOnArchive) {
        const changedCount = candidates.length - removedCount;
        if (changedCount > 0) {
          new Notice(`Archived ${archiveWrites} task${archiveWrites === 1 ? '' : 's'}; ${changedCount} changed during archiving and remained in ${sourcePath}.`);
        } else if (removedCount > 0) {
          new Notice(`Archived ${removedCount} completed task${removedCount === 1 ? '' : 's'}.`);
        }
      }
    } catch (error) {
      console.error('Topic Task Archiver:', error);
      new Notice(`Task archiving failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.processing = false;
      if (this.pendingRun) {
        this.pendingRun = false;
        this.scheduleArchive();
      }
    }
  }
}

class TopicTaskArchiverSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Topic Task Archiver' });

    new Setting(containerEl)
      .setName('Source task note')
      .setDesc('The one note that contains all active checkboxes.')
      .addText((text) => text
        .setPlaceholder('Tasks.md')
        .setValue(this.plugin.settings.sourceNote)
        .onChange(async (value) => {
          this.plugin.settings.sourceNote = value.trim() || DEFAULT_SETTINGS.sourceNote;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Archive folder')
      .setDesc('One archive note is created per nearest heading/topic.')
      .addText((text) => text
        .setPlaceholder('Archive/Tasks')
        .setValue(this.plugin.settings.archiveFolder)
        .onChange(async (value) => {
          this.plugin.settings.archiveFolder = value.trim() || DEFAULT_SETTINGS.archiveFolder;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Archive delay')
      .setDesc('Milliseconds to wait after an edit. Lower values feel faster; 100–150 ms is recommended.')
      .addText((text) => text
        .setPlaceholder('120')
        .setValue(String(this.plugin.settings.debounceMs))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.debounceMs = Number.isFinite(parsed) ? Math.min(2000, Math.max(50, parsed)) : DEFAULT_SETTINGS.debounceMs;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Add source link')
      .setDesc('Add a link back to the topic heading in the active task note.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.addSourceLink)
        .onChange(async (value) => {
          this.plugin.settings.addSourceLink = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Group archive by month')
      .setDesc('Place completed tasks beneath YYYY-MM headings.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.monthHeadings)
        .onChange(async (value) => {
          this.plugin.settings.monthHeadings = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show archive notice')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.noticeOnArchive)
        .onChange(async (value) => {
          this.plugin.settings.noticeOnArchive = value;
          await this.plugin.saveSettings();
        }));
  }
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

function insertArchiveEntry(content, entry, doneDate, useMonthHeading) {
  const clean = content.trimEnd();
  if (!useMonthHeading) return `${clean}\n\n${entry}\n`;

  const month = doneDate.slice(0, 7);
  const heading = `## ${month}`;
  const lines = clean.split('\n');
  const headingIndex = lines.findIndex((line) => line.trim() === heading);

  if (headingIndex === -1) {
    lines.push('', heading, '', entry);
  } else {
    let insertAt = lines.length;
    for (let i = headingIndex + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) { insertAt = i; break; }
    }
    lines.splice(insertAt, 0, '', entry);
  }

  return sortMonthlySectionsNewestFirst(lines.join('\n'));
}

function sortMonthlySectionsNewestFirst(content) {
  const lines = content.trimEnd().split('\n');
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(/^##\s+(\d{4}-\d{2})$/);
    if (match) starts.push({ index: i, month: match[1] });
  }
  if (starts.length < 2) return `${lines.join('\n').trimEnd()}\n`;

  const prefix = lines.slice(0, starts[0].index);
  const sections = starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].index : lines.length;
    return { month: start.month, lines: lines.slice(start.index, end) };
  });

  sections.sort((a, b) => b.month.localeCompare(a.month));
  const output = [...prefix];
  for (const section of sections) {
    while (output.length > 0 && output[output.length - 1] === '') output.pop();
    output.push('', ...section.lines);
  }
  return `${output.join('\n').trimEnd()}\n`;
}

async function getOrCreateTopicArchive(app, folderPath, topic) {
  const normalizedFolder = normalizePath(folderPath);
  const base = safeFilename(topic);
  const topicId = await stableId(topic);
  const topicMarker = `<!-- topic-task-topic-id: ${topicId} -->`;
  const candidates = [
    normalizePath(`${normalizedFolder}/${base}.md`),
    normalizePath(`${normalizedFolder}/${base}--${topicId.slice(0, 8)}.md`)
  ];

  for (const path of candidates) {
    const existing = app.vault.getAbstractFileByPath(path);
    if (!existing) {
      return app.vault.create(path, `# ${topic} — completed tasks\n\n${topicMarker}\n`);
    }
    if (!(existing instanceof TFile)) continue;
    const content = await app.vault.cachedRead(existing);
    if (content.includes(topicMarker) || content.startsWith(`# ${topic} — completed tasks`)) {
      if (!content.includes(topicMarker)) {
        await app.vault.process(existing, (current) => current.includes(topicMarker) ? current : `${current.trimEnd()}\n\n${topicMarker}\n`);
      }
      return existing;
    }
  }

  throw new Error(`Could not create a collision-free archive file for topic: ${topic}`);
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
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || 'Uncategorized';
}

function getTaskIndent(block) {
  const match = block.match(/^(\s*)/);
  return match ? match[1] : '';
}

function stripMd(path) {
  return path.replace(/\.md$/i, '');
}

function escapeHeading(heading) {
  return heading.replace(/\|/g, '\\|');
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

module.exports = TopicTaskArchiver;
module.exports._test = {
  extractCompletedTaskBlocks,
  addDoneDate,
  insertArchiveEntry,
  sortMonthlySectionsNewestFirst,
  safeFilename,
  normalizeTaskBlock,
  cleanExcessBlankLines
};
