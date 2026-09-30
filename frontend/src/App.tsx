import { useEffect, useRef, useState, type FormEvent } from 'react';
import { compareDecisions, interpretChatTurn, type DecisionCriterionInput, type DecisionOptionInput, type DecisionResponse, type InterpretResponse } from './api';
import { extractDecisionOptions, optionsRestatement } from './conversation';

type Step = 'decision' | 'options' | 'criteria' | 'estimate' | 'calibration' | 'done';
type Message = { role: 'assistant' | 'user'; text: string };
type QuickReply = { label: string; value: string; score?: number };
type EstimateCursor = { option: number; criterion: number };
type Conversation = {
  question: string;
  options: string[];
  criteria: DecisionCriterionInput[];
  estimates: number[][];
  cursor: EstimateCursor;
  confidence: number;
};
type SavedChat = {
  id: string;
  title: string;
  savedAt: string;
  messages: Message[];
  conversation: Conversation;
  result: DecisionResponse;
};

const CHAT_STORAGE_KEY = 'dejavu.saved-chats.v1';

function readSavedChats(): SavedChat[] {
  try {
    const value = localStorage.getItem(CHAT_STORAGE_KEY);
    return value ? (JSON.parse(value) as SavedChat[]) : [];
  } catch { return []; }
}

function derivePatterns(chats: SavedChat[]) {
  const priorities = new Map<string, { name: string; count: number }>();
  for (const chat of chats) {
    const top = chat.conversation.criteria[0]?.name?.trim();
    if (!top) continue;
    const key = top.toLocaleLowerCase();
    const existing = priorities.get(key);
    priorities.set(key, { name: existing?.name ?? top, count: (existing?.count ?? 0) + 1 });
  }
  return [...priorities.values()].filter(item => item.count >= 2).sort((a, b) => b.count - a.count)[0] ?? null;
}

function chatTitle(chat: Conversation, messages: Message[]) {
  const firstUser = messages.find(message => message.role === 'user')?.text ?? chat.question ?? 'A decision';
  return firstUser.length > 58 ? `${firstUser.slice(0, 55).trimEnd()}…` : firstUser;
}

const initialConversation: Conversation = { question: '', options: [], criteria: [], estimates: [], cursor: { option: 0, criterion: 0 }, confidence: 3 };
const impactReplies: QuickReply[] = [
  { label: 'A real setback', value: 'It would make this much worse', score: -2 },
  { label: 'A small cost', value: 'It would make this a little harder', score: -1 },
  { label: 'No real change', value: 'It would leave this about the same', score: 0 },
  { label: 'A small win', value: 'It would make this a little better', score: 1 },
  { label: 'A big win', value: 'It would make this much better', score: 2 },
];
const calibrationReplies: QuickReply[] = [
  { label: 'Not often', value: 'Not often', score: 1 },
  { label: 'Some of the time', value: 'Some of the time', score: 2 },
  { label: 'Most of the time', value: 'Most of the time', score: 4 },
  { label: 'Nearly always', value: 'Nearly always', score: 5 },
];

function DejaVuMark({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <rect className="mark-back" x="7.2" y="4.8" width="21" height="21" rx="6.5" transform="rotate(-8 7.2 4.8)" strokeWidth="2.2" />
    <rect className="mark-front" x="12" y="13" width="21" height="21" rx="6.5" transform="rotate(8 12 13)" strokeWidth="2.2" />
    <circle className="mark-core" cx="21" cy="21" r="2.6" />
  </svg>;
}

const impactPromptStyles = [
  (option: string, priority: string) => `Let’s take ${priority} first. If you chose ${option}, what do you think would happen with it?`,
  (option: string, priority: string) => `Picture yourself going with ${option}. How might that shape ${priority}?`,
  (option: string, priority: string) => `On ${priority}, does ${option} feel like a step forward, a setback, or about even?`,
  (option: string, priority: string) => `What’s your gut read on ${option} and ${priority}? Think about the other paths too.`,
  (option: string, priority: string) => `Thinking a little further ahead, what could ${option} mean for ${priority}?`,
  (option: string, priority: string) => `Compared with your other choices, where might ${option} leave you on ${priority}?`,
  (option: string, priority: string) => `Let’s look at ${priority} from another angle. What changes if you choose ${option}?`,
  (option: string, priority: string) => `If ${option} became the plan, would ${priority} likely improve, get harder, or stay similar?`,
  (option: string, priority: string) => `How well do you think ${option} fits the way you want ${priority} to turn out?`,
  (option: string, priority: string) => `For ${priority}, what might be the upside or cost of ${option}?`,
  (option: string, priority: string) => `Now consider ${option}: what do you expect it to do for ${priority}?`,
  (option: string, priority: string) => `Would choosing ${option} make ${priority} easier, tougher, or mostly unchanged?`,
  (option: string, priority: string) => `What feels most likely for ${priority} if you take the ${option} route?`,
  (option: string, priority: string) => `How does ${option} stack up on ${priority}, in your experience?`,
  (option: string, priority: string) => `Suppose you look back in a few months. How might ${option} have affected ${priority}?`,
  (option: string, priority: string) => `When you weigh ${priority}, what do you think ${option} gives you—or asks you to give up?`,
  (option: string, priority: string) => `Would ${option} support the outcome you want for ${priority}? What’s your best guess?`,
  (option: string, priority: string) => `Let’s check ${priority}: does ${option} bring a likely benefit, a cost, or neither?`,
  (option: string, priority: string) => `What kind of effect do you expect ${option} to have on ${priority}?`,
  (option: string, priority: string) => `Last angle: if ${priority} matters here, how does ${option} compare with the alternatives?`,
];

function impactPrompt(option: string, criterion: string, index: number) {
  return impactPromptStyles[index % impactPromptStyles.length](option, criterion);
}

function understandPriorities(text: string) {
  const parts = text
    .split(/[.!?;\n]+/)
    .flatMap(part => part.trim().split(/,\s*/))
    .flatMap(part => /\b(?:important|priority|matters most|doesn't matter|don't matter)\b/i.test(part)
      ? part.trim().split(/\s+and\s+(?=[^,]{1,70}\s+(?:is|are|isn't|aren't|doesn't|don't|matters|counts|comes)\b)/i)
      : part.trim().split(/\s+and\s+/i))
    .map(part => part.trim())
    .filter(Boolean);
  const found: { name: string; emphasis: number; order: number }[] = [];

  for (const part of parts) {
    const high = /\b(?:most important|matters most|what matters most|top priority|number one|comes first|more important|main priority)\b/i.test(part);
    const low = /\b(?:not (?:that )?important|less important|least important|not a priority|doesn't matter much|don't matter much|does not matter much)\b/i.test(part);
    const refersBack = /^(?:that|this|it|those|these)\b/i.test(part) || /^(?:and\s+)?(?:that|this|it)\s+(?:is|was|isn't|is not)\b/i.test(part);
    if (refersBack && (high || low) && found.length) {
      found[found.length - 1].emphasis = high ? 2 : -2;
      continue;
    }

    const name = part
      .replace(/^(?:and\s+)?(?:i\s+(?:really\s+)?(?:need|want|care about|value|prioritize)|what matters (?:most|to me) is|the thing is|for me,?\s*)\s*/i, '')
      .replace(/\b(?:is|are|was|were)\s+(?:what matters most|the most important|most important|a top priority|not (?:that )?important|less important|least important|not a priority)\b.*$/i, '')
      .replace(/\bmatters most(?: to me)?\b.*$/i, '')
      .replace(/\b(?:doesn't|does not|don't|do not)\s+matter\s+(?:that\s+much|much)\b.*$/i, '')
      .replace(/[,.!?]+$/g, '')
      .trim();
    if (!name || /^(?:that|this|it)\s+(?:is|was|isn't|is not)\b/i.test(name)) continue;
    if (found.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) continue;
    found.push({ name, emphasis: high ? 2 : low ? -2 : 0, order: found.length });
  }

  return found
    .sort((a, b) => b.emphasis - a.emphasis || a.order - b.order)
    .map((item, index, sorted) => ({ name: item.name, priority: sorted.length - index, emphasis: item.emphasis }));
}

function priorityRestatement(criteria: { name: string; priority: number; emphasis?: number }[]) {
  if (criteria.length === 1) return `I hear you: ${criteria[0].name} is what matters most here. I’ll keep the comparison focused on that.`;
  const strongest = criteria[0];
  const lessImportant = criteria.filter(item => item.emphasis === -2);
  const others = criteria.filter(item => item.name !== strongest.name && item.emphasis !== -2);
  const parts = [`${strongest.name} is the main priority`];
  if (others.length) parts.push(`you also care about ${others.map(item => item.name).join(' and ')}`);
  if (lessImportant.length) parts.push(`${lessImportant.map(item => item.name).join(' and ')} matter less in this decision`);
  return `I hear you: ${parts.join(', and ')}. I’ll weigh them in that order.`;
}

function parseImpact(text: string, suggested?: number) {
  if (suggested !== undefined) return suggested;
  if (/\b(?:not sure|unsure|don't know|do not know|hard to tell|can't tell|cannot tell|it depends)\b/i.test(text)) return null;
  const positive = /\b(?:help|helps|helpful|benefit|benefits|improve|improves|better|easier|happy|happier|enjoy|enjoyable|good for me|great for|support|supports|worthwhile|excited)\b/i.test(text);
  const negative = /\b(?:hurt|hurts|harm|harmful|worse|harder|stress|stressed|stressful|cost|costs|risk|risky|setback|difficult|draining|bad for me|tough|worry|worried)\b/i.test(text);
  if (positive && negative) return null;
  if (/\b(?:much|major|significant|huge|a lot|really|strong|big)\b/i.test(text)) {
    if (positive) return 2;
    if (negative) return -2;
  }
  if (/\b(?:about the same|no change|no real difference|neutral|neither|unchanged|leave.*same)\b/i.test(text)) return 0;
  if (negative) return -1;
  if (positive) return 1;
  return null;
}

function impactLabel(value: number) {
  return ['Big downside', 'Some downside', 'About the same', 'Some upside', 'Big upside'][value + 2];
}

function calibrationLabel(value: number) {
  return ({ 1: 'Not often', 2: 'Some of the time', 3: 'About half the time', 4: 'Most of the time', 5: 'Nearly always' } as Record<number, string>)[value] ?? 'Not set';
}

function isUncertain(text: string) {
  return /^(?:i\s+)?(?:don't know|do not know|not sure|i'm not sure|im not sure|no idea|hard to say|can't decide|cannot decide)[.!\s]*$/i.test(text.trim());
}

function isAcknowledgement(text: string) {
  return /^(?:that's about it|that is about it|that's all|that is all|that's everything|that is everything|that's it|that is it|pretty much|i think that's it|i think that is it|yep|yeah|sure|okay|ok)[.!\s]*$/i.test(text.trim());
}

function App() {
  const [savedChats, setSavedChats] = useState<SavedChat[]>(readSavedChats);
  const [chatId, setChatId] = useState<string>(makeInitialId);
  const [step, setStep] = useState<Step>('decision');
  const [conversation, setConversation] = useState<Conversation>(initialConversation);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'Hey. Bring me any decision you’re weighing. We’ll work through the options using what matters to you and what you’ve learned from similar choices.' },
    { role: 'assistant', text: 'What are you deciding? Include the options if you already know them.' },
  ]);
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<DecisionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messageListRef = useRef<HTMLDivElement>(null);
  const usedBotPhrases = useRef<Set<string>>(new Set());
  const nluSessionId = useRef(makeSessionId());
  const nluSessionState = useRef<InterpretResponse['session_state'] | null>(null);
  const [nluSessionActive, setNluSessionActive] = useState(false);

  function makeInitialId() {
    return globalThis.crypto?.randomUUID?.() ?? `plan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function freshPhrase(choices: string[]) {
    const phrase = choices.find(choice => !usedBotPhrases.current.has(choice)) ?? choices[0];
    usedBotPhrases.current.add(phrase);
    return phrase;
  }

  function makeSessionId() {
    return globalThis.crypto?.randomUUID?.() ?? `plan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  useEffect(() => {
    if (messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [messages, loading]);
  useEffect(() => {
    try { localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(savedChats)); } catch { /* History remains usable for this session. */ }
  }, [savedChats]);
  useEffect(() => {
    if (step !== 'done' || !result) return;
    const saved: SavedChat = { id: chatId, title: chatTitle(conversation, messages), savedAt: new Date().toISOString(), messages, conversation, result };
    setSavedChats(current => [saved, ...current.filter(chat => chat.id !== chatId)].slice(0, 30));
  }, [step, result, chatId, messages, conversation]);
  useEffect(() => {
    if (result) document.getElementById('outcomes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result]);

  const bestOption = result ? [...result.scenarios].sort((a, b) => b.fit_score - a.fit_score)[0] : null;
  const replies: QuickReply[] = step === 'estimate' ? impactReplies : step === 'calibration' ? calibrationReplies : [];
  const conversationPhase = step === 'decision' || step === 'options' ? 0 : step === 'criteria' ? 1 : step === 'estimate' ? 2 : 3;
  const phaseNames = ['The decision', 'What matters', 'Possible outcomes', 'Your scenarios'];
  const widestSplit = conversation.criteria.map((criterion, criterionIndex) => {
    const scores = conversation.estimates.map(option => option[criterionIndex]).filter((score): score is number => score !== undefined);
    return { criterion, spread: scores.length ? Math.max(...scores) - Math.min(...scores) : 0, scores };
  }).sort((a, b) => b.spread - a.spread)[0];
  const bestOnTopPriority = result && conversation.criteria[0]
    ? [...result.scenarios].sort((a, b) => (b.criteria.find(item => item.name === conversation.criteria[0].name)?.expected_impact ?? 0) - (a.criteria.find(item => item.name === conversation.criteria[0].name)?.expected_impact ?? 0))[0]
    : null;
  const noiseByConfidence: Record<number, string> = { 1: '1.35 (widest)', 2: '1.00 (wide)', 3: '0.70 (moderate)', 4: '0.45 (narrow)', 5: '0.25 (narrowest)' };
  const recurringPattern = derivePatterns(savedChats.filter(chat => chat.id !== chatId));
  const historyCount = savedChats.filter(chat => chat.id !== chatId).length;

  function criteriaPrompt() {
    const memory = recurringPattern
      ? ` In earlier decisions, ${recurringPattern.name} came up as your top priority ${recurringPattern.count} times. Does it matter here too, or is this one different?`
      : '';
    return `What matters most to you here? You can mention a few things in whatever way feels natural, starting with the biggest one.${memory}`;
  }

  async function createComparison(updated: Conversation) {
    setLoading(true);
    setError('');
    const options: DecisionOptionInput[] = updated.options.map((name, optionIndex) => ({
      name,
      impacts: updated.criteria.map((criterion, criterionIndex) => ({
        criterion: criterion.name,
        impact: updated.estimates[optionIndex][criterionIndex],
      })),
    }));
    try {
      const response = await compareDecisions(updated.question, updated.criteria, options, updated.confidence);
      setResult(response);
      setMessages(current => [...current, { role: 'assistant', text: `${response.answer} I used the priorities you ranked and your sense of how similar expectations have held up before.` }]);
      setStep('done');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'I couldn’t reach the planner just now. Please try again.');
      setMessages(current => [...current, { role: 'assistant', text: 'I couldn’t finish the comparison just now. You can try that last answer again.' }]);
    } finally { setLoading(false); }
  }

  async function sendAnswer(raw: string, suggestedScore?: number) {
    const text = raw.trim();
    if (!text || loading || step === 'done') return;
    setMessages(current => [...current, { role: 'user', text }]);
    setDraft('');
    setError('');

    if (step === 'decision' || nluSessionActive) {
      let interpretation;
      setLoading(true);
      try {
        interpretation = await interpretChatTurn(nluSessionId.current, text, nluSessionState.current);
        nluSessionState.current = interpretation.session_state;
      } catch (cause) {
        setLoading(false);
        setError(cause instanceof Error ? cause.message : 'I couldn’t keep the planning details just now. Please try again.');
        setMessages(current => [...current, { role: 'assistant', text: 'I couldn’t read that into the planning notes just now. Your message is still here—please try sending it once more.' }]);
        return;
      }
      setLoading(false);
      if (interpretation.active) {
        setNluSessionActive(true);
        if (!interpretation.ready) {
          setMessages(current => [...current, { role: 'assistant', text: interpretation.assistant_message ?? 'Could you tell me a little more about that?' }]);
          return;
        }
        setNluSessionActive(false);
        const topic = String(interpretation.fields.decision_topic?.value ?? text);
        const topicLower = topic.toLowerCase();
        const inferredOptions = [
          /\b(?:gym|workout|exercise|fitness|fit|shape)\b/.test(topicLower) ? 'Gym' : '',
          /\b(?:assignment|coursework|exam|study|work)\b/.test(topicLower) ? 'Assignments' : '',
        ].filter(Boolean);
        const options = inferredOptions.length >= 2 ? inferredOptions : ['Gym', 'Assignments'];
        setConversation({ ...initialConversation, question: `${topic} ${interpretation.summary ?? ''}`, options });
        setStep('criteria');
        setMessages(current => [...current, { role: 'assistant', text: `Thanks, I’ve got that context. We can compare ${options.join(' and ')} over the ${interpretation.fields.time_horizon_days?.value ?? 'available'} days you have. What matters most to you in this choice?` }]);
        return;
      }
    }

    if (step === 'decision') {
      if (isUncertain(text) || isAcknowledgement(text)) {
        setMessages(current => [...current, { role: 'assistant', text: freshPhrase([
          'No rush. Start with the decision itself, even if it’s still a bit fuzzy. What are you weighing up?',
          'That’s okay—we can figure it out as we go. What choice has been taking up your attention lately?',
        ]) }]);
        return;
      }
      const updated = { ...conversation, question: text };
      const options = extractDecisionOptions(text);
      if (options.length >= 2 && options.length <= 4) {
        updated.options = options;
        setConversation(updated); setStep('criteria');
        setMessages(current => [...current, { role: 'assistant', text: `${optionsRestatement(options)} ${criteriaPrompt()}` }]);
      } else {
        setConversation(updated); setStep('options');
        setMessages(current => [...current, { role: 'assistant', text: 'What paths are actually on the table? A sentence like “I could take the new role or stay where I am” is perfect.' }]);
      }
      return;
    }

    if (step === 'options') {
      if (isUncertain(text) || isAcknowledgement(text)) {
        setMessages(current => [...current, { role: 'assistant', text: 'That’s fine. Tell me the choices you’re leaning between—even if one is simply waiting or keeping things as they are.' }]);
        return;
      }
      const options = extractDecisionOptions(text);
      if (options.length < 2 || options.length > 4) {
        const response = freshPhrase([
          'I’m not quite hearing the different paths yet. What would the choice look like on either side?',
          'Could you describe the options in a sentence? For example, “go ahead with it or wait a while.”',
          'What are the real alternatives you’re considering? Keeping things as they are can count as one.',
        ]);
        setMessages(current => [...current, { role: 'assistant', text: response }]);
        return;
      }
      setConversation(current => ({ ...current, options })); setStep('criteria');
      setMessages(current => [...current, { role: 'assistant', text: `Got it. ${criteriaPrompt()}` }]);
      return;
    }

    if (step === 'criteria') {
      const understood = understandPriorities(text);
      if (isUncertain(text) || (isAcknowledgement(text) && understood.length === 0)) {
        setMessages(current => [...current, { role: 'assistant', text: 'No problem. Think about what you’d want this decision to protect or make better—your time, peace of mind, money, relationships, learning, or something else.' }]);
        return;
      }
      if (understood.length < 1 || understood.length > 5) {
        const response = freshPhrase([
          'Could you tell me what matters most here? One thing is enough, or name a few with the biggest one first.',
          'What would make this feel like the right choice for you? Say it however you’d normally explain it.',
          'Let’s start with the main thing you want this choice to work out for. You can add others too.',
        ]);
        setMessages(current => [...current, { role: 'assistant', text: response }]);
        return;
      }
      const criteria = understood.map(({ name, priority }) => ({ name, priority }));
      const estimates = conversation.options.map(() => criteria.map(() => 0));
      const updated = { ...conversation, criteria, estimates, cursor: { option: 0, criterion: 0 } };
      setConversation(updated); setStep('estimate');
      const understoodSummary = priorityRestatement(understood);
      setMessages(current => [...current, { role: 'assistant', text: `${understoodSummary} ${impactPrompt(updated.options[0], criteria[0].name, 0)} Just go with your gut; you can answer in a sentence or tap a quick reply.` }]);
      return;
    }

    if (step === 'estimate') {
      const impact = parseImpact(text, suggestedScore);
      if (impact === null) {
        const response = freshPhrase([
          'It sounds a little uncertain or mixed. Overall, does this feel more like a benefit, a cost, or no real change?',
          'No need to put a number on it. In a sentence or two, what’s your gut feeling about how this affects that priority?',
          'If you picture choosing this path, does it leave that part of life a bit better, a bit harder, or about the same?',
        ]);
        setMessages(current => [...current, { role: 'assistant', text: response }]);
        return;
      }
      const estimates = conversation.estimates.map(row => [...row]);
      estimates[conversation.cursor.option][conversation.cursor.criterion] = impact;
      let nextOption = conversation.cursor.option;
      let nextCriterion = conversation.cursor.criterion + 1;
      if (nextCriterion >= conversation.criteria.length) { nextOption += 1; nextCriterion = 0; }
      const updated = { ...conversation, estimates, cursor: { option: nextOption, criterion: nextCriterion } };
      setConversation(updated);
      if (nextOption >= conversation.options.length) {
        setStep('calibration');
        setMessages(current => [...current, { role: 'assistant', text: 'That gives us a first pass. Thinking about similar choices you’ve made, how often does your first instinct tend to be about right? A rough answer is fine.' }]);
      } else {
        setMessages(current => [...current, { role: 'assistant', text: impactPrompt(updated.options[nextOption], updated.criteria[nextCriterion].name, nextOption * updated.criteria.length + nextCriterion) }]);
      }
      return;
    }

    if (step === 'calibration') {
      const confidence = suggestedScore ?? (/rarely|almost never|not often|hardly ever/i.test(text) ? 1 : /sometimes|some of the time/i.test(text) ? 2 : /usually|most of the time/i.test(text) ? 4 : /almost always|nearly every|nearly always/i.test(text) ? 5 : null);
      if (confidence === null) {
        const response = freshPhrase([
          'Which sounds closest: not often, some of the time, most of the time, or nearly always?',
          'If you had to go with your overall experience, how often do similar expectations hold up?',
          'Think of a few past choices. How often were your expectations roughly right?',
        ]);
        setMessages(current => [...current, { role: 'assistant', text: response }]);
        return;
      }
      const updated = { ...conversation, confidence };
      setConversation(updated);
      setMessages(current => [...current, { role: 'assistant', text: 'Let me map the possibilities…' }]);
      await createComparison(updated);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void sendAnswer(draft);
  }

  function resetChat() {
    setStep('decision'); setConversation(initialConversation); setResult(null); setError(''); setDraft('');
    setChatId(makeInitialId());
    nluSessionId.current = makeSessionId(); nluSessionState.current = null; setNluSessionActive(false);
    usedBotPhrases.current.clear();
    setMessages([{ role: 'assistant', text: 'Sure, let’s start fresh. What decision are you weighing? Include the options if you already know them.' }]);
  }

  function openSavedChat(chat: SavedChat) {
    setChatId(chat.id); setConversation(chat.conversation); setMessages(chat.messages); setResult(chat.result); setStep('done'); setError(''); setDraft('');
    document.getElementById('conversation')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function forgetHistory() {
    setSavedChats([]);
    try { if (typeof window !== 'undefined') window.localStorage.removeItem(CHAT_STORAGE_KEY); } catch { /* The empty in-memory state still applies. */ }
  }

  return <div className="workspace">
    <aside className="sidebar">
      <a className="brand" href="#top"><span className="brand-mark"><DejaVuMark /></span><span>DejaVu</span></a>
      <button className="new-plan" type="button" onClick={resetChat}><span>＋</span> New decision</button>
      <div className="side-label">WORKSPACE</div>
      <a className="side-link active" href="#conversation"><span className="side-icon">◷</span>Decision chat</a>
      <a className="side-link" href="#outcomes"><span className="side-icon">⌁</span>Scenario view</a>
      <div className="side-label recent-label">SAVED DECISIONS <span>{savedChats.length}</span></div>
      <div className="saved-chat-list">
        {savedChats.length ? savedChats.slice(0, 8).map(chat => <button className={`saved-chat-item ${chat.id === chatId ? 'selected' : ''}`} type="button" key={chat.id} onClick={() => openSavedChat(chat)} title={chat.title}><span>◷</span>{chat.title}</button>) : <div className="example-link">Finished decisions will appear here.</div>}
      </div>
      <div className="memory-note"><b>YOUR PATTERN MEMORY</b><p>{recurringPattern ? `You’ve often put ${recurringPattern.name} first (${recurringPattern.count} saved decisions). I’ll check whether that applies each time.` : 'As you save decisions, I’ll notice priorities that recur across chats.'}</p><small>Saved on this device · used as context, not model training</small>{savedChats.length > 0 && <button type="button" onClick={forgetHistory}>Clear chats & memory</button>}</div>
      <div className="sidebar-note"><span className="note-mark">✳</span><p>Your priorities lead the comparison. No one-size-fits-all advice.</p></div>
      <div className="side-profile"><span className="profile-avatar">Y</span><span><b>Your workspace</b><small>Private planning session</small></span><span className="profile-menu">···</span></div>
    </aside>

    <main className="app-shell" id="top">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><i>/</i><b>Decision chat</b></div><span className="demo-tag"><i /> YOUR PRIORITIES, YOUR CALL</span></header>
      <section className="hero"><div className="hero-kicker"><span className="kicker-line"/> A CLEARER WAY TO CHOOSE</div><h1>Let’s think this<br/><em>through together.</em></h1><p className="hero-copy">Any decision. Your options, your priorities, and what your own experience tells you.</p></section>

      <section className="chat-panel" id="conversation" aria-label="Decision planning conversation">
        <div className="thread-top"><div className="thread-symbol"><DejaVuMark /></div><div><b>{step === 'done' ? chatTitle(conversation, messages) : 'A new decision'}</b><span>Planning session <i>·</i> saved on this device</span></div><button type="button" className="more-button" aria-label="Start a new conversation" onClick={resetChat}>↻</button></div>
        {step !== 'done' && <div className="conversation-progress" aria-label={`Conversation stage: ${phaseNames[conversationPhase]}`}>
          {phaseNames.slice(0, 3).map((phase, index) => <span className={index === conversationPhase ? 'current' : index < conversationPhase ? 'complete' : ''} key={phase}><i>{index < conversationPhase ? '✓' : '·'}</i>{phase}</span>)}
          <span className="progress-note">No forms, just a conversation</span>
        </div>}
        <div className="chat-log" ref={messageListRef} aria-live="polite">
          {messages.map((message, index) => <div className={`chat-message ${message.role === 'user' ? 'chat-user' : 'chat-assistant'}`} key={`${index}-${message.role}`}>
            {message.role === 'assistant' && <div className="assistant-mark"><DejaVuMark /></div>}
            <div className="message-copy">{message.text}</div>
          </div>)}
          {loading && <div className="chat-message chat-assistant"><div className="assistant-mark"><DejaVuMark /></div><div className="typing-indicator"><i/><i/><i/></div></div>}
        </div>
        {step === 'decision' && messages.every(message => message.role === 'assistant') && <div className="starter-suggestions" aria-label="Example questions">
          <span>START WITH A QUESTION LIKE</span>
          <div>
            {[
              'Should I go to class or attend the family function?',
              'Should I take the new role or stay where I am?',
              'Should I move closer to work or keep saving money?',
            ].map(prompt => <button type="button" key={prompt} onClick={() => void sendAnswer(prompt)} disabled={loading}><span>{prompt}</span><i>↗</i></button>)}
          </div>
        </div>}
        {step !== 'done' && <div className="chat-compose-area">
          {!!replies.length && <div className="quick-replies" aria-label="Suggested replies">{replies.map(reply => <button type="button" key={reply.label} onClick={() => void sendAnswer(reply.value, reply.score)} disabled={loading}>{reply.label}</button>)}</div>}
          {error && <p className="error-message" role="alert">{error}</p>}
          <form className="chat-composer" onSubmit={handleSubmit}>
            <textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendAnswer(draft); } }} maxLength={1000} rows={1} placeholder={step === 'decision' ? 'Tell me what you’re weighing up…' : step === 'options' ? 'Describe the paths in your own words…' : step === 'criteria' ? 'What matters most to you here?' : 'Share your gut feeling…'} aria-label="Write a reply" disabled={loading} />
            <button type="submit" aria-label="Send message" disabled={loading || !draft.trim()}><span>↑</span></button>
          </form>
          <div className="composer-hint"><span>Enter to send <i>·</i> Shift + Enter for a new line</span><span>{step === 'estimate' ? 'A gut feeling is enough' : step === 'criteria' ? 'One priority or a few—your call' : step === 'calibration' ? 'No need to be exact' : 'Take it in your own direction'}</span></div>
        </div>}
      </section>

      {result && <section className="results" id="outcomes" aria-live="polite">
        <div className="results-heading"><div><p className="eyebrow">A COMPARISON BUILT AROUND YOU</p><h2>Your options, mapped to what matters.</h2></div><span className="estimate-tag">{result.runs.toLocaleString()} simulations · illustrative</span></div>
        <p className="recommendation"><b>Your read:</b> {result.recommendation} This reflects the priorities and estimates you shared; it’s a way to see the tradeoffs, not a decision made for you.</p>
        <details className="decision-audit" open>
          <summary><span className="audit-symbol">∿</span><span className="audit-summary-copy"><b>Decision trace</b><small>Inputs, patterns, and how the comparison was built</small></span><span className="audit-run-tag">{result.runs.toLocaleString()} SIMULATED RUNS</span><span className="audit-chevron">⌄</span></summary>
          <div className="audit-content">
            <div className="audit-notice"><span>WHAT I USED</span><p>This comparison uses the priorities and estimates from this chat{historyCount ? `, plus recurring priority patterns from ${historyCount} earlier saved decision${historyCount === 1 ? '' : 's'}` : ''}. Your chats stay on this device. I use them as context; I don’t retrain the underlying model.</p></div>
            {recurringPattern && <p className="pattern-observation history-observation"><span className="observation-mark">✳</span><span><b>From your saved chats:</b> you ranked <strong>{recurringPattern.name}</strong> first in {recurringPattern.count} decisions. I brought it up as a question for this decision, so you can confirm or correct it.</span></p>}
            <div className="audit-insights">
              <article><span className="eyebrow">TOP PRIORITY</span><b>{conversation.criteria[0]?.name}</b><small>Ranked 1st · weight {conversation.criteria[0]?.priority}</small></article>
              <article><span className="eyebrow">STRONGEST ON IT</span><b>{bestOnTopPriority?.name}</b><small>Based on your impact ratings for {conversation.criteria[0]?.name}</small></article>
              <article><span className="eyebrow">YOUR CALIBRATION</span><b>{calibrationLabel(conversation.confidence)}</b><small>Model variation σ = {noiseByConfidence[conversation.confidence]}</small></article>
            </div>
            {widestSplit?.criterion && <p className="pattern-observation"><span className="observation-mark">↗</span><span><b>Pattern in these answers:</b> your ratings diverged most on <strong>{widestSplit.criterion.name}</strong>{widestSplit.spread === 0 ? '—you saw the options similarly on every priority.' : `, where your options span ${impactLabel(Math.min(...widestSplit.scores))} to ${impactLabel(Math.max(...widestSplit.scores))}.`} That’s a tradeoff in this decision, not a personality label.</span></p>}
            <div className="audit-table-wrap"><table className="audit-table"><caption>What you estimated · impact compared with the other options</caption><thead><tr><th scope="col">Option</th>{conversation.criteria.map(criterion => <th scope="col" key={criterion.name}>{criterion.name}<small>Priority {criterion.priority}</small></th>)}</tr></thead><tbody>{conversation.options.map((option, optionIndex) => <tr key={option}><th scope="row">{option}</th>{conversation.criteria.map((criterion, criterionIndex) => { const value = conversation.estimates[optionIndex]?.[criterionIndex] ?? 0; return <td key={criterion.name}><span className={value > 0 ? 'rating-positive' : value < 0 ? 'rating-negative' : 'rating-neutral'}>{impactLabel(value)}</span><small>{value > 0 ? '+' : ''}{value}</small></td>; })}</tr>)}</tbody></table></div>
            <div className="audit-method"><div><span className="eyebrow">SCORING</span><p>Priority order sets the weights. Fit = clamp(50 + 25 × weighted impact, 0–100); neutral impact maps to 50.</p></div><div><span className="eyebrow">UNCERTAINTY</span><p>Each run adds Gaussian noise (σ {noiseByConfidence[conversation.confidence].split(' ')[0]}) to your ratings. The displayed range is the 10th–90th percentile across {result.runs.toLocaleString()} runs.</p></div></div>
          </div>
        </details>
        <div className="visual-summary"><div className="visual-title"><div><span className="eyebrow">OVERALL FIT</span><h3>How each option lines up with your priorities</h3></div><span className="fit-scale">Lower fit <i/> Higher fit</span></div>
          <div className="chart-axis"><span>0</span><span>50</span><span>100</span></div>
          {result.scenarios.map(option => <div className="fit-chart-row" key={option.name}><div className="chart-name">{option.name}{option.name === bestOption?.name && <em>STRONGEST FIT</em>}</div><div className="fit-chart"><div className="fit-chart-track"><i style={{ left: `${option.fit_p10}%`, width: `${Math.max(1, option.fit_p90 - option.fit_p10)}%` }}/><b style={{ left: `${option.fit_score}%` }}/></div><span>{Math.round(option.fit_score)}</span></div></div>)}
          <div className="range-note">Dot = average fit <i/> line = range across simulated outcomes</div>
        </div>
        <div className="scenario-grid">{result.scenarios.map(option => <article className={`scenario-card ${option.name === bestOption?.name ? 'recommended-card' : ''}`} key={option.name}>
          <div className="scenario-title"><div><span className="eyebrow">OPTION</span><h3>{option.name}</h3></div><span className="fit-score">{Math.round(option.fit_score)}<small>/100</small></span></div>
          <div className="fit-range"><span>Estimated fit range</span><b>{Math.round(option.fit_p10)}–{Math.round(option.fit_p90)}</b><div className="score-track"><i style={{ width: `${Math.max(1, option.fit_p90 - option.fit_p10)}%`, marginLeft: `${option.fit_p10}%` }}/></div><small>{Math.round(option.positive_fit_probability * 100)}% chance of net positive impact</small></div>
          <div className="impact-list"><h4>Against your priorities</h4>{option.criteria.map(criterion => <div className="impact-row" key={criterion.name}><div className="impact-title"><span>{criterion.name}</span><small>{criterion.priority === Math.max(...option.criteria.map(item => item.priority)) ? 'Top priority' : `Priority ${criterion.priority}`}</small></div><div className="impact-meter"><i className="impact-zero"/><i className={`impact-value ${criterion.expected_impact >= 0 ? 'impact-positive' : 'impact-negative'}`} style={criterion.expected_impact >= 0 ? { left: '50%', width: `${criterion.expected_impact / 2 * 50}%` } : { left: `${50 + criterion.expected_impact / 2 * 50}%`, width: `${Math.abs(criterion.expected_impact) / 2 * 50}%` }}/></div><span className="impact-expectation">{criterion.expected_impact > .3 ? 'Upside' : criterion.expected_impact < -.3 ? 'Tradeoff' : 'Mixed'}</span></div>)}</div>
          <div className="consequence-section gains"><h4>Potential upsides</h4>{option.gains.length ? <ul>{option.gains.map(item => <li key={item}>{item}</li>)}</ul> : <p>No clear upside in the estimates you gave.</p>}</div>
          <div className="consequence-section tradeoffs"><h4>Potential tradeoffs</h4>{option.tradeoffs.length ? <ul>{option.tradeoffs.map(item => <li key={item}>{item}</li>)}</ul> : <p>No clear downside in the estimates you gave.</p>}</div>
        </article>)}</div>
        <p className="fine-print">The comparison uses your own impact estimates and priorities. Shaded ranges show how the result can shift when expectations are uncertain; they are not objective predictions.</p>
        <button className="continue-chat" onClick={resetChat}>Talk through another decision <span>↗</span></button>
      </section>}
      <footer><span>DEJAVU</span><span>Small choices, clearer consequences.</span></footer>
    </main>
  </div>;
}

export default App;
