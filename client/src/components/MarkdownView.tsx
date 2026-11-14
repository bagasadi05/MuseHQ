import React, { useEffect, useRef, useState } from 'react';
import { Check, CheckSquare2, Copy, Square } from 'lucide-react';
import { stripUniqueSymbols } from '../utils/textClean';

export interface MarkdownViewProps {
  content: string;
  compact?: boolean;
  className?: string;
}

type TableAlign = 'left' | 'center' | 'right' | undefined;

interface ListItemNode {
  kind: 'task' | 'ul' | 'ol';
  checked?: boolean;
  ord?: number;
  indent: number;
  text: string;
  children: ListItemNode[];
}

const INLINE_TOKEN_RE =
  /(`[^`\n]+`|\[[^\]]+\]\(https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*\)|https?:\/\/(?:[^\s<>()]|\([^\s<>()]*\))+|\*\*\*(?!\s)[^*\n]+?(?<!\s)\*\*\*|\*\*(?!\s)(?:[^*\n]|\*(?!\*))+?(?<!\s)\*\*|(?<!\w)__(?!\s)(?:[^_\n]|_(?!_))+?(?<!\s)__(?!\w)|~~(?!\s)[^~\n]+?(?<!\s)~~|(?<!\*)\*(?!\s|\*)[^*\n]+?(?<!\s|\*)\*(?!\*)|(?<![\w*])_(?!\s)[^_\n]+?(?<!\s)_(?![\w*]))/g;

function stripStrayAsterisks(plain: string): string {
  let out = plain.replace(/\*{2,}/g, '');
  out = out.replace(/(^|\s)\*(?=\S)/g, '$1');
  out = out.replace(/(?<=\S)\*(?=\s|[.,;:!?)\]"'’”]|$)/g, '');
  return out;
}

function renderInline(text: string, keyPrefix: string, depth = 0): React.ReactNode[] {
  if (!text) return [];
  if (depth > 4) {
    return [stripStrayAsterisks(text)];
  }

  const nodes: React.ReactNode[] = [];
  const tokenRe = new RegExp(INLINE_TOKEN_RE.source, 'g');
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let part = 0;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      const gap = stripStrayAsterisks(text.slice(lastIdx, match.index));
      if (gap) nodes.push(gap);
    }

    const token = match[0];
    const key = `${keyPrefix}-${part++}`;

    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      nodes.push(
        <code
          key={key}
          className="rounded border border-slate-700/60 bg-slate-800/90 px-1.5 py-0.5 font-mono text-[0.88em] text-amber-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const sepIdx = token.lastIndexOf('](');
      const label = sepIdx > 1 ? token.slice(1, sepIdx) : token;
      const href = sepIdx > 0 ? token.slice(sepIdx + 2, -1) : '';
      if (/^https?:\/\//i.test(href)) {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-400 underline decoration-sky-500/50 underline-offset-2 transition-colors hover:text-sky-300"
          >
            {renderInline(label, `${key}-lbl`, depth + 1)}
          </a>
        );
      } else {
        nodes.push(stripStrayAsterisks(token));
      }
    } else if (/^https?:\/\//i.test(token)) {
      const trailingMatch = token.match(/[.,;:!?'"\]]+$/);
      const trailing = trailingMatch ? trailingMatch[0] : '';
      const href = trailing ? token.slice(0, -trailing.length) : token;
      nodes.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-sky-400 underline decoration-sky-500/50 underline-offset-2 transition-colors hover:text-sky-300"
        >
          {href}
        </a>
      );
      if (trailing) {
        nodes.push(trailing);
      }
    } else if (token.startsWith('***') && token.endsWith('***') && token.length > 6) {
      nodes.push(
        <strong key={key} className="font-semibold text-slate-50">
          <em className="italic">{renderInline(token.slice(3, -3), `${key}-bi`, depth + 1)}</em>
        </strong>
      );
    } else if (
      ((token.startsWith('**') && token.endsWith('**')) ||
        (token.startsWith('__') && token.endsWith('__'))) &&
      token.length > 4
    ) {
      nodes.push(
        <strong key={key} className="font-semibold text-slate-50">
          {renderInline(token.slice(2, -2), `${key}-b`, depth + 1)}
        </strong>
      );
    } else if (token.startsWith('~~') && token.endsWith('~~') && token.length > 4) {
      nodes.push(
        <del key={key} className="text-slate-400 line-through">
          {renderInline(token.slice(2, -2), `${key}-s`, depth + 1)}
        </del>
      );
    } else if (
      ((token.startsWith('*') && token.endsWith('*')) ||
        (token.startsWith('_') && token.endsWith('_'))) &&
      token.length > 2
    ) {
      nodes.push(
        <em key={key} className="italic text-slate-200">
          {renderInline(token.slice(1, -1), `${key}-i`, depth + 1)}
        </em>
      );
    } else {
      nodes.push(stripStrayAsterisks(token));
    }

    lastIdx = tokenRe.lastIndex;
  }

  if (lastIdx < text.length) {
    const tail = stripStrayAsterisks(text.slice(lastIdx));
    if (tail) nodes.push(tail);
  }

  return nodes;
}

const CodeBlock: React.FC<{ lang: string; code: string; compact: boolean }> = ({
  lang,
  code,
  compact,
}) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = () => {
    try {
      void navigator.clipboard?.writeText(code);
      setCopied(true);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 1600);
    } catch {
      // Clipboard API may be unavailable in restricted contexts
    }
  };

  return (
    <div
      className={`${compact ? 'my-2' : 'my-3'} overflow-hidden rounded-lg border border-slate-800 bg-slate-950/95`}
    >
      <div className="flex items-center justify-between border-b border-slate-800/90 bg-slate-900/90 px-3 py-1.5">
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-slate-400">
          {lang || 'kode'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded border border-slate-700/80 bg-slate-800/80 px-2 py-0.5 text-[10px] font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-300">Disalin</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Salin</span>
            </>
          )}
        </button>
      </div>
      <pre
        className={`overflow-x-auto font-mono leading-relaxed text-emerald-200 ${
          compact ? 'p-2.5 text-[11px]' : 'p-3.5 text-xs'
        }`}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
};

function sanitizeNonCodeLines(content: string): string[] {
  const rawLines = content.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      out.push(rawLine);
      continue;
    }

    if (inFence) {
      out.push(rawLine);
      continue;
    }

    const indentMatch = rawLine.match(/^[ \t]*/);
    const indent = indentMatch ? indentMatch[0] : '';
    const cleaned = stripUniqueSymbols(rawLine.slice(indent.length));
    out.push(cleaned ? indent + cleaned : '');
  }

  return out;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const parts = trimmed.split(/(?<!\\)\|/);
  if (trimmed.startsWith('|') && parts.length > 0 && parts[0].trim() === '') {
    parts.shift();
  }
  if (
    /(?<!\\)\|$/.test(trimmed) &&
    parts.length > 0 &&
    parts[parts.length - 1].trim() === ''
  ) {
    parts.pop();
  }
  return parts.map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function parseTableSeparator(line: string): { valid: boolean; alignments: TableAlign[] } {
  if (!line.includes('|')) {
    return { valid: false, alignments: [] };
  }
  const cells = splitTableRow(line);
  if (cells.length === 0) {
    return { valid: false, alignments: [] };
  }
  const alignments: TableAlign[] = [];
  for (const cell of cells) {
    if (!/^:?-{1,}:?$/.test(cell)) {
      return { valid: false, alignments: [] };
    }
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) alignments.push('center');
    else if (right) alignments.push('right');
    else if (left) alignments.push('left');
    else alignments.push(undefined);
  }
  return { valid: true, alignments };
}

function isHorizontalRule(trimmed: string): boolean {
  return /^([-*_])(?:\s*\1){2,}$/.test(trimmed);
}

function matchListLine(
  line: string
): { kind: 'task' | 'ul' | 'ol'; checked?: boolean; ord?: number; indent: number; text: string } | null {
  if (isHorizontalRule(line.trim())) return null;

  const taskMatch = line.match(/^([ \t]*)[-*+]\s+\[([ xX])\](?:\s+(.*))?$/);
  if (taskMatch) {
    return {
      kind: 'task',
      checked: taskMatch[2].toLowerCase() === 'x',
      indent: taskMatch[1].replace(/\t/g, '  ').length,
      text: taskMatch[3] ?? '',
    };
  }

  const ulMatch = line.match(/^([ \t]*)[-*+]\s+(.*)$/);
  if (ulMatch) {
    return {
      kind: 'ul',
      indent: ulMatch[1].replace(/\t/g, '  ').length,
      text: ulMatch[2],
    };
  }

  const olMatch = line.match(/^([ \t]*)(\d+)[.)]\s+(.*)$/);
  if (olMatch) {
    return {
      kind: 'ol',
      ord: Number(olMatch[2]),
      indent: olMatch[1].replace(/\t/g, '  ').length,
      text: olMatch[3],
    };
  }

  return null;
}

function isBlockStart(lines: string[], idx: number): boolean {
  const line = lines[idx];
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('```')) return true;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (isHorizontalRule(trimmed)) return true;
  if (/^>/.test(trimmed)) return true;
  if (matchListLine(line) !== null) return true;
  if (
    idx + 1 < lines.length &&
    line.includes('|') &&
    parseTableSeparator(lines[idx + 1]).valid
  ) {
    return true;
  }
  return false;
}

function buildListTree(flatItems: Omit<ListItemNode, 'children'>[]): ListItemNode[] {
  const roots: ListItemNode[] = [];
  const stack: ListItemNode[] = [];

  for (const item of flatItems) {
    const node: ListItemNode = { ...item, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].indent >= node.indent) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }

  return roots;
}

function renderListNodes(
  nodes: ListItemNode[],
  keyPrefix: string,
  compact: boolean,
  nested = false
): React.ReactNode {
  const groups: Array<{ kind: 'task' | 'ul' | 'ol'; items: ListItemNode[] }> = [];
  for (const node of nodes) {
    const last = groups[groups.length - 1];
    if (last && last.kind === node.kind) {
      last.items.push(node);
    } else {
      groups.push({ kind: node.kind, items: [node] });
    }
  }

  const spacing = nested ? 'mt-1.5 space-y-1' : compact ? 'my-1.5 space-y-1' : 'my-2 space-y-1.5';

  return groups.map((group, gi) => {
    const gKey = `${keyPrefix}-g${gi}`;

    if (group.kind === 'task') {
      return (
        <ul key={gKey} className={`${spacing} list-none pl-0.5 text-slate-200`}>
          {group.items.map((item, idx) => (
            <li key={`${gKey}-${idx}`} className="flex flex-col">
              <div className="flex items-start gap-2">
                {item.checked ? (
                  <CheckSquare2 className="mt-[3px] h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <Square className="mt-[3px] h-3.5 w-3.5 shrink-0 text-slate-500" />
                )}
                <span className={`min-w-0 flex-1 ${item.checked ? 'text-slate-300' : 'text-slate-200'}`}>
                  {renderInline(item.text, `${gKey}-${idx}`)}
                </span>
              </div>
              {item.children.length > 0 && (
                <div className="pl-5">
                  {renderListNodes(item.children, `${gKey}-${idx}-c`, compact, true)}
                </div>
              )}
            </li>
          ))}
        </ul>
      );
    }

    if (group.kind === 'ol') {
      const start = group.items[0]?.ord;
      return (
        <ol
          key={gKey}
          start={start && start !== 1 ? start : undefined}
          className={`${spacing} list-decimal space-y-1 pl-5 text-slate-200 marker:text-slate-400`}
        >
          {group.items.map((item, idx) => (
            <li key={`${gKey}-${idx}`}>
              <div>{renderInline(item.text, `${gKey}-${idx}`)}</div>
              {item.children.length > 0 && renderListNodes(item.children, `${gKey}-${idx}-c`, compact, true)}
            </li>
          ))}
        </ol>
      );
    }

    return (
      <ul
        key={gKey}
        className={`${spacing} list-disc space-y-1 pl-5 text-slate-200 marker:text-slate-500`}
      >
        {group.items.map((item, idx) => (
          <li key={`${gKey}-${idx}`}>
            <div>{renderInline(item.text, `${gKey}-${idx}`)}</div>
            {item.children.length > 0 && renderListNodes(item.children, `${gKey}-${idx}-c`, compact, true)}
          </li>
        ))}
      </ul>
    );
  });
}

function renderHeading(
  level: number,
  text: string,
  key: string,
  compact: boolean
): React.ReactNode {
  const inline = renderInline(text, key);

  switch (level) {
    case 1:
      return (
        <h1
          key={key}
          className={`${
            compact ? 'mt-2.5 mb-1 text-sm' : 'mt-4 mb-2 border-b border-slate-800/80 pb-1.5 text-base'
          } font-display font-bold tracking-tight text-amber-300`}
        >
          {inline}
        </h1>
      );
    case 2:
      return (
        <h2
          key={key}
          className={`${
            compact ? 'mt-2 mb-1 text-[13px]' : 'mt-3.5 mb-1.5 text-sm'
          } font-display font-bold tracking-tight text-slate-100`}
        >
          {inline}
        </h2>
      );
    case 3:
      return (
        <h3
          key={key}
          className={`${
            compact ? 'mt-2 mb-1 text-xs' : 'mt-3 mb-1 text-[13px]'
          } font-display font-semibold text-sky-300`}
        >
          {inline}
        </h3>
      );
    case 4:
      return (
        <h4
          key={key}
          className={`${
            compact ? 'mt-1.5 mb-0.5 text-xs' : 'mt-2.5 mb-1 text-[13px]'
          } font-semibold text-slate-200`}
        >
          {inline}
        </h4>
      );
    case 5:
      return (
        <h5
          key={key}
          className={`${
            compact ? 'mt-1.5 mb-0.5 text-[11px]' : 'mt-2 mb-1 text-xs'
          } font-semibold uppercase tracking-wide text-slate-300`}
        >
          {inline}
        </h5>
      );
    default:
      return (
        <h6
          key={key}
          className={`${
            compact ? 'mt-1.5 mb-0.5 text-[11px]' : 'mt-2 mb-1 text-xs'
          } font-semibold text-slate-400`}
        >
          {inline}
        </h6>
      );
  }
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({
  content,
  compact = false,
  className = '',
}) => {
  const lines = sanitizeNonCodeLines(content || '');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <CodeBlock key={`code-${i}`} lang={lang} code={codeLines.join('\n')} compact={compact} />
      );
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
    if (headingMatch) {
      blocks.push(renderHeading(headingMatch[1].length, headingMatch[2], `h-${i}`, compact));
      i += 1;
      continue;
    }

    if (isHorizontalRule(trimmed)) {
      blocks.push(
        <hr key={`hr-${i}`} className={`${compact ? 'my-2' : 'my-3'} border-slate-800`} />
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`q-${i}`}
          className={`${
            compact ? 'my-1.5 px-2.5 py-1' : 'my-2.5 px-3.5 py-2'
          } rounded-r-lg border-l-2 border-amber-500/60 bg-slate-900/60 text-slate-300 italic`}
        >
          {quoteLines.map((ql, qi) => (
            <div key={qi} className={qi > 0 ? 'mt-1' : undefined}>
              {ql ? renderInline(ql, `q-${i}-${qi}`) : <span className="block h-2" />}
            </div>
          ))}
        </blockquote>
      );
      continue;
    }

    if (i + 1 < lines.length && line.includes('|')) {
      const sep = parseTableSeparator(lines[i + 1]);
      if (sep.valid) {
        const headers = splitTableRow(line);
        const alignments = sep.alignments;
        const rows: string[][] = [];
        i += 2;

        while (i < lines.length) {
          const rowLine = lines[i];
          const rowTrimmed = rowLine.trim();
          if (
            !rowTrimmed ||
            !rowTrimmed.includes('|') ||
            rowTrimmed.startsWith('```') ||
            /^#{1,6}\s+/.test(rowTrimmed) ||
            isHorizontalRule(rowTrimmed) ||
            rowTrimmed.startsWith('>')
          ) {
            break;
          }
          rows.push(splitTableRow(rowLine));
          i += 1;
        }

        const colCount = Math.max(headers.length, alignments.length);
        const cellPad = compact ? 'px-2.5 py-1.5' : 'px-3 py-2';

        blocks.push(
          <div
            key={`tbl-${i}`}
            className={`${
              compact ? 'my-2' : 'my-3'
            } overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/75`}
          >
            <table className="w-full border-collapse text-left">
              <thead className="bg-slate-900/95 text-slate-100">
                <tr>
                  {Array.from({ length: colCount }).map((_, ci) => (
                    <th
                      key={ci}
                      style={{ textAlign: alignments[ci] }}
                      className={`border-b border-slate-800 ${cellPad} font-semibold`}
                    >
                      {renderInline(headers[ci] ?? '', `tbl-${i}-h-${ci}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {rows.map((row, ri) => (
                  <tr key={ri} className="transition-colors hover:bg-slate-900/45">
                    {Array.from({ length: colCount }).map((_, ci) => (
                      <td
                        key={ci}
                        style={{ textAlign: alignments[ci] }}
                        className={`${cellPad} align-top text-slate-300`}
                      >
                        {renderInline(row[ci] ?? '', `tbl-${i}-r${ri}-c${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    const firstList = matchListLine(line);
    if (firstList) {
      const flatItems: Omit<ListItemNode, 'children'>[] = [firstList];
      i += 1;
      while (i < lines.length) {
        const nextList = matchListLine(lines[i]);
        if (!nextList) break;
        flatItems.push(nextList);
        i += 1;
      }
      const tree = buildListTree(flatItems);
      blocks.push(
        <React.Fragment key={`list-${i}`}>
          {renderListNodes(tree, `list-${i}`, compact)}
        </React.Fragment>
      );
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length && !isBlockStart(lines, i)) {
      paraLines.push(lines[i]);
      i += 1;
    }
    if (paraLines.length === 0) {
      paraLines.push(lines[i]);
      i += 1;
    }

    blocks.push(
      <p key={`p-${i}`} className={`${compact ? 'my-1.5' : 'my-2'} text-slate-200`}>
        {paraLines.map((pl, pi) => (
          <React.Fragment key={pi}>
            {pi > 0 && <br />}
            {renderInline(pl, `p-${i}-${pi}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  const rootTypography = compact ? 'text-xs leading-relaxed' : 'text-[13px] leading-[1.65]';

  return (
    <div
      className={`${rootTypography} text-slate-200 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${className}`.trim()}
    >
      {blocks}
    </div>
  );
};
