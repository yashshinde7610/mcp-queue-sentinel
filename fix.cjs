const fs = require('fs');
const files = ['queue.tools.ts', 'job.tools.ts', 'monitoring.tools.ts', 'connection.tools.ts'];
files.forEach(f => {
  const path = 'src/tools/' + f;
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(/Target connection ID \(uses last connected if omitted\)/g, 'Target connection ID');
  content = content.replace(/required: \[(.*?)\]/g, (match, p1) => {
    if (p1.includes('connectionId')) return match;
    if (p1.trim() === '') return 'required: ["connectionId"]';
    return `required: [${p1}, "connectionId"]`;
  });
  
  // connectionTools shouldn't have connectionId required for connect or list_connections
  // We'll just patch connectionTools to only require connectionId for disconnect
  if (f === 'connection.tools.ts') {
    content = content.replace(/required: \["id", "connectionId"\]/, 'required: ["id"]');
    content = content.replace(/inputSchema: \{ type: "object", properties: \{\} \},/g, 'inputSchema: { type: "object", properties: {} },');
  }
  
  // monitoringTools doesn't have a required array for get_metrics/reset_metrics, we need to add it
  if (f === 'monitoring.tools.ts') {
    content = content.replace(/properties: \{\n\s+connectionId: \{ type: "string", description: "Target connection ID" \},\n\s+\},/g, 'properties: {\n        connectionId: { type: "string", description: "Target connection ID" },\n      },\n      required: ["connectionId"],');
  }
  
  fs.writeFileSync(path, content);
});
console.log("Fixed tools!");
