import fs from 'node:fs';
const file = 'server/src/app.js';
let content = fs.readFileSync(file, 'utf8');

const startMarker = '  "  app.get';
const endMarker = '  const workbook = new ExcelJS.Workbook();';
const idx1 = content.indexOf(startMarker);
const idx2 = content.indexOf(endMarker);

if (idx1 > 0 && idx2 > idx1) {
  content = content.substring(0, idx1) + '    const rows = db.all(sql, params);\n' + content.substring(idx2);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Fixed! Removed corrupted section from char', idx1, 'to', idx2);
} else {
  console.log('Could not find markers. idx1=', idx1, 'idx2=', idx2);
}
</parameter>