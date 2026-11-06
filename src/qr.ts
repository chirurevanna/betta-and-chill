/** Draws a QR code for `text` onto a canvas. The encoder is loaded lazily. */
export async function drawQR(canvas: HTMLCanvasElement, text: string) {
  const { encode } = await import('uqr');
  const { data, size } = encode(text, { ecc: 'M', border: 2 });
  const dpr = Math.min(devicePixelRatio || 1, 3);
  const css = canvas.clientWidth || 132;
  canvas.width = Math.round(css * dpr);
  canvas.height = Math.round(css * dpr);
  const ctx = canvas.getContext('2d')!;
  const cell = canvas.width / size;
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1c2238';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y][x]) ctx.fillRect(Math.floor(x * cell), Math.floor(y * cell), Math.ceil(cell), Math.ceil(cell));
    }
  }
}
