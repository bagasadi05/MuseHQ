export interface CleanDisplayOptions {
  stripMarkdown?: boolean;
  singleLine?: boolean;
}

const INLINE_ARROW_RE =
  /(?:(?<=[A-Za-z0-9\u00C0-\u024F)\]"'’”`%])|(?<=\S[*_]))[ \t]*[→←↔⇒➔][ \t]*(?=[A-Za-z0-9\u00C0-\u024F(\["'‘“`*_])/g;

const LEADING_SYMBOL_RUN_RE =
  /(^|\n)[ \t]*(?:[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}\uFE00-\uFE0F\u200D\u200B\u20E3\uFEFF\u2600-\u27BF\u2B00-\u2BFF\u2500-\u257F\u2580-\u259F\u25A0-\u25FF\u2190-\u21FF•‣⁃∙▪▸◆◇★☆➤➜✔✓✘✗→←↔⇒➔]+[ \t]*)+/gu;

const UNIQUE_SYMBOL_RE =
  /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}\uFE00-\uFE0F\u200D\u200B\u20E3\uFEFF\u2600-\u27BF\u2B00-\u2BFF\u2500-\u257F\u2580-\u259F\u25A0-\u25FF\u2190-\u21FF•‣⁃∙▪▸◆◇★☆➤➜✔✓✘✗→←↔⇒➔]/gu;

const LEADING_BRACKET_TAG_RE =
  /(^|\n)[ \t]*(?:\[(?!\s*[xX ]?\s*\])[^\]{}"'\n]{1,64}\](?!\():?[ \t]*(?=(?:\S|\n+\S)))+/g;

function stripLeadingSystemTags(text: string): string {
  return text.replace(LEADING_BRACKET_TAG_RE, '$1');
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim();
  const rawCells = trimmed.split(/(?<!\\)\|/);
  if (trimmed.startsWith('|') && rawCells.length > 0 && rawCells[0].trim() === '') {
    rawCells.shift();
  }
  if (
    /(?<!\\)\|$/.test(trimmed) &&
    rawCells.length > 0 &&
    rawCells[rawCells.length - 1].trim() === ''
  ) {
    rawCells.pop();
  }
  return rawCells.map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function isGfmTableSeparatorLine(line: string): boolean {
  if (!line.includes('|')) return false;
  const cells = splitTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

function stripGfmTables(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (isGfmTableSeparatorLine(trimmed)) {
      continue;
    }

    const nextIsSep = i + 1 < lines.length && isGfmTableSeparatorLine(lines[i + 1].trim());
    const prevWasTable =
      i > 0 &&
      (isGfmTableSeparatorLine(lines[i - 1].trim()) ||
        /^[ \t]*\|.*\|[ \t]*$/.test(lines[i - 1]));
    const hasOuterPipes = /^[ \t]*\|.*\|[ \t]*$/.test(trimmed);

    if (hasOuterPipes || (trimmed.includes('|') && (nextIsSep || prevWasTable))) {
      const cells = splitTableCells(trimmed).filter((c) => c.length > 0);
      if (cells.length > 0) {
        out.push(cells.join(', '));
      }
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

function stripMarkdownSyntax(text: string): string {
  let out = text;

  // Remove fenced code block delimiters while keeping inner text/code lines
  out = out.replace(/^[ \t]*```[^\n]*$/gm, '');
  out = out.replace(/```[a-zA-Z0-9_-]*/g, '');

  // Strip headings, blockquotes, horizontal rules, and normalize task/bullet markers
  out = out.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  out = out.replace(/^[ \t]*(?:>[ \t]?)+/gm, '');
  out = out.replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '');
  out = out.replace(/^([ \t]*)[-*+][ \t]+\[[xX ]\][ \t]*/gm, '$1- ');
  out = out.replace(/^([ \t]*)\*[ \t]+/gm, '$1- ');

  // Convert GFM tables into comma-separated rows and drop |---| separator rows
  out = stripGfmTables(out);

  // Convert markdown images and links [label](url) -> label
  out = out.replace(
    /!?\[([^\]]+)\]\((?:https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*|[^)\s]+)\)/g,
    '$1'
  );

  // Remove inline backticks
  out = out.replace(/`+/g, '');

  // Remove strikethrough, bold, and italic delimiters (preserving snake_case and URLs)
  out = out.replace(/~~([^~\n]+?)~~/g, '$1');
  out = out.replace(/\*\*\*(?!\s)([^\n]+?)(?<!\s)\*\*\*/g, '$1');
  out = out.replace(/\*\*(?!\s)([^\n]+?)(?<!\s)\*\*/g, '$1');
  out = out.replace(
    /(^|[\s(\["'‘“—–-])__(?!\s)([^\n]+?)(?<!\s)__(?=$|[\s.,;:!?)\]"'’”—–-])/g,
    '$1$2'
  );
  out = out.replace(/(^|[^\w*])\*(?!\s|\*)([^*\n]+?)(?<!\s|\*)\*(?=[^\w*]|$)/g, '$1$2');
  out = out.replace(
    /(^|[\s(\["'‘“—–-])_(?!\s)([^\n]+?)(?<!\s)_(?=$|[\s.,;:!?)\]"'’”—–-])/g,
    '$1$2'
  );

  // Remove stray unmatched ** or * delimiters without hurting spaced math like "2 * 3"
  out = out.replace(/\*{2,}/g, '');
  out = out.replace(/(^|\s)\*(?=\S)/g, '$1');
  out = out.replace(/(?<=\S)\*(?=\s|[.,;:!?)\]"'’”]|$)/g, '');

  return out;
}

export function stripUniqueSymbols(input: string): string {
  if (!input) return '';

  let out = input.replace(/\r\n?/g, '\n');

  // Turn inline arrows ("A → B") into natural Indonesian prose ("A ke B")
  out = out.replace(INLINE_ARROW_RE, ' ke ');

  // Remove decorative symbols/emojis at line starts together with trailing spacing
  out = out.replace(LEADING_SYMBOL_RUN_RE, '$1');

  // Remove remaining unique decorative symbols, emojis, box-drawing, and arrows
  out = out.replace(UNIQUE_SYMBOL_RE, '');

  // Normalize horizontal whitespace, trailing spaces, and excessive blank lines
  out = out.replace(/[ \t]+$/gm, '');
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');

  return out.trim();
}

export function cleanDisplayText(input: string, opts?: CleanDisplayOptions): string {
  if (!input) return '';

  let out = stripUniqueSymbols(input);
  out = stripLeadingSystemTags(out);

  if (opts?.stripMarkdown) {
    out = stripMarkdownSyntax(out);
    out = stripLeadingSystemTags(out);
  }

  if (opts?.singleLine) {
    out = out.replace(/\s*\n+\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  } else {
    out = out.replace(/[ \t]+$/gm, '');
    out = out.replace(/[ \t]{2,}/g, ' ');
    out = out.replace(/\n{3,}/g, '\n\n').trim();
  }

  return out;
}
