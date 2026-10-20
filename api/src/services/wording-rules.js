const protect = /<(?:[^>]+)>|\{\{?\s*[\w.]+\s*\}?\}|%(?:\d+\$)?[sdif]/g;
function applyRules(text, rules) {
  if (!rules?.length) return text;
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sorted = [...rules].sort((a,b) => b.from.length-a.from.length);
  const re = new RegExp('(^|[^\\p{L}\\p{N}_])(' + sorted.map(r=>escape(r.from)).join('|') + ')(?=$|[^\\p{L}\\p{N}_])', 'giu');
  function replace(s) { return s.replace(re, (_, prefix, word) => {
    let value = sorted.find(r=>r.from.toLowerCase()===word.toLowerCase()).to;
    if(word===word.toUpperCase()) value=value.toUpperCase();
    else if(word[0]===word[0].toUpperCase()) value=value[0].toUpperCase()+value.slice(1);
    else value=value[0].toLowerCase()+value.slice(1);
    return prefix+value;
  }); }
  let out='', cursor=0;
  for(const match of text.matchAll(protect)) { out+=replace(text.slice(cursor,match.index))+match[0]; cursor=match.index+match[0].length; }
  return out+replace(text.slice(cursor));
}
module.exports={applyRules};
