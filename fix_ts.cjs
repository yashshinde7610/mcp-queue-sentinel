const fs = require('fs');
['src/services/queue.service.ts', 'src/services/job.service.ts', 'src/analytics/failure-analyzer.ts'].forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  content = content.replace(/connectionId\?: string/g, 'connectionId: string');
  fs.writeFileSync(f, content);
});
console.log("Fixed optional params!");
