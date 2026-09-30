function splitItems(text: string) {
  const cleaned = text
    .replace(/^(?:the options are|my options are|options are)\s*/i, '')
    .replace(/^(?:i could|i can|i'm thinking about|im thinking about|probably|i guess)\s+/i, '')
    .replace(/(?:,\s*|\s+(?:and\s+)?)?(?:that(?:'s| is)\s+(?:about it|all|everything|pretty much it)|and that's it|and that is it|that's pretty much it|that is pretty much it|that's everything|that is everything)[.!?]*$/i, '')
    .replace(/(?:,?\s+)(?:etc(?:etera)?|and so on|and stuff|you know)[.!?]*$/i, '')
    .trim();
  const items = cleaned.split(/\s*,?\s+or\s+|\s+versus\s+|\s+vs\.?\s+|\s*;\s*/i)
    .map(item => item.trim().replace(/^['"“”]+|['"“”?!.,]+$/g, ''))
    .filter(Boolean);
  return items.filter((item, index) => items.findIndex(candidate => candidate.toLocaleLowerCase() === item.toLocaleLowerCase()) === index);
}

export function extractDecisionOptions(text: string) {
  let candidate = text.trim()
    .replace(/^(?:the question (?:is|was)|my question is|question)\s*[:,]?\s*/i, '')
    .replace(/^what should i do\s*[:,?]?\s*/i, '')
    .replace(/^what do you think i should do\s*[:,?]?\s*/i, '')
    .replace(/^(?:i need to decide whether to|i'm deciding whether to|im deciding whether to|should i|should we|do i)\s+/i, '');
  const between = candidate.match(/^(?:i(?:['’]m| am)\s+)?(?:torn|deciding|choosing)\s+between\s+(.+?)\s+and\s+(.+?)[.!?]*$/i)
    ?? candidate.match(/^(?:choose|pick)\s+between\s+(.+?)\s+and\s+(.+?)[.!?]*$/i);
  if (between) {
    return [between[1], between[2]].map(item => item.trim().replace(/^['“”]+|['“”?!.,]+$/g, '')).filter(Boolean);
  }
  candidate = candidate.replace(/^(?:i(?:['’]m| am)\s+)?(?:torn|deciding|choosing)\s+between\s+/i, '')
    .replace(/^(?:choose|pick)\s+between\s+/i, '')
    .replace(/^(?:what should i do|should i|should we)\s*\?\s*/i, '');
  return splitItems(candidate)
    .map(item => item.replace(/^(?:should i|should we|do i|do we)\s+/i, '').trim())
    .filter(Boolean);
}

export function optionsRestatement(options: string[]) {
  const makeConversational = (option: string) => option.replace(/^(go)\b/i, 'going').replace(/^(skip)\b/i, 'skipping').replace(/^(attend)\b/i, 'attending').replace(/^(stay)\b/i, 'staying');
  const choices = options.map(makeConversational);
  if (choices.length === 2) return `I hear you weighing ${choices[0]} against ${choices[1]}.`;
  return `I hear you weighing ${choices.slice(0, -1).join(', ')} against ${choices[choices.length - 1]}.`;
}
