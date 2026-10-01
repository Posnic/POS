'use strict';

// Short-lived parser process: stdin contains only the upload; stdout is bounded JSON.
const { PDFParse } = require('pdf-parse');
const input = [];
let bytes = 0;
process.stdin.on('data', (chunk) => {
  bytes += chunk.length;
  if (bytes > 10 * 1024 * 1024) process.exit(1);
  input.push(chunk);
});
process.stdin.on('end', async () => {
  const parser = new PDFParse({
    data: Buffer.concat(input),
    isEvalSupported: false,
    disableFontFace: true,
  });
  try {
    const result = await parser.getText();
    const mapped = require('./knowledge-page-map').fromPages(
      result.pages,
      Number(result.total || 0)
    );
    process.stdout.write(
      JSON.stringify(
        mapped.content.length > 200000
          ? { error: 'too_large' }
          : { text: mapped.content, pages: Number(result.total || 0), page_map: mapped.page_map }
      )
    );
  } catch (_error) {
    process.exitCode = 1;
  } finally {
    await parser.destroy();
  }
});
