'use strict';

// Recognize UTF-8 byte sequences decoded as Latin-1 or Windows-1252.
// Consecutive accented letters alone are valid in Icelandic, Turkish and Czech.
const continuation = '[\\u0080-\\u00bf\\u20ac\\u201a\\u0192\\u201e\\u2026\\u2020\\u2021\\u02c6\\u2030\\u0160\\u2039\\u0152\\u017d\\u2018\\u2019\\u201c\\u201d\\u2022\\u2013\\u2014\\u02dc\\u2122\\u0161\\u203a\\u0153\\u017e\\u0178]';
const mojibake = new RegExp('[\\u00c2-\\u00c3]' + continuation
    + '|(?:[\\u00c4-\\u00df]' + continuation + '){2,}'
    + '|[\\u00e0-\\u00ef]' + continuation + '{2}'
    + '|[\\u00f0-\\u00f4]' + continuation + '{3}');
module.exports = { looksLikeMojibake: value => mojibake.test(String(value)) };
