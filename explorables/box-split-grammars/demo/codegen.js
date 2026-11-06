/**
 * codegen.js
 * Generates formatted, syntax-highlighted Python grammar code
 * from the hierarchical Region tree, with block ranges for scope visualization.
 */

import { TEXTURE_TYPES } from './textures.js';

const MATERIAL_MAP = {
  [TEXTURE_TYPES.OAK_LOG]: 'OAK_LOG',
  [TEXTURE_TYPES.COBBLESTONE]: 'COBBLESTONE',
  [TEXTURE_TYPES.OAK_PLANKS]: 'OAK_PLANKS'
};

export function generateGrammarCode(rootRegion) {
  const lines = [];

  // Line 0: @rule decorator
  lines.push({
    rawText: '@rule',
    textHtml: '<span class="kw">@rule</span>',
    nodeId: null,
    indent: 0,
    blockStart: 0,
    blockEnd: 0
  });

  // Line 1: def structure():
  const defIndex = lines.length;
  lines.push({
    rawText: 'def structure():',
    textHtml: '<span class="kw">def</span> <span class="fn">structure</span>():',
    nodeId: rootRegion.id,
    indent: 0,
    blockStart: defIndex,
    blockEnd: defIndex // will be updated after traverse
  });

  function traverse(node, indentLevel) {
    const startIndex = lines.length;
    const indentSpaces = '  '.repeat(indentLevel);
    const indentHtml = '&nbsp;&nbsp;'.repeat(indentLevel);

    if (node.isLeaf()) {
      let callHtml, rawCall;
      if (node.fill && MATERIAL_MAP[node.fill]) {
        const mat = MATERIAL_MAP[node.fill];
        rawCall = `fill(${mat})`;
        callHtml = `<span class="fn">fill</span>(<span class="const">${mat}</span>)`;
      } else {
        rawCall = 'void()';
        callHtml = '<span class="fn">void</span>()';
      }

      lines.push({
        rawText: indentSpaces + rawCall,
        textHtml: indentHtml + callHtml,
        nodeId: node.id,
        indent: indentLevel,
        blockStart: startIndex,
        blockEnd: startIndex
      });
      return;
    }

    // Split Node Header
    const axis = node.cut.axis;
    const dim = axis === 'V' ? 'Dimension.X' : 'Dimension.Y';
    const dimHtml = `<span class="dim">Dimension.${axis === 'V' ? 'X' : 'Y'}</span>`;

    const c1 = node.children[0];
    const c2 = node.children[1];
    const size1 = axis === 'V' ? c1.w : c1.h;
    const size2 = axis === 'V' ? c2.w : c2.h;

    const rawSplit = `with split(${dim}, [${size1}, ${size2}]):`;
    const splitHtml = `<span class="kw">with</span> <span class="fn">split</span>(${dimHtml}, [<span class="num">${size1}</span>, <span class="num">${size2}</span>]):`;

    lines.push({
      rawText: indentSpaces + rawSplit,
      textHtml: indentHtml + splitHtml,
      nodeId: node.id,
      indent: indentLevel,
      blockStart: startIndex,
      blockEnd: startIndex // will update below
    });

    traverse(c1, indentLevel + 1);
    traverse(c2, indentLevel + 1);

    // Update blockEnd to encompass all child lines
    lines[startIndex].blockEnd = lines.length - 1;
  }

  traverse(rootRegion, 1);

  // Update def line to encompass all lines
  lines[defIndex].blockEnd = lines.length - 1;

  const fullRawText = lines.map(l => l.rawText).join('\n');
  return { lines, fullRawText };
}
