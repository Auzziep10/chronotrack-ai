const fs = require('fs');
const path = require('path');

const walk = (dir) => {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      if (!file.includes('node_modules') && !file.includes('dist') && !file.includes('.git')) {
        results = results.concat(walk(file));
      }
    } else { 
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('e:/Apps/chronotrack-ai');

const replacements = [
  [/slate-/g, 'zinc-'],
  [/purple-/g, 'zinc-'],
  [/indigo-/g, 'zinc-'],
  [/blue-/g, 'zinc-']
];

let totalChanges = 0;
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let newContent = content;
  
  replacements.forEach(([regex, replacement]) => {
    newContent = newContent.replace(regex, replacement);
  });
  
  if (content !== newContent) {
    fs.writeFileSync(file, newContent, 'utf8');
    totalChanges++;
    console.log(`Updated ${file}`);
  }
});

console.log(`Finished updating ${totalChanges} files.`);
