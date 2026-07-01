import { describe, expect, it } from 'vite-plus/test';

import { LIMITS } from '../../notion-limits';
import { convertHtmlToBlocks } from '../html-to-notion';

import { htmlTestCases } from './fixtures';

describe('convertHtmlToBlocks', () => {
  it.each(htmlTestCases)(
    'returns expected blocks for "$name"',
    ({ html, expected }) => {
      expect(convertHtmlToBlocks(html)).toStrictEqual(expected);
    },
  );

  it('splits paragraph rich text that exceeds the Notion array limit', () => {
    const spanCount = LIMITS.BLOCK_ARRAY_ELEMENTS + 1;
    const expectedRichText = (offset: number) =>
      Array.from({ length: LIMITS.BLOCK_ARRAY_ELEMENTS }, (_, index) => {
        const richTextIndex = offset + index;
        return {
          annotations: {
            [richTextIndex % 2 === 0 ? 'bold' : 'italic']: true,
          },
          text: { content: String(Math.floor(richTextIndex / 2)) },
        };
      });
    const oversizedParagraph = Array.from(
      { length: spanCount },
      (_, index) => `<strong>${index}</strong><em>${index}</em>`,
    ).join('');
    const html = `<p>Before</p><p>${oversizedParagraph}</p>`;

    const blocks = convertHtmlToBlocks(html);

    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toStrictEqual({
      paragraph: {
        rich_text: [{ text: { content: 'Before' } }],
      },
    });
    expect(blocks[1]).toStrictEqual({
      paragraph: {
        rich_text: expectedRichText(0),
      },
    });
    expect(blocks[2]).toStrictEqual({
      paragraph: {
        rich_text: expectedRichText(LIMITS.BLOCK_ARRAY_ELEMENTS),
      },
    });
    expect(blocks[3]).toStrictEqual({
      paragraph: {
        rich_text: [
          {
            annotations: { bold: true },
            text: { content: String(LIMITS.BLOCK_ARRAY_ELEMENTS) },
          },
          {
            annotations: { italic: true },
            text: { content: String(LIMITS.BLOCK_ARRAY_ELEMENTS) },
          },
        ],
      },
    });
  });

  it('merges adjacent compatible rich text before splitting paragraphs', () => {
    const spanCount = LIMITS.BLOCK_ARRAY_ELEMENTS + 1;
    const html = Array.from(
      { length: spanCount },
      (_, index) => `<strong>${index}</strong>`,
    ).join('');

    expect(convertHtmlToBlocks(html)).toStrictEqual([
      {
        paragraph: {
          rich_text: [
            {
              annotations: { bold: true },
              text: {
                content: Array.from({ length: spanCount }, (_, index) =>
                  String(index),
                ).join(''),
              },
            },
          ],
        },
      },
    ]);
  });

  it('converts HTML tables to Notion table blocks', () => {
    const html = `
      <table>
        <tbody>
          <tr>
            <th><p><strong>Concept</strong></p></th>
            <th><p><strong>Definition</strong></p></th>
          </tr>
          <tr>
            <td><p>Reference point</p></td>
            <td><p>Expected utility<br><span style="color: var(--fill-secondary, inherit);">Locator: [55]</span></p></td>
          </tr>
        </tbody>
      </table>
    `;

    expect(convertHtmlToBlocks(html)).toStrictEqual([
      {
        table: {
          table_width: 2,
          has_column_header: true,
          children: [
            {
              table_row: {
                cells: [
                  [
                    {
                      annotations: { bold: true },
                      text: { content: 'Concept' },
                    },
                  ],
                  [
                    {
                      annotations: { bold: true },
                      text: { content: 'Definition' },
                    },
                  ],
                ],
              },
            },
            {
              table_row: {
                cells: [
                  [{ text: { content: 'Reference point' } }],
                  [
                    { text: { content: 'Expected utility' } },
                    { text: { content: '\n' } },
                    {
                      text: { content: 'Locator: [55]' },
                    },
                  ],
                ],
              },
            },
          ],
        },
      },
    ]);
  });

  it('flattens nested cell blocks into newline-separated table cell rich text', () => {
    const html = `
      <table>
        <tr>
          <td>
            <p><strong>Definition</strong></p>
            <blockquote><p><em>quoted evidence</em></p></blockquote>
          </td>
          <td><p><a href="https://notion.so/">link</a></p></td>
        </tr>
      </table>
    `;

    expect(convertHtmlToBlocks(html)).toStrictEqual([
      {
        table: {
          table_width: 2,
          children: [
            {
              table_row: {
                cells: [
                  [
                    {
                      annotations: { bold: true },
                      text: { content: 'Definition' },
                    },
                    { text: { content: '\n' } },
                    {
                      annotations: { italic: true },
                      text: { content: 'quoted evidence' },
                    },
                  ],
                  [
                    {
                      text: {
                        content: 'link',
                        link: { url: 'https://notion.so/' },
                      },
                    },
                  ],
                ],
              },
            },
          ],
        },
      },
    ]);
  });
});
