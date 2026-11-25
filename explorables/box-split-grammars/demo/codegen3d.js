/**
 * codegen3d.js
 * Generates formatted, syntax-highlighted Python grammar code
 * from the hierarchical Region3D tree, with block ranges for scope visualization.
 */

import { TEXTURE_TYPES } from './textures.js';

const MATERIAL_MAP = {
  [TEXTURE_TYPES.OAK_LOG]: 'OAK_LOG',
  [TEXTURE_TYPES.COBBLESTONE]: 'COBBLESTONE',
  [TEXTURE_TYPES.OAK_PLANKS]: 'OAK_PLANKS'
};

export function generateGrammarCode3D(rootRegion) {
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
    blockEnd: defIndex
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

    const axis = node.cut.axis; // 'X' | 'Y' | 'Z'
    const dim = `Dimension.${axis}`;
    const dimHtml = `<span class="dim">Dimension.${axis}</span>`;

    const c1 = node.children[0];
    const c2 = node.children[1];
    const size1 = axis === 'X' ? c1.w : axis === 'Y' ? c1.h : c1.d;
    const size2 = axis === 'X' ? c2.w : axis === 'Y' ? c2.h : c2.d;

    const rawSplit = `with split(${dim}, [${size1}, ${size2}]):`;
    const splitHtml = `<span class="kw">with</span> <span class="fn">split</span>(${dimHtml}, [<span class="num">${size1}</span>, <span class="num">${size2}</span>]):`;

    lines.push({
      rawText: indentSpaces + rawSplit,
      textHtml: indentHtml + splitHtml,
      nodeId: node.id,
      indent: indentLevel,
      blockStart: startIndex,
      blockEnd: startIndex
    });

    traverse(c1, indentLevel + 1);
    traverse(c2, indentLevel + 1);

    lines[startIndex].blockEnd = lines.length - 1;
  }

  traverse(rootRegion, 1);
  lines[defIndex].blockEnd = lines.length - 1;

  const fullRawText = lines.map(l => l.rawText).join('\n');
  return { lines, fullRawText };
}
