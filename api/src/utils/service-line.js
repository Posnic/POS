'use strict';
const orderLine = require('./order-line');
const ALLERGIES = [
  'milk',
  'eggs',
  'fish',
  'shellfish',
  'peanuts',
  'tree-nuts',
  'wheat',
  'soy',
  'sesame',
  'celery',
  'mustard',
  'lupin',
  'sulphites',
];
function metadata(line) {
  const seat = Number(line.seat || 0);
  const course = String(line.course || '').trim();
  const allergies = line.allergies || [];
  const allergyNote = String(line.allergy_note || '').trim();
  if (
    !Number.isInteger(seat) ||
    seat < 0 ||
    seat > 99 ||
    course.length > 40 ||
    [...course, ...allergyNote].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    !Array.isArray(allergies) ||
    allergies.length > ALLERGIES.length ||
    allergies.some((value) => !ALLERGIES.includes(value)) ||
    allergyNote.length > 200 ||
    (line.held != null && typeof line.held !== 'boolean')
  )
    throw new Error('invalid_service_details');
  return {
    ...orderLine.identity(line),
    seat,
    course,
    held: line.held === true,
    allergies: [...new Set(allergies)],
    allergy_note: allergyNote,
  };
}
module.exports = { metadata, ALLERGIES };
