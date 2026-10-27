// Run:  cd server && node --test test/class-names.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanClassName, cleanSection } from '../src/classNames.js';

test('class names are stored without the word Class', () => {
  for (const [raw, want] of [['10', '10'], ['Class 10', '10'], ['class-10', '10'], ['Std. 10', '10'], ['Grade 5', '5'], ['10th', '10'], ['010', '10'], [' 1 ', '1'], ['Class 1', '1'], ['Nursery', 'Nursery'], ['Class LKG', 'LKG'], ['Class Nursery', 'Nursery']]) {
    assert.equal(cleanClassName(raw), want, raw);
  }
});
test('sections are tidy', () => {
  for (const [raw, want] of [['b', 'B'], [' A ', 'A'], ['Section B', 'B'], ['', ''], [undefined, ''], ['Rose', 'Rose']]) assert.equal(cleanSection(raw), want, String(raw));
});
