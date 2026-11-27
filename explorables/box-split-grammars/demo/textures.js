/**
 * textures.js
 * Provides authentic 16x16 pixel-accurate textures matching the official
 * Minecraft Java Edition assets for:
 * - Oak Log (top circular rings and bark)
 * - Cobblestone (rocky stone masonry)
 * - Oak Planks (horizontal wooden planks with nail/grain seams)
 */

export const TEXTURE_TYPES = {
  OAK_LOG: 'oak_log',
  COBBLESTONE: 'cobblestone',
  OAK_PLANKS: 'oak_planks',
  GLASS: 'glass'
};

export const TEXTURE_LABELS = {
  [TEXTURE_TYPES.OAK_LOG]: 'Oak Log',
  [TEXTURE_TYPES.COBBLESTONE]: 'Cobblestone',
  [TEXTURE_TYPES.OAK_PLANKS]: 'Oak Planks',
  [TEXTURE_TYPES.GLASS]: 'Glass Window'
};

// Official Minecraft Java Edition 16x16 pixel palettes and raster index maps
const OAK_LOG_PALETTE = ['#5f4a2b', '#4c3d26', '#745a36', '#b8945f', '#af8f55', '#c29d62', '#7e6237', '#967441', '#9f844d'];
const OAK_LOG_ROWS = [
  '0102010021001000',
  '1333343454433331',
  '0366778788887750',
  '0365533334333730',
  '0473444444443840',
  '1383477887743741',
  '0474464444744730',
  '0483474884843840',
  '0483474874743740',
  '1483474444844741',
  '0473477678843840',
  '0483444444443740',
  '1383343333353741',
  '0387877777777730',
  '0333443445443330',
  '0100010021001200'
];

// Official Minecraft Java Edition 16x16 Oak Log Bark (vertical wood bark ridges)
const OAK_LOG_BARK_PALETTE = ['#745a36', '#4c3d26', '#917142', '#382b18', '#5f4a2b', '#987849'];
const OAK_LOG_BARK_ROWS = [
  '0120032003021204',
  '0154035403021004',
  '0344035401011004',
  '2304010404031024',
  '2104030454040120',
  '2010210154210120',
  '4010244020200120',
  '4030204200240420',
  '0135004204242420',
  '0015004004212030',
  '0002040304012030',
  '0102040350035010',
  '5100242354030040',
  '5010200124010000',
  '2012002301011200',
  '2012102101001204'
];

const COBBLESTONE_PALETTE = ['#6e6d6d', '#616161', '#a6a6a6', '#525252', '#b5b5b5', '#888788'];
const COBBLESTONE_ROWS = [
  '0122311242515425',
  '1245534425531505',
  '1252012552013150',
  '1150115050152513',
  '3015421511422251',
  '4024550135542505',
  '2515255011025014',
  '5500550154210515',
  '0142001545551130',
  '1425050055101521',
  '5050511310013224',
  '5001105421135445',
  '0542014252015505',
  '1425512505501150',
  '2250501055012511',
  '1511050101154250'
];

const OAK_PLANKS_PALETTE = ['#b8945f', '#af8f55', '#c29d62', '#967441', '#9f844d', '#7e6237', '#67502c'];
const OAK_PLANKS_ROWS = [
  '0102222202222203',
  '0011341000110044',
  '1000101444411003',
  '3553356655656656',
  '0242222422201140',
  '1001414341100001',
  '4410111300011444',
  '6655356666555356',
  '0220112222222204',
  '0100001444141443',
  '2011444411114404',
  '6653356665355666',
  '2402200422242022',
  '1100441440010111',
  '1441014300144444',
  '6556653335656666'
];

// Minecraft-style framed glass pane texture (pale sky tint + glint streaks)
const GLASS_PALETTE = ['#89b4c4', '#d8f1fa', '#eef9fd', '#ffffff', '#64748b'];
const GLASS_ROWS = [
  '4444444444444444',
  '4000000000000004',
  '4011111111111104',
  '4012331111111104',
  '4012311111111104',
  '4011111111111104',
  '4011111111111104',
  '4011111112111104',
  '4011111121111104',
  '4011111111111104',
  '4011111111111104',
  '4011111111112104',
  '4011111111123104',
  '4011111111111104',
  '4000000000000004',
  '4444444444444444'
];

function createTextureCanvas(palette, rows) {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d');
  for (let y = 0; y < 16; y++) {
    const row = rows[y];
    for (let x = 0; x < 16; x++) {
      const colorIndex = parseInt(row[x], 10);
      ctx.fillStyle = palette[colorIndex];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

export class TextureLibrary {
  constructor() {
    this.canvases = {
      [TEXTURE_TYPES.OAK_LOG]: createTextureCanvas(OAK_LOG_PALETTE, OAK_LOG_ROWS),
      [TEXTURE_TYPES.COBBLESTONE]: createTextureCanvas(COBBLESTONE_PALETTE, COBBLESTONE_ROWS),
      [TEXTURE_TYPES.OAK_PLANKS]: createTextureCanvas(OAK_PLANKS_PALETTE, OAK_PLANKS_ROWS),
      [TEXTURE_TYPES.GLASS]: createTextureCanvas(GLASS_PALETTE, GLASS_ROWS)
    };
    this.sideCanvases = {
      [TEXTURE_TYPES.OAK_LOG]: createTextureCanvas(OAK_LOG_BARK_PALETTE, OAK_LOG_BARK_ROWS)
    };
  }

  getCanvas(type) {
    return this.canvases[type] || null;
  }

  getSideCanvas(type) {
    return this.sideCanvases[type] || this.getCanvas(type);
  }
}
