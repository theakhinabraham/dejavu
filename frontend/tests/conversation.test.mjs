import assert from 'node:assert/strict';
import test from 'node:test';
import { extractDecisionOptions, optionsRestatement } from '../src/conversation.ts';

test('understands the reported class versus family-function question', () => {
  const choices = extractDecisionOptions('What should I do? go to class or skip class for a family function');
  assert.deepEqual(choices, ['go to class', 'skip class for a family function']);
  assert.equal(optionsRestatement(choices), 'I hear you weighing going to class against skipping class for a family function.');
});

test('removes repeated question framing from both sides of an or choice', () => {
  assert.deepEqual(
    extractDecisionOptions('Should I go to class or should I attend the family function?'),
    ['go to class', 'attend the family function'],
  );
});

test('understands a casual torn-between sentence with a curly apostrophe', () => {
  assert.deepEqual(
    extractDecisionOptions('I’m torn between going to class and attending a family function'),
    ['going to class', 'attending a family function'],
  );
});
