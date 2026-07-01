import { keyValue } from '../../utils';
import { LIMITS } from '../notion-limits';
import {
  ChildBlock,
  ParagraphBlock,
  RichText,
  RichTextOptions,
  RichTextText,
  isBlockType,
} from '../notion-types';
import { buildRichText } from '../notion-utils';

import {
  BlockResult,
  ContentResult,
  ListResult,
  RichTextResult,
  blockResult,
  isBlockResult,
  isListResult,
  isRichTextResult,
  listResult,
  richTextResult,
} from './content-result';
import { getRootElement } from './dom-utils';
import {
  BlockElement,
  ListElement,
  ParentElement,
  ParsedNode,
  TableElement,
  parseNode,
} from './parse-node';

type TableBlock = Extract<ChildBlock, { table: unknown }>;
type TableRowBlock = NonNullable<TableBlock['table']['children']>[number];

export function convertHtmlToBlocks(htmlString: string): ChildBlock[] {
  const root = getRootElement(htmlString);
  if (!root) throw new Error('Failed to load HTML content');

  const result = convertNode(root);

  if (
    !result ||
    !isBlockResult(result) ||
    !isBlockType('paragraph', result.block)
  ) {
    throw new Error('Unexpected HTML content');
  }

  const { children, rich_text } = result.block.paragraph;

  return normalizeChildBlocks([
    ...(rich_text.length ? [paragraphBlock(rich_text)] : []),
    ...(children || []),
  ]);
}

function convertNode(
  node: Node,
  options: RichTextOptions = {},
): ContentResult | undefined {
  const parsedNode = parseNode(node);

  if (!parsedNode) return undefined;

  switch (parsedNode.type) {
    case 'block':
      return parsedNode.supportsChildren
        ? convertParentElement(parsedNode, options)
        : convertBlockElement(parsedNode, options);
    case 'list':
      return convertListElement(parsedNode, options);
    case 'table':
      return blockResult(convertTableElement(parsedNode, options));
    case 'math_block':
      return blockResult({ equation: { expression: parsedNode.expression } });
    default:
      return richTextResult(convertRichTextNode(parsedNode, options));
  }
}

function convertParentElement(
  { annotations, blockType, color, element }: ParentElement,
  options: RichTextOptions,
): BlockResult {
  const updatedOptions = {
    ...options,
    annotations: {
      ...options.annotations,
      ...annotations,
    },
  };

  let rich_text: RichText = [];
  let children: ChildBlock[] | undefined;

  convertChildNodes(element, updatedOptions).forEach((result) => {
    let childBlock: ChildBlock;

    if (isRichTextResult(result)) {
      const trimmedRichText = trimRichText(result.richText);
      if (!trimmedRichText.length) return;

      if (!children) {
        rich_text = [...rich_text, ...trimmedRichText];
        return;
      }
      childBlock = paragraphBlock(trimmedRichText);
    } else {
      childBlock = result.block;
    }

    if (
      !children &&
      !rich_text.length &&
      isBlockType('paragraph', childBlock)
    ) {
      rich_text = childBlock.paragraph.rich_text;
      children = childBlock.paragraph.children;
      return;
    }

    children = [...(children || []), childBlock];
  });

  return blockResult(
    keyValue(blockType, {
      rich_text,
      ...(children && { children }),
      ...(color && { color }),
    }),
  );
}

function convertBlockElement(
  { annotations, blockType, color, element }: BlockElement,
  options: RichTextOptions,
): BlockResult {
  const preserveWhitespace = blockType === 'code';

  const updatedOptions = {
    ...options,
    annotations: {
      ...options.annotations,
      ...annotations,
    },
    preserveWhitespace,
  };

  let rich_text = convertRichTextChildNodes(element, updatedOptions);

  if (!preserveWhitespace) {
    rich_text = trimRichText(rich_text);
  }

  if (blockType === 'code') {
    return blockResult(
      keyValue(blockType, { rich_text, language: 'plain text' }),
    );
  }

  return blockResult(
    keyValue(blockType, {
      rich_text,
      ...(color && { color }),
    }),
  );
}

function convertListElement(
  node: ListElement,
  options: RichTextOptions,
): ListResult {
  return listResult(
    Array.from(node.element.children)
      .map((element) => {
        const parsedChild = parseNode(element);

        if (
          parsedChild?.type === 'block' &&
          parsedChild.supportsChildren &&
          parsedChild.blockType.endsWith('list_item')
        ) {
          return convertParentElement(parsedChild, options);
        }
        return undefined;
      })
      .filter(Boolean),
  );
}

function convertTableElement(
  node: TableElement,
  options: RichTextOptions,
): TableBlock {
  const rows = Array.from(node.element.rows);
  const rowCells = rows.map((row) => convertTableRowCells(row, options));
  const table_width = Math.max(1, ...rowCells.map((cells) => cells.length));
  const children = rowCells.length
    ? rowCells.map((cells) => tableRowBlock(padTableCells(cells, table_width)))
    : [tableRowBlock([[]])];
  const firstRow = rows[0];
  const has_column_header = firstRow
    ? Array.from(firstRow.cells).some((cell) => cell.tagName === 'TH')
    : undefined;
  const has_row_header = rows.some(
    (row, index) => index > 0 && row.cells[0]?.tagName === 'TH',
  );

  return {
    table: {
      table_width,
      children,
      ...(has_column_header && { has_column_header }),
      ...(has_row_header && { has_row_header }),
    },
  };
}

function convertTableRowCells(
  row: HTMLTableRowElement,
  options: RichTextOptions,
): RichText[] {
  return Array.from(row.cells).flatMap((cell) => {
    const richText = normalizeRichTextArray(convertTableCell(cell, options));
    const colSpan = Math.max(1, cell.colSpan || 1);

    return [
      richText,
      ...Array.from<RichText>({ length: colSpan - 1 }).fill([]),
    ];
  });
}

function convertTableCell(
  cell: HTMLTableCellElement,
  options: RichTextOptions,
): RichText {
  return joinRichTextGroups(
    convertChildNodes(cell, options)
      .flatMap((result) => richTextGroupsFromContentResult(result))
      .map((richText) => trimRichText(richText))
      .filter((richText) => richText.length),
  );
}

function richTextGroupsFromContentResult(result: ContentResult): RichText[] {
  if (isRichTextResult(result)) return [result.richText];

  if (isListResult(result)) {
    return result.results.flatMap(({ block }) =>
      richTextGroupsFromBlock(block),
    );
  }

  return richTextGroupsFromBlock(result.block);
}

function richTextGroupsFromBlock(block: ChildBlock): RichText[] {
  if (isBlockType('paragraph', block)) {
    return [
      block.paragraph.rich_text,
      ...(block.paragraph.children?.flatMap(richTextGroupsFromBlock) || []),
    ];
  }

  if (isBlockType('quote', block)) {
    return [
      block.quote.rich_text,
      ...(block.quote.children?.flatMap(richTextGroupsFromBlock) || []),
    ];
  }

  if (isBlockType('bulleted_list_item', block)) {
    return [
      block.bulleted_list_item.rich_text,
      ...(block.bulleted_list_item.children?.flatMap(richTextGroupsFromBlock) ||
        []),
    ];
  }

  if (isBlockType('numbered_list_item', block)) {
    return [
      block.numbered_list_item.rich_text,
      ...(block.numbered_list_item.children?.flatMap(richTextGroupsFromBlock) ||
        []),
    ];
  }

  if (isBlockType('heading_1', block)) return [block.heading_1.rich_text];
  if (isBlockType('heading_2', block)) return [block.heading_2.rich_text];
  if (isBlockType('heading_3', block)) return [block.heading_3.rich_text];
  if (isBlockType('code', block)) return [block.code.rich_text];
  if (isBlockType('equation', block)) {
    return [[{ equation: { expression: block.equation.expression } }]];
  }
  if (isBlockType('table', block)) {
    return block.table.children.map((row) =>
      joinRichTextGroups(row.table_row.cells, '\t'),
    );
  }

  return [];
}

function joinRichTextGroups(
  richTextGroups: RichText[],
  separator = '\n',
): RichText {
  return richTextGroups.flatMap((richText, index) => [
    ...(index > 0
      ? buildRichText(separator, { preserveWhitespace: true })
      : []),
    ...richText,
  ]);
}

function tableRowBlock(cells: RichText[]): TableRowBlock {
  return { table_row: { cells } };
}

function padTableCells(cells: RichText[], width: number): RichText[] {
  return [
    ...cells,
    ...Array.from<RichText>({ length: width - cells.length }).fill([]),
  ];
}

function convertChildNodes(
  node: Node,
  options: RichTextOptions,
): (BlockResult | RichTextResult)[] {
  return Array.from(node.childNodes).reduce<(BlockResult | RichTextResult)[]>(
    (results, childNode) => {
      const result = convertNode(childNode, options);

      if (!result) return results;

      if (isBlockResult(result)) return [...results, result];

      if (isListResult(result)) return [...results, ...result.results];

      const prevResult = results[results.length - 1];

      if (prevResult && isRichTextResult(prevResult)) {
        const concatResult = richTextResult([
          ...prevResult.richText,
          ...result.richText,
        ]);
        return [...results.slice(0, -1), concatResult];
      }

      return [...results, result];
    },
    [],
  );
}

function convertRichTextChildNodes(
  node: Node,
  options: RichTextOptions,
): RichText {
  return Array.from(node.childNodes).reduce<RichText>(
    (combinedRichText, childNode) => {
      const parsedNode = parseNode(childNode);

      if (!parsedNode) return combinedRichText;

      return [...combinedRichText, ...convertRichTextNode(parsedNode, options)];
    },
    [],
  );
}

function convertRichTextNode(
  node: ParsedNode,
  options: RichTextOptions,
): RichText {
  if (node.type === 'text') {
    return buildRichText(node.textContent, options);
  }

  if (node.type === 'br') {
    return buildRichText('\n', { ...options, preserveWhitespace: true });
  }

  if (node.type === 'inline_math') {
    return [{ equation: { expression: node.expression } }];
  }

  const updatedOptions = { ...options };

  if (node.type === 'rich_text') {
    updatedOptions.annotations = {
      ...options.annotations,
      ...node.annotations,
    };
    if (node.link) {
      updatedOptions.link = node.link;
    }
  }

  return convertRichTextChildNodes(node.element, updatedOptions);
}

function paragraphBlock(richText: RichText): ParagraphBlock {
  return { paragraph: { rich_text: richText } };
}

function normalizeChildBlocks(blocks: ChildBlock[]): ChildBlock[] {
  return blocks.flatMap((block) => splitParagraphBlock(block));
}

function splitParagraphBlock(block: ChildBlock): ChildBlock[] {
  const normalizedBlock = normalizeBlockChildren(block);

  if (!isBlockType('paragraph', normalizedBlock)) {
    return [normalizedBlock];
  }

  const { children, rich_text, ...paragraph } = normalizedBlock.paragraph;
  const normalizedChildren = children && normalizeChildBlocks(children);
  const normalizedRichText =
    rich_text.length > LIMITS.BLOCK_ARRAY_ELEMENTS
      ? compactRichText(rich_text)
      : rich_text;
  const richTextChunks = chunkRichText(normalizedRichText);

  return richTextChunks.map((richText, index) => ({
    paragraph: {
      ...paragraph,
      rich_text: richText,
      ...(index === richTextChunks.length - 1 &&
        normalizedChildren?.length && { children: normalizedChildren }),
    },
  }));
}

function normalizeBlockChildren(block: ChildBlock): ChildBlock {
  if (isBlockType('table', block)) {
    return {
      ...block,
      table: {
        ...block.table,
        children: block.table.children.map(({ table_row }) => ({
          table_row: {
            cells: table_row.cells.map(normalizeRichTextArray),
          },
        })),
      },
    };
  }

  if (isBlockType('paragraph', block) && block.paragraph.children) {
    return {
      ...block,
      paragraph: {
        ...block.paragraph,
        children: normalizeChildBlocks(block.paragraph.children),
      },
    };
  }

  if (isBlockType('quote', block) && block.quote.children) {
    return {
      ...block,
      quote: {
        ...block.quote,
        children: normalizeChildBlocks(block.quote.children),
      },
    };
  }

  if (
    isBlockType('bulleted_list_item', block) &&
    block.bulleted_list_item.children
  ) {
    return {
      ...block,
      bulleted_list_item: {
        ...block.bulleted_list_item,
        children: normalizeChildBlocks(block.bulleted_list_item.children),
      },
    };
  }

  if (
    isBlockType('numbered_list_item', block) &&
    block.numbered_list_item.children
  ) {
    return {
      ...block,
      numbered_list_item: {
        ...block.numbered_list_item,
        children: normalizeChildBlocks(block.numbered_list_item.children),
      },
    };
  }

  return block;
}

function chunkRichText(richText: RichText): RichText[] {
  if (!richText.length) return [richText];

  const chunks: RichText[] = [];

  for (
    let start = 0;
    start < richText.length;
    start += LIMITS.BLOCK_ARRAY_ELEMENTS
  ) {
    chunks.push(richText.slice(start, start + LIMITS.BLOCK_ARRAY_ELEMENTS));
  }

  return chunks;
}

function compactRichText(richText: RichText): RichText {
  return richText.reduce<RichText>((compacted, part) => {
    const previous = compacted[compacted.length - 1];

    if (
      !isTextRichText(previous) ||
      !isTextRichText(part) ||
      !canMergeRichText(previous, part)
    ) {
      return [...compacted, part];
    }

    return [
      ...compacted.slice(0, -1),
      {
        ...previous,
        text: {
          ...previous.text,
          content: previous.text.content + part.text.content,
        },
      },
    ];
  }, []);
}

function normalizeRichTextArray(richText: RichText): RichText {
  const compacted =
    richText.length > LIMITS.BLOCK_ARRAY_ELEMENTS
      ? compactRichText(richText)
      : richText;

  if (compacted.length <= LIMITS.BLOCK_ARRAY_ELEMENTS) return compacted;

  return buildRichText(getPlainText(compacted), { preserveWhitespace: true });
}

function getPlainText(richText: RichText): string {
  return richText
    .map((part) => {
      if ('text' in part) return part.text.content;
      if ('equation' in part) return part.equation.expression;
      return '';
    })
    .join('');
}

function isTextRichText(
  part: RichText[number] | undefined,
): part is RichTextText {
  return Boolean(part && 'text' in part);
}

function canMergeRichText(previous: RichTextText, next: RichTextText): boolean {
  const mergedLength = previous.text.content.length + next.text.content.length;

  return (
    mergedLength <= LIMITS.TEXT_CONTENT_CHARACTERS &&
    JSON.stringify(previous.annotations || {}) ===
      JSON.stringify(next.annotations || {}) &&
    JSON.stringify(previous.text.link || null) ===
      JSON.stringify(next.text.link || null)
  );
}

function trimRichText(richText: RichText): RichText {
  function updateContent(
    index: number,
    updater: (content: string) => string,
  ): RichText {
    const richTextPart = richText[index];

    if (!richTextPart) return [];

    if (!('text' in richTextPart)) return [richTextPart];

    const content = updater(richTextPart.text.content);

    if (!content) return [];

    return [
      {
        ...richTextPart,
        text: { ...richTextPart.text, content },
      },
    ];
  }

  if (richText.length === 0) return richText;

  if (richText.length === 1) {
    return updateContent(0, (content) => content.trim());
  }

  const first = updateContent(0, (content) => content.trimStart());
  const middle = richText.slice(1, -1);
  const last = updateContent(richText.length - 1, (content) =>
    content.trimEnd(),
  );

  return [...first, ...middle, ...last];
}
