// Watermark overlay for OA-0027 Villarreal internal-review build.
// Reads the generator's output PDF and stamps "INTERNAL REVIEW ONLY — DO NOT FILE" on every page.
// Does NOT modify gen-taxnet-final.js.
const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
const fs = require('fs');
const crypto = require('crypto');

const SRC = process.argv[2] || '/tmp/OA-0027_VILLARREAL_BROTHERS_INVESTMENTS_LLC_Equal_Uniform.pdf';
const DST = process.argv[3] || '/Users/aquabot/Documents/OverAssessed/server/filing-packages/review/OA-VILLARREAL-INTERNAL-REVIEW.pdf';
const WATERMARK = 'INTERNAL REVIEW ONLY — DO NOT FILE';

(async () => {
  const buf = fs.readFileSync(SRC);
  const pdf = await PDFDocument.load(buf);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  console.log('Pages found:', pages.length);

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const { width, height } = p.getSize();

    // Top banner — solid red bar with white text, plus plain extractable text below
    p.drawRectangle({ x: 0, y: height - 22, width, height: 22, color: rgb(0.85, 0.10, 0.10), opacity: 0.95 });
    p.drawText(WATERMARK, {
      x: width / 2 - helvBold.widthOfTextAtSize(WATERMARK, 11) / 2,
      y: height - 16,
      size: 11, font: helvBold, color: rgb(1, 1, 1),
    });

    // Bottom banner — same
    p.drawRectangle({ x: 0, y: 0, width, height: 22, color: rgb(0.85, 0.10, 0.10), opacity: 0.95 });
    p.drawText(WATERMARK, {
      x: width / 2 - helvBold.widthOfTextAtSize(WATERMARK, 11) / 2,
      y: 7,
      size: 11, font: helvBold, color: rgb(1, 1, 1),
    });

    // Diagonal centered watermark (large, semi-transparent)
    const diag = WATERMARK;
    p.drawText(diag, {
      x: width * 0.10,
      y: height * 0.45,
      size: 42, font: helvBold,
      color: rgb(0.85, 0.10, 0.10),
      opacity: 0.18,
      rotate: degrees(20),
    });

    // Plain extractable text marker (small, near top-left, normal text — for pdftotext verification)
    p.drawText(WATERMARK, {
      x: 30, y: height - 38,
      size: 8, font: helvBold,
      color: rgb(0.5, 0, 0),
    });
  }

  const out = await pdf.save();
  fs.writeFileSync(DST, out);
  fs.chmodSync(DST, 0o600);
  const md5 = crypto.createHash('md5').update(out).digest('hex');
  console.log('Output:', DST);
  console.log('Bytes :', out.length);
  console.log('Pages :', pages.length);
  console.log('md5   :', md5);
})();
