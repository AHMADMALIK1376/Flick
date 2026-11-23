const fs = require('fs');
const path = require('path');

const copies = [
  ['src/renderer/widget/widget.html', 'build/renderer/widget/widget.html'],
  ['src/renderer/onboarding/onboarding.html', 'build/renderer/onboarding/onboarding.html'],
  ['src/renderer/dashboard/dashboard.html', 'build/renderer/dashboard/dashboard.html'],
  ['src/renderer/answer/answer.html', 'build/renderer/answer/answer.html'],
  ['src/renderer/audio/vad-processor.js', 'build/renderer/audio/vad-processor.js'],
];

for (const [src, dest] of copies) {
  const destDir = path.dirname(dest);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
}

console.log('Assets copied to build/');
