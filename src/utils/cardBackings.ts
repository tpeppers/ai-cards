export interface CardBacking {
  id: string;
  name: string;
  pattern: string;
  themed?: boolean;
}

function svgDataUri(svgContent: string, width: number, height: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>${svgContent}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// --- Themed SVG patterns ---

const natureSvg = svgDataUri(
  `<path d='M12 5 Q22 0 22 15 Q22 22 12 18 Q5 15 12 5Z' fill='rgba(34,139,34,0.35)' stroke='rgba(0,80,0,0.3)' stroke-width='0.5'/>` +
  `<line x1='12' y1='5' x2='17' y2='18' stroke='rgba(0,80,0,0.25)' stroke-width='0.5'/>` +
  `<path d='M38 30 Q48 25 48 40 Q48 47 38 43 Q31 40 38 30Z' fill='rgba(34,139,34,0.3)' stroke='rgba(0,80,0,0.25)' stroke-width='0.5'/>` +
  `<line x1='38' y1='30' x2='43' y2='43' stroke='rgba(0,80,0,0.2)' stroke-width='0.5'/>` +
  `<circle cx='35' cy='10' r='2' fill='rgba(255,182,193,0.4)'/>` +
  `<circle cx='5' cy='42' r='1.5' fill='rgba(255,255,150,0.35)'/>` +
  `<path d='M25 48 Q30 44 28 38' fill='none' stroke='rgba(0,100,0,0.25)' stroke-width='0.8'/>` +
  `<path d='M0 25 Q3 20 0 15' fill='none' stroke='rgba(0,100,0,0.2)' stroke-width='0.6'/>`,
  50, 50
);

const holySvg = svgDataUri(
  `<rect x='22' y='5' width='6' height='40' rx='1' fill='rgba(255,215,0,0.25)'/>` +
  `<rect x='10' y='16' width='30' height='6' rx='1' fill='rgba(255,215,0,0.25)'/>` +
  `<line x1='25' y1='0' x2='25' y2='3' stroke='rgba(255,215,0,0.15)' stroke-width='0.5'/>` +
  `<line x1='25' y1='47' x2='25' y2='50' stroke='rgba(255,215,0,0.15)' stroke-width='0.5'/>` +
  `<line x1='0' y1='19' x2='6' y2='19' stroke='rgba(255,215,0,0.15)' stroke-width='0.5'/>` +
  `<line x1='44' y1='19' x2='50' y2='19' stroke='rgba(255,215,0,0.15)' stroke-width='0.5'/>` +
  `<circle cx='5' cy='5' r='1.2' fill='rgba(255,215,0,0.3)'/>` +
  `<circle cx='45' cy='45' r='1.2' fill='rgba(255,215,0,0.3)'/>` +
  `<circle cx='45' cy='5' r='0.8' fill='rgba(255,215,0,0.2)'/>` +
  `<circle cx='5' cy='45' r='0.8' fill='rgba(255,215,0,0.2)'/>`,
  50, 50
);

const scienceSvg = svgDataUri(
  `<ellipse cx='25' cy='25' rx='18' ry='7' fill='none' stroke='rgba(0,200,255,0.25)' stroke-width='0.8'/>` +
  `<ellipse cx='25' cy='25' rx='18' ry='7' fill='none' stroke='rgba(0,200,255,0.2)' stroke-width='0.8' transform='rotate(60 25 25)'/>` +
  `<ellipse cx='25' cy='25' rx='18' ry='7' fill='none' stroke='rgba(0,200,255,0.2)' stroke-width='0.8' transform='rotate(120 25 25)'/>` +
  `<circle cx='25' cy='25' r='3' fill='rgba(0,200,255,0.3)'/>` +
  `<circle cx='7' cy='25' r='1.8' fill='rgba(100,255,218,0.45)'/>` +
  `<circle cx='34' cy='14' r='1.8' fill='rgba(100,255,218,0.45)'/>` +
  `<circle cx='34' cy='36' r='1.8' fill='rgba(100,255,218,0.45)'/>` +
  `<circle cx='3' cy='5' r='0.8' fill='rgba(0,200,255,0.2)'/>` +
  `<circle cx='47' cy='5' r='0.6' fill='rgba(0,200,255,0.15)'/>` +
  `<circle cx='3' cy='47' r='0.6' fill='rgba(0,200,255,0.15)'/>`,
  50, 50
);

const underwaterSvg = svgDataUri(
  `<circle cx='12' cy='15' r='5' fill='none' stroke='rgba(150,220,255,0.3)' stroke-width='0.8'/>` +
  `<circle cx='13' cy='13' r='1.2' fill='rgba(255,255,255,0.25)'/>` +
  `<circle cx='38' cy='32' r='3.5' fill='none' stroke='rgba(150,220,255,0.25)' stroke-width='0.7'/>` +
  `<circle cx='39' cy='30.5' r='0.8' fill='rgba(255,255,255,0.2)'/>` +
  `<circle cx='25' cy='45' r='2' fill='none' stroke='rgba(150,220,255,0.2)' stroke-width='0.5'/>` +
  `<circle cx='42' cy='8' r='1.5' fill='none' stroke='rgba(150,220,255,0.2)' stroke-width='0.5'/>` +
  `<circle cx='8' cy='38' r='1' fill='none' stroke='rgba(150,220,255,0.15)' stroke-width='0.4'/>` +
  `<path d='M3 50 Q6 40 3 30 Q0 22 3 12' fill='none' stroke='rgba(0,160,80,0.25)' stroke-width='1.5'/>` +
  `<path d='M47 50 Q44 42 47 35' fill='none' stroke='rgba(0,160,80,0.2)' stroke-width='1'/>`,
  50, 50
);

const steampunkSvg = svgDataUri(
  `<circle cx='25' cy='25' r='13' fill='none' stroke='rgba(210,175,105,0.35)' stroke-width='2'/>` +
  `<circle cx='25' cy='25' r='8' fill='none' stroke='rgba(210,175,105,0.25)' stroke-width='1'/>` +
  `<circle cx='25' cy='25' r='3' fill='rgba(210,175,105,0.2)'/>` +
  `<rect x='23' y='10' width='4' height='4' rx='0.5' fill='rgba(210,175,105,0.3)'/>` +
  `<rect x='23' y='36' width='4' height='4' rx='0.5' fill='rgba(210,175,105,0.3)'/>` +
  `<rect x='10' y='23' width='4' height='4' rx='0.5' fill='rgba(210,175,105,0.3)'/>` +
  `<rect x='36' y='23' width='4' height='4' rx='0.5' fill='rgba(210,175,105,0.3)'/>` +
  `<rect x='14' y='13' width='3.5' height='3.5' rx='0.5' fill='rgba(210,175,105,0.25)' transform='rotate(45 15.75 14.75)'/>` +
  `<rect x='32.5' y='32.5' width='3.5' height='3.5' rx='0.5' fill='rgba(210,175,105,0.25)' transform='rotate(45 34.25 34.25)'/>` +
  `<rect x='32.5' y='13' width='3.5' height='3.5' rx='0.5' fill='rgba(210,175,105,0.25)' transform='rotate(45 34.25 14.75)'/>` +
  `<rect x='14' y='32.5' width='3.5' height='3.5' rx='0.5' fill='rgba(210,175,105,0.25)' transform='rotate(45 15.75 34.25)'/>` +
  `<circle cx='5' cy='5' r='1.8' fill='rgba(180,150,80,0.3)' stroke='rgba(120,100,50,0.2)' stroke-width='0.5'/>` +
  `<circle cx='45' cy='5' r='1.8' fill='rgba(180,150,80,0.3)' stroke='rgba(120,100,50,0.2)' stroke-width='0.5'/>` +
  `<circle cx='5' cy='45' r='1.8' fill='rgba(180,150,80,0.3)' stroke='rgba(120,100,50,0.2)' stroke-width='0.5'/>` +
  `<circle cx='45' cy='45' r='1.8' fill='rgba(180,150,80,0.3)' stroke='rgba(120,100,50,0.2)' stroke-width='0.5'/>`,
  50, 50
);

const egyptianSvg = svgDataUri(
  `<path d='M30 8 L46 44 L14 44 Z' fill='none' stroke='rgba(218,165,32,0.35)' stroke-width='1'/>` +
  `<line x1='30' y1='8' x2='30' y2='44' stroke='rgba(218,165,32,0.15)' stroke-width='0.5'/>` +
  `<line x1='22' y1='26' x2='38' y2='26' stroke='rgba(218,165,32,0.12)' stroke-width='0.5'/>` +
  `<ellipse cx='30' cy='52' rx='7' ry='3.5' fill='none' stroke='rgba(218,165,32,0.3)' stroke-width='0.8'/>` +
  `<circle cx='30' cy='52' r='1.8' fill='rgba(218,165,32,0.25)'/>` +
  `<line x1='23' y1='52' x2='19' y2='56' stroke='rgba(218,165,32,0.2)' stroke-width='0.6'/>` +
  `<circle cx='8' cy='8' r='3' fill='none' stroke='rgba(218,165,32,0.25)' stroke-width='0.8'/>` +
  `<line x1='8' y1='11' x2='8' y2='20' stroke='rgba(218,165,32,0.25)' stroke-width='0.8'/>` +
  `<line x1='5' y1='15' x2='11' y2='15' stroke='rgba(218,165,32,0.25)' stroke-width='0.8'/>` +
  `<circle cx='52' cy='5' r='0.8' fill='rgba(218,165,32,0.3)'/>` +
  `<circle cx='55' cy='48' r='0.8' fill='rgba(218,165,32,0.25)'/>`,
  60, 60
);

const iceSvg = svgDataUri(
  `<line x1='25' y1='8' x2='25' y2='42' stroke='rgba(200,230,255,0.35)' stroke-width='1'/>` +
  `<line x1='10' y1='16.5' x2='40' y2='33.5' stroke='rgba(200,230,255,0.35)' stroke-width='1'/>` +
  `<line x1='10' y1='33.5' x2='40' y2='16.5' stroke='rgba(200,230,255,0.35)' stroke-width='1'/>` +
  `<line x1='25' y1='13' x2='21' y2='9' stroke='rgba(200,230,255,0.25)' stroke-width='0.6'/>` +
  `<line x1='25' y1='13' x2='29' y2='9' stroke='rgba(200,230,255,0.25)' stroke-width='0.6'/>` +
  `<line x1='25' y1='37' x2='21' y2='41' stroke='rgba(200,230,255,0.25)' stroke-width='0.6'/>` +
  `<line x1='25' y1='37' x2='29' y2='41' stroke='rgba(200,230,255,0.25)' stroke-width='0.6'/>` +
  `<line x1='14' y1='19' x2='11' y2='15' stroke='rgba(200,230,255,0.2)' stroke-width='0.5'/>` +
  `<line x1='14' y1='31' x2='11' y2='35' stroke='rgba(200,230,255,0.2)' stroke-width='0.5'/>` +
  `<line x1='36' y1='19' x2='39' y2='15' stroke='rgba(200,230,255,0.2)' stroke-width='0.5'/>` +
  `<line x1='36' y1='31' x2='39' y2='35' stroke='rgba(200,230,255,0.2)' stroke-width='0.5'/>` +
  `<circle cx='25' cy='25' r='2.5' fill='rgba(200,230,255,0.25)'/>` +
  `<line x1='5' y1='2' x2='5' y2='8' stroke='rgba(200,230,255,0.2)' stroke-width='0.5'/>` +
  `<line x1='2' y1='5' x2='8' y2='5' stroke='rgba(200,230,255,0.2)' stroke-width='0.5'/>` +
  `<line x1='45' y1='42' x2='45' y2='48' stroke='rgba(200,230,255,0.2)' stroke-width='0.5'/>` +
  `<line x1='42' y1='45' x2='48' y2='45' stroke='rgba(200,230,255,0.2)' stroke-width='0.5'/>`,
  50, 50
);

// --- Exported backing definitions ---

export const simpleBackings: CardBacking[] = [
  { id: 'classic', name: 'Classic Green', pattern: 'repeating-linear-gradient(45deg, #006400, #006400 5px, #005300 5px, #005300 10px)' },
  { id: 'blue', name: 'Royal Blue', pattern: 'repeating-linear-gradient(45deg, #1a237e, #1a237e 5px, #0d1442 5px, #0d1442 10px)' },
  { id: 'red', name: 'Casino Red', pattern: 'repeating-linear-gradient(45deg, #8b0000, #8b0000 5px, #5c0000 5px, #5c0000 10px)' },
  { id: 'purple', name: 'Royal Purple', pattern: 'repeating-linear-gradient(45deg, #4a148c, #4a148c 5px, #2a0a52 5px, #2a0a52 10px)' },
  { id: 'gold', name: 'Gold Pattern', pattern: 'repeating-linear-gradient(45deg, #b8860b, #b8860b 5px, #8b6508 5px, #8b6508 10px)' },
  { id: 'teal', name: 'Ocean Teal', pattern: 'repeating-linear-gradient(45deg, #00695c, #00695c 5px, #004d40 5px, #004d40 10px)' },
];

export const themedBackings: CardBacking[] = [
  { id: 'nature', name: 'Nature', themed: true,
    pattern: `${natureSvg}, linear-gradient(135deg, #1a472a 0%, #2d5a27 50%, #1a3a1a 100%)` },
  { id: 'holy', name: 'Holy', themed: true,
    pattern: `${holySvg}, linear-gradient(135deg, #2a1a4e 0%, #3d1f6e 40%, #4a2060 100%)` },
  { id: 'science', name: 'Science', themed: true,
    pattern: `${scienceSvg}, linear-gradient(135deg, #0a1628 0%, #0d2137 50%, #071320 100%)` },
  { id: 'underwater', name: 'Underwater', themed: true,
    pattern: `${underwaterSvg}, linear-gradient(180deg, #003d66 0%, #001a4d 60%, #000d33 100%)` },
  { id: 'steampunk', name: 'Steampunk', themed: true,
    pattern: `${steampunkSvg}, linear-gradient(135deg, #3d2b1f 0%, #5c3a21 50%, #2e1f14 100%)` },
  { id: 'egyptian', name: 'Egyptian', themed: true,
    pattern: `${egyptianSvg}, linear-gradient(135deg, #3d2b1f 0%, #4a3728 50%, #2a1e14 100%)` },
  { id: 'ice', name: 'Ice', themed: true,
    pattern: `${iceSvg}, linear-gradient(135deg, #1a3a5c 0%, #2a5a7e 50%, #1a4a6e 100%)` },
];

export const allBackings: CardBacking[] = [...simpleBackings, ...themedBackings];

const backingMap: { [key: string]: string } = Object.fromEntries(
  allBackings.map(b => [b.id, b.pattern])
);

export const getCardBacking = (): string => {
  const backingId = localStorage.getItem('cardBacking') || 'classic';
  return backingMap[backingId] || backingMap['classic'];
};
