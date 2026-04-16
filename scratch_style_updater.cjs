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
  [/gray-/g, 'zinc-'],
  
  // Blue mappings
  [/bg-blue-50/g, 'bg-zinc-50'],
  [/bg-blue-100/g, 'bg-zinc-100'],
  [/bg-blue-200/g, 'bg-zinc-200'],
  [/bg-blue-500/g, 'bg-zinc-800'],
  [/bg-blue-600/g, 'bg-zinc-900'],
  [/hover:bg-blue-700/g, 'hover:bg-zinc-800'],
  [/hover:bg-blue-50/g, 'hover:bg-zinc-50'],
  [/hover:text-blue-500/g, 'hover:text-zinc-500'],
  [/hover:text-blue-600/g, 'hover:text-zinc-600'],
  [/hover:text-blue-700/g, 'hover:text-zinc-700'],
  [/text-blue-500/g, 'text-zinc-500'],
  [/text-blue-600/g, 'text-zinc-900'],
  [/text-blue-700/g, 'text-zinc-800'],
  [/text-blue-900/g, 'text-zinc-900'],
  [/border-blue-200/g, 'border-zinc-200'],
  [/border-blue-500/g, 'border-zinc-300'],
  [/shadow-blue-600\/20/g, 'shadow-zinc-900/20'],
  
  // Indigo mappings
  [/bg-indigo-50/g, 'bg-zinc-50'],
  [/border-indigo-100/g, 'border-zinc-100'],
  [/border-indigo-200/g, 'border-zinc-200'],
  [/border-indigo-300/g, 'border-zinc-300'],
  [/hover:border-indigo-200/g, 'hover:border-zinc-200'],
  [/hover:border-indigo-300/g, 'hover:border-zinc-300'],
  [/bg-indigo-600/g, 'bg-zinc-800'],
  [/hover:bg-indigo-50/g, 'hover:bg-zinc-50'],
  [/hover:bg-indigo-100/g, 'hover:bg-zinc-100'],
  [/hover:bg-indigo-700/g, 'hover:bg-zinc-700'],
  [/text-indigo-500/g, 'text-zinc-500'],
  [/text-indigo-600/g, 'text-zinc-900'],
  [/hover:text-indigo-600/g, 'hover:text-zinc-900'],
  
  // Teal mappings
  [/teal-/g, 'emerald-'],
  
  // App-specific aesthetics logic
  [/bg-gradient-to-tr from-blue-600 to-indigo-600/g, 'bg-zinc-900 text-white'],
  [/bg-blue-50 rounded-full blur-3xl opacity-50/g, 'bg-zinc-100 rounded-full blur-3xl opacity-50'],
  [/bg-indigo-50 rounded-full blur-3xl opacity-50/g, 'bg-zinc-100 rounded-full blur-3xl opacity-50']
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
