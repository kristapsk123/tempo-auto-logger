// Captcha gate: blocks the popup's main UI for a hardcoded list of email
// addresses suspected of being driven by a bot. The challenge is a random
// arithmetic problem (add, subtract, or multiply) rendered onto a <canvas>
// with per-digit rotation, jitter and noise so the answer is not trivially
// scrapable from the DOM.

const BOT_SIGNATURES_RAW: readonly string[] = [
  'a2FybGlzLmJpcnpuaWVrc0B2aXNtYS5jb20=',
];

export const BOT_SIGNATURES: ReadonlySet<string> = new Set(
  BOT_SIGNATURES_RAW.map((encoded) => atob(encoded).toLowerCase()),
);

export function isEmailGated(email: string | undefined | null): boolean {
  if (!email) return false;
  return BOT_SIGNATURES.has(email.toLowerCase());
}

export type MathOperator = '+' | '-' | '\u00D7';

export interface MathChallenge {
  a: number;
  b: number;
  op: MathOperator;
  answer: number;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Add/subtract use 3-digit operands so the answer can't be eyeballed by a
// trivial OCR-free heuristic. Multiplication uses smaller operands so the
// problem stays solvable without paper.
const ADDSUB_MIN = 100;
const ADDSUB_MAX = 999;
const MUL_LEFT_MIN = 11;
const MUL_LEFT_MAX = 99;
const MUL_RIGHT_MIN = 2;
const MUL_RIGHT_MAX = 9;

const OPERATORS: readonly MathOperator[] = ['+', '-', '×'];

function buildAddChallenge(): MathChallenge {
  const a = randomInt(ADDSUB_MIN, ADDSUB_MAX);
  const b = randomInt(ADDSUB_MIN, ADDSUB_MAX);
  return { a, b, op: '+', answer: a + b };
}

function buildSubtractChallenge(): MathChallenge {
  let a = randomInt(ADDSUB_MIN, ADDSUB_MAX);
  let b = randomInt(ADDSUB_MIN, ADDSUB_MAX);
  if (b > a) [a, b] = [b, a];
  return { a, b, op: '-', answer: a - b };
}

function buildMultiplyChallenge(): MathChallenge {
  const a = randomInt(MUL_LEFT_MIN, MUL_LEFT_MAX);
  const b = randomInt(MUL_RIGHT_MIN, MUL_RIGHT_MAX);
  return { a, b, op: '×', answer: a * b };
}

export function generateMathChallenge(): MathChallenge {
  const op = OPERATORS[randomInt(0, OPERATORS.length - 1)];
  if (op === '+') return buildAddChallenge();
  if (op === '-') return buildSubtractChallenge();
  return buildMultiplyChallenge();
}

const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 64;
const GLYPH_FONT = 'bold 28px system-ui, sans-serif';
const NOISE_LINE_COUNT = 8;
const NOISE_DOT_COUNT = 60;

function pickGlyphColor(): string {
  const hue = randomInt(0, 359);
  return `hsl(${hue} 70% 30%)`;
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: string,
  centerX: number,
  centerY: number,
): void {
  const rotation = ((randomInt(-18, 18) * Math.PI) / 180);
  const offsetY = randomInt(-4, 4);
  ctx.save();
  ctx.translate(centerX, centerY + offsetY);
  ctx.rotate(rotation);
  ctx.fillStyle = pickGlyphColor();
  ctx.font = GLYPH_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, 0, 0);
  ctx.restore();
}

function drawNoise(ctx: CanvasRenderingContext2D): void {
  for (let i = 0; i < NOISE_LINE_COUNT; i += 1) {
    ctx.strokeStyle = `hsl(${randomInt(0, 359)} 50% 60%)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(randomInt(0, CANVAS_WIDTH), randomInt(0, CANVAS_HEIGHT));
    ctx.lineTo(randomInt(0, CANVAS_WIDTH), randomInt(0, CANVAS_HEIGHT));
    ctx.stroke();
  }
  for (let i = 0; i < NOISE_DOT_COUNT; i += 1) {
    ctx.fillStyle = `hsl(${randomInt(0, 359)} 50% 50%)`;
    ctx.fillRect(randomInt(0, CANVAS_WIDTH), randomInt(0, CANVAS_HEIGHT), 2, 2);
  }
}

export function renderChallengeToCanvas(
  canvas: HTMLCanvasElement,
  challenge: MathChallenge,
): void {
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const glyphs = [
    ...String(challenge.a),
    challenge.op,
    ...String(challenge.b),
    '=',
    '?',
  ];
  const stepX = CANVAS_WIDTH / (glyphs.length + 1);
  glyphs.forEach((glyph, index) => {
    drawGlyph(ctx, glyph, stepX * (index + 1), CANVAS_HEIGHT / 2);
  });

  drawNoise(ctx);
}
