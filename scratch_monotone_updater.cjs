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

let totalChanges = 0;
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let newContent = content;
  
  // Emerald / Teal mappings
  newContent = newContent.replace(/emerald-50(?!0)/g, 'zinc-50');
  newContent = newContent.replace(/emerald-100/g, 'zinc-100');
  newContent = newContent.replace(/emerald-200/g, 'zinc-200');
  newContent = newContent.replace(/emerald-300/g, 'zinc-300');
  newContent = newContent.replace(/emerald-400/g, 'zinc-400');
  newContent = newContent.replace(/emerald-500/g, 'zinc-500');
  newContent = newContent.replace(/emerald-600/g, 'zinc-900');
  newContent = newContent.replace(/emerald-700/g, 'zinc-800');
  newContent = newContent.replace(/emerald-/g, 'zinc-'); // Catch any others

  // Green mappings
  newContent = newContent.replace(/green-50(?!0)/g, 'zinc-50');
  newContent = newContent.replace(/green-100/g, 'zinc-100');
  newContent = newContent.replace(/green-200/g, 'zinc-200');
  newContent = newContent.replace(/green-300/g, 'zinc-300');
  newContent = newContent.replace(/green-400/g, 'zinc-400');
  newContent = newContent.replace(/green-500/g, 'zinc-500');
  newContent = newContent.replace(/green-600/g, 'zinc-900');
  newContent = newContent.replace(/green-700/g, 'zinc-800');
  newContent = newContent.replace(/shadow-green-600\/20/g, 'shadow-zinc-900/20');
  newContent = newContent.replace(/green-/g, 'zinc-');

  // Any remaining blue
  newContent = newContent.replace(/blue-50(?!0)/g, 'zinc-50');
  newContent = newContent.replace(/blue-100/g, 'zinc-100');
  newContent = newContent.replace(/blue-500/g, 'zinc-500');
  newContent = newContent.replace(/blue-600/g, 'zinc-900');

  // Clock Out buttons that are currently red-50
  newContent = newContent.replace(/bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700/g, 'bg-white text-zinc-900 hover:bg-zinc-100 border border-zinc-200 shadow-sm');
  newContent = newContent.replace(/text-red-600 bg-red-50 border-red-200/g, 'text-zinc-900 bg-zinc-50 border-zinc-200'); // generic tasks
  newContent = newContent.replace(/bg-red-50 text-red-700 hover:bg-red-100/g, 'bg-zinc-50 text-zinc-900 hover:bg-zinc-100');
  newContent = newContent.replace(/bg-red-50 text-red-600 hover:bg-red-100/g, 'bg-zinc-50 text-zinc-900 hover:bg-zinc-100');
  newContent = newContent.replace(/text-red-500 hover:text-red-700/g, 'text-zinc-500 hover:text-zinc-900'); // header log out button

  if (content !== newContent) {
    fs.writeFileSync(file, newContent, 'utf8');
    totalChanges++;
    console.log(`Updated ${file}`);
  }
});

console.log(`Finished updating ${totalChanges} files.`);
